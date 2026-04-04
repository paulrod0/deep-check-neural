#!/usr/bin/env python3
"""
Deep-Check V9.2 -- Staged Training for Maximum Precision
Phase 1 (E1-6):  Backbone FROZEN + Linear(1024->1). No branches.
Phase 2 (E7-15): Unfreeze 4 blocks + GATED Freq/SRM branches + MLP head.
Phase 3 (E16+):  Low LR refinement. Target: AUC 0.98+, EER < 5%.
"""
import os, sys, time, hashlib, logging, json, io, random, copy
from pathlib import Path
from dataclasses import dataclass, field
from collections import defaultdict
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torchvision import transforms
from PIL import Image
import timm

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

@dataclass
class C:
    SZ:int=224; BS_P1:int=512; BS_P2:int=48; EPOCHS:int=50
    LR_P1:float=1e-3; LR_P2_BB:float=1e-5; LR_P2_HEAD:float=1e-4
    WD:float=0.01; LABEL_SMOOTH:float=0.05; EMA_DECAY:float=0.9995
    PHASE2_EPOCH:int=7; PHASE3_EPOCH:int=16; UNFREEZE_BLOCKS:int=4
    GRAD_CLIP:float=1.0; WORKERS:int=4
    DATA:Path=Path("/home/ubuntu/data"); OUT:Path=Path("/home/ubuntu/training/v9_staged")
    METRIC_FILE:str="metrics.jsonl"
    S3_METRICS:str="s3://deep-check-models/training/v9_staged/metrics.jsonl"
    S3_BEST:str="s3://deep-check-models/deepfake/v9/best_v9_staged.pt"
    VAL_SOURCES:list=field(default_factory=lambda:["lfw","utkface","val-fakes","val-modern-fakes"])

class JPEGCompr:
    def __init__(s,qr=(20,95)):s.qr=qr
    def __call__(s,img):
        buf=io.BytesIO();img.save(buf,format="JPEG",quality=random.randint(*s.qr));buf.seek(0);return Image.open(buf).convert("RGB")
class GNoise:
    def __init__(s,sr=(0.01,0.05)):s.sr=sr
    def __call__(s,img):
        a=np.array(img).astype(np.float32)/255;a=np.clip(a+np.random.normal(0,random.uniform(*s.sr),a.shape).astype(np.float32),0,1);return Image.fromarray((a*255).astype(np.uint8))

def get_train_tf(sz):
    return transforms.Compose([transforms.RandomResizedCrop(sz,scale=(0.65,1.0)),transforms.RandomHorizontalFlip(0.5),
        transforms.RandomApply([transforms.ColorJitter(0.4,0.4,0.3,0.15)],p=0.5),transforms.RandomGrayscale(p=0.1),
        transforms.RandomApply([transforms.GaussianBlur(5,sigma=(0.1,2.5))],p=0.25),
        transforms.RandomApply([JPEGCompr((20,85))],p=0.35),transforms.RandomApply([GNoise((0.01,0.05))],p=0.2),
        transforms.ToTensor(),transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225]),
        transforms.RandomErasing(p=0.1,scale=(0.02,0.15))])
def get_val_tf(sz):
    return transforms.Compose([transforms.Resize(int(sz*1.15)),transforms.CenterCrop(sz),
        transforms.ToTensor(),transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])

def file_hash(p):
    try:
        sz=os.path.getsize(p);h=hashlib.md5(str(sz).encode())
        with open(p,"rb") as f:h.update(f.read(4096))
        return h.hexdigest()
    except:return str(p)

def scan_dataset(root):
    MAPS=[("celeba/img_align_celeba/**",0),("celeba-hq/**",0),("lfw/**",0),("utkface/**",0),
        ("human-faces/**",0),("140k-faces/**/real/**",0),("140k-faces/**/training_real/**",0),
        ("cifake/**/REAL/**",0),("ffhq-real/**",0),("ffhq-256/**",0),
        ("deepfake-faces/**",1),("140k-faces/**/fake/**",1),("140k-faces/**/training_fake/**",1),
        ("cifake/**/FAKE/**",1),("val-fakes/**",1),
        ("ai-modern/ffgenai/dataset/real/**",0),("ai-modern/ffgenai/dataset/fake/**",1),
        ("ai-modern/openfake/**/real/**",0),("ai-modern/openfake/**/fake/**",1),
        ("ai-modern/realfake512/**/Real/**",0),("ai-modern/realfake512/**/Fake_Diffusion/**",1),
        ("ai-modern/realfake512/**/Fake_GAN/**",1),
        ("ai-modern/**/fake/**",1),("ai-modern/**/FAKE/**",1),("ai-modern/**/Fake/**",1),
        ("val-modern-fakes/**",1)]
    exts={".jpg",".jpeg",".png",".bmp",".webp"};data=defaultdict(list);hashes=set()
    import glob as g
    for pat,lab in MAPS:
        ms=g.glob(str(root/pat),recursive=True);src=pat.split("/")[0];cnt=0
        for m in ms:
            p=Path(m)
            if not p.is_file() or p.suffix.lower() not in exts:continue
            if p.stat().st_size<1024:continue
            h=file_hash(str(p))
            if h in hashes:continue
            hashes.add(h);data[src].append((str(p),lab));cnt+=1
        if cnt>0:log.info(f"  {pat}: {cnt} ({'REAL' if lab==0 else 'FAKE'})")
    return data

def split_data(data,val_sources):
    train,val=[],[];val_src=set(s.lower() for s in val_sources)
    for src,items in data.items():
        if src.lower() in val_src or any(vs in src.lower() for vs in val_src):val.extend(items)
        else:train.extend(items)
    return train,val

class FaceDataset(Dataset):
    def __init__(s,items,tf):s.items=items;s.tf=tf
    def __len__(s):return len(s.items)
    def __getitem__(s,i):
        path,label=s.items[i]
        try:return s.tf(Image.open(path).convert("RGB")),label
        except:j=random.randint(0,len(s.items)-1);return s.tf(Image.open(s.items[j][0]).convert("RGB")),s.items[j][1]

class FrequencyBranchV3(nn.Module):
    def __init__(s,out_dim=48):
        super().__init__();s.scales=[32,64,128,224]
        s.encoders=nn.ModuleList([nn.Sequential(nn.Conv2d(3,24,3,padding=1),nn.GELU(),nn.Conv2d(24,24,3,padding=1),nn.GELU(),nn.AdaptiveAvgPool2d(4)) for _ in range(4)])
        s.proj=nn.Linear(24*4*4*4,out_dim)
    def forward(s,x):
        feats=[]
        for i,sz in enumerate(s.scales):
            xf=F.interpolate(x,size=(sz,sz),mode='bilinear',align_corners=False)
            feats.append(s.encoders[i](xf-F.avg_pool2d(xf,3,1,1)).flatten(1))
        return s.proj(torch.cat(feats,1))

class SRMBranch(nn.Module):
    def __init__(s,out_dim=32):
        super().__init__();s.srm_conv=nn.Conv2d(1,9,5,padding=2,bias=False)
        with torch.no_grad():
            k=torch.zeros(9,1,5,5)
            k[0,0,2,1]=1;k[0,0,2,2]=-1;k[1,0,1,2]=1;k[1,0,2,2]=-1
            k[2,0,1,2]=1;k[2,0,2,1]=1;k[2,0,2,2]=-4;k[2,0,2,3]=1;k[2,0,3,2]=1
            k[3,0,1,1]=1;k[3,0,1,3]=1;k[3,0,2,2]=-4;k[3,0,3,1]=1;k[3,0,3,3]=1
            k[4,0,1,1]=-1;k[4,0,1,2]=2;k[4,0,1,3]=-1;k[4,0,2,1]=2;k[4,0,2,2]=-4;k[4,0,2,3]=2;k[4,0,3,1]=-1;k[4,0,3,2]=2;k[4,0,3,3]=-1
            k[5,0]=torch.tensor([[0,0,-1,0,0],[0,-1,-2,-1,0],[-1,-2,16,-2,-1],[0,-1,-2,-1,0],[0,0,-1,0,0]],dtype=torch.float32)
            k[6,0,1,1]=1;k[6,0,2,2]=-1;k[7,0,1,3]=1;k[7,0,2,2]=-1
            k[8,0]=torch.tensor([[-1,-2,0,2,1],[-4,-8,0,8,4],[-6,-12,0,12,6],[-4,-8,0,8,4],[-1,-2,0,2,1]],dtype=torch.float32)/12
            s.srm_conv.weight=nn.Parameter(k)
        s.srm_conv.weight.requires_grad=False
        s.encoder=nn.Sequential(nn.Conv2d(9,32,3,padding=1),nn.GELU(),nn.Conv2d(32,32,3,stride=2,padding=1),nn.GELU(),nn.AdaptiveAvgPool2d(4))
        s.proj=nn.Linear(32*4*4,out_dim)
    def forward(s,x):
        gray=0.299*x[:,0:1]+0.587*x[:,1:2]+0.114*x[:,2:3]
        return s.proj(s.encoder(s.srm_conv(gray)).flatten(1))

class StagedClassifier(nn.Module):
    def __init__(s):
        super().__init__()
        s.backbone=timm.create_model("vit_large_patch16_dinov3.lvd1689m",pretrained=True,num_classes=0,dynamic_img_size=True,img_size=224)
        s.feat_dim=s.backbone.num_features
        s.linear_head=nn.Sequential(nn.LayerNorm(s.feat_dim),nn.Dropout(0.15),nn.Linear(s.feat_dim,1))
        s.freq=FrequencyBranchV3(out_dim=48);s.srm=SRMBranch(out_dim=32)
        s.gate_freq=nn.Parameter(torch.tensor(-2.0));s.gate_srm=nn.Parameter(torch.tensor(-2.0))
        total_dim=s.feat_dim+48+32
        s.mlp_head=nn.Sequential(nn.LayerNorm(total_dim),nn.Dropout(0.25),nn.Linear(total_dim,256),nn.GELU(),nn.Dropout(0.1),nn.Linear(256,1))
        s.phase=1
        for p in s.backbone.parameters():p.requires_grad=False
        for p in s.freq.parameters():p.requires_grad=False
        for p in s.srm.parameters():p.requires_grad=False
        s.gate_freq.requires_grad=False;s.gate_srm.requires_grad=False
        for p in s.mlp_head.parameters():p.requires_grad=False
        log.info(f"Phase 1: Linear head. Trainable: {sum(p.numel() for p in s.parameters() if p.requires_grad)/1e6:.2f}M")

    def activate_phase2(s,n_blocks=4):
        s.phase=2
        blocks=s.backbone.blocks
        for i in range(len(blocks)-n_blocks,len(blocks)):
            for p in blocks[i].parameters():p.requires_grad=True
        if hasattr(s.backbone,'norm'):
            for p in s.backbone.norm.parameters():p.requires_grad=True
        for p in s.freq.parameters():p.requires_grad=True
        for p in s.srm.parameters():p.requires_grad=True
        s.srm.srm_conv.weight.requires_grad=False
        s.gate_freq.requires_grad=True;s.gate_srm.requires_grad=True
        for p in s.mlp_head.parameters():p.requires_grad=True
        for p in s.linear_head.parameters():p.requires_grad=False
        t=sum(p.numel() for p in s.parameters() if p.requires_grad)
        log.info(f"Phase 2: Backbone+Gated branches. Trainable: {t/1e6:.1f}M")
        log.info(f"  Gates: freq={torch.sigmoid(s.gate_freq).item():.3f} srm={torch.sigmoid(s.gate_srm).item():.3f}")

    def forward(s,x):
        sem=s.backbone(x)
        if s.phase==1:return s.linear_head(sem).squeeze(-1)
        freq_feat=torch.sigmoid(s.gate_freq)*s.freq(x)
        srm_feat=torch.sigmoid(s.gate_srm)*s.srm(x)
        return s.mlp_head(torch.cat([sem,freq_feat,srm_feat],dim=1)).squeeze(-1)

class EMA:
    def __init__(s,model,decay=0.9995):s.decay=decay;s.shadow={k:v.clone() for k,v in model.state_dict().items()}
    def update(s,model):
        for k,v in model.state_dict().items():s.shadow[k]=s.decay*s.shadow[k]+(1-s.decay)*v
    def apply(s,model):model.load_state_dict(s.shadow)

def compute_metrics(logits,labels):
    from sklearn.metrics import roc_auc_score,roc_curve
    probs=torch.sigmoid(logits).cpu().numpy();labels_np=labels.cpu().numpy()
    try:auc=roc_auc_score(labels_np,probs)
    except:auc=0.5
    try:fpr,tpr,_=roc_curve(labels_np,probs);idx=np.nanargmin(np.abs(fpr-(1-tpr)));eer=float(fpr[idx])
    except:eer=0.5
    return {"auc":auc,"eer":eer,"acc":float(((probs>0.5).astype(int)==labels_np).mean())}

def train_epoch(model,loader,optimizer,criterion,scaler,device,cfg):
    model.train();total_loss=0;all_l,all_lab=[],[]
    for i,(imgs,labels) in enumerate(loader):
        imgs,labels=imgs.to(device),labels.to(device).float()
        with torch.amp.autocast("cuda"):logits=model(imgs);loss=criterion(logits,labels)
        optimizer.zero_grad();scaler.scale(loss).backward();scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(),cfg.GRAD_CLIP);scaler.step(optimizer);scaler.update()
        total_loss+=loss.item();all_l.append(logits.detach());all_lab.append(labels.detach())
        if (i+1)%50==0:
            gi=""
            if model.phase>=2:gi=f" g=[f:{torch.sigmoid(model.gate_freq).item():.3f} s:{torch.sigmoid(model.gate_srm).item():.3f}]"
            log.info(f"  batch {i+1}/{len(loader)}: loss={loss.item():.4f}{gi}")
    m=compute_metrics(torch.cat(all_l),torch.cat(all_lab));m["loss"]=total_loss/len(loader);return m

@torch.no_grad()
def val_epoch(model,loader,criterion,device):
    model.eval();total_loss=0;all_l,all_lab=[],[]
    for imgs,labels in loader:
        imgs,labels=imgs.to(device),labels.to(device).float()
        with torch.amp.autocast("cuda"):logits=model(imgs);loss=criterion(logits,labels)
        total_loss+=loss.item();all_l.append(logits);all_lab.append(labels)
    m=compute_metrics(torch.cat(all_l),torch.cat(all_lab));m["loss"]=total_loss/max(len(loader),1);return m

def main():
    cfg=C();cfg.OUT.mkdir(parents=True,exist_ok=True)
    device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log.info(f"Device: {device}")
    log.info("Scanning datasets...");data=scan_dataset(cfg.DATA)
    total_real=sum(1 for items in data.values() for _,l in items if l==0)
    total_fake=sum(1 for items in data.values() for _,l in items if l==1)
    log.info(f"Total: {total_real} real + {total_fake} fake = {total_real+total_fake}")
    modern_fake=sum(1 for items in data.values() for p,l in items if l==1 and "ai-modern" in p)
    log.info(f"Modern AI fakes: {modern_fake}")
    train_items,val_items=split_data(data,cfg.VAL_SOURCES);random.shuffle(train_items)
    tr=sum(1 for _,l in train_items if l==0);tf_=sum(1 for _,l in train_items if l==1)
    log.info(f"Train: {tr} real + {tf_} fake = {len(train_items)}")
    log.info(f"Val: {sum(1 for _,l in val_items if l==0)} real + {sum(1 for _,l in val_items if l==1)} fake = {len(val_items)}")
    labels=[l for _,l in train_items];cc=[labels.count(0),labels.count(1)]
    sampler=WeightedRandomSampler([1.0/cc[l] for l in labels],len(train_items),replacement=True)
    train_ds=FaceDataset(train_items,get_train_tf(cfg.SZ));val_ds=FaceDataset(val_items,get_val_tf(cfg.SZ))
    train_loader=DataLoader(train_ds,batch_size=cfg.BS_P1,sampler=sampler,num_workers=cfg.WORKERS,pin_memory=True,drop_last=True)
    val_loader=DataLoader(val_ds,batch_size=cfg.BS_P1,num_workers=cfg.WORKERS,pin_memory=True)
    model=StagedClassifier().to(device);ema=EMA(model,decay=cfg.EMA_DECAY)
    criterion=nn.BCEWithLogitsLoss(pos_weight=torch.tensor([tr/max(tf_,1)]).to(device))
    optimizer=torch.optim.AdamW(filter(lambda p:p.requires_grad,model.parameters()),lr=cfg.LR_P1,weight_decay=cfg.WD)
    scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,T_max=cfg.PHASE2_EPOCH,eta_min=cfg.LR_P1*0.01)
    scaler=torch.amp.GradScaler("cuda");best_auc=0;best_eer=1.0;best_epoch=0
    log.info(f"\n{'='*60}\nV9.2 STAGED -- Precision First\nP1(E1-{cfg.PHASE2_EPOCH-1}):Linear | P2(E{cfg.PHASE2_EPOCH}-{cfg.PHASE3_EPOCH-1}):Gated | P3(E{cfg.PHASE3_EPOCH}+):Refine\n{'='*60}")
    for epoch in range(1,cfg.EPOCHS+1):
        t0=time.time()
        if epoch==cfg.PHASE2_EPOCH:
            log.info(f"\n{'='*60}\nPHASE 2: Backbone + Gated branches\n{'='*60}")
            model.activate_phase2(cfg.UNFREEZE_BLOCKS)
            train_loader=DataLoader(train_ds,batch_size=cfg.BS_P2,sampler=sampler,num_workers=cfg.WORKERS,pin_memory=True,drop_last=True)
            val_loader=DataLoader(val_ds,batch_size=cfg.BS_P2,num_workers=cfg.WORKERS,pin_memory=True)
            bb_p=[p for n,p in model.backbone.named_parameters() if p.requires_grad]
            br_p=list(model.freq.parameters())+[p for p in model.srm.parameters() if p.requires_grad]+[model.gate_freq,model.gate_srm]+list(model.mlp_head.parameters())
            optimizer=torch.optim.AdamW([{"params":bb_p,"lr":cfg.LR_P2_BB},{"params":br_p,"lr":cfg.LR_P2_HEAD}],weight_decay=cfg.WD)
            scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,T_max=cfg.PHASE3_EPOCH-cfg.PHASE2_EPOCH,eta_min=1e-6)
            ema=EMA(model,decay=cfg.EMA_DECAY)
        if epoch==cfg.PHASE3_EPOCH:
            log.info(f"\n{'='*60}\nPHASE 3: Low LR refinement\n{'='*60}")
            scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,T_max=cfg.EPOCHS-cfg.PHASE3_EPOCH,eta_min=1e-7)
        train_m=train_epoch(model,train_loader,optimizer,criterion,scaler,device,cfg);ema.update(model)
        orig_sd={k:v.clone() for k,v in model.state_dict().items()};ema.apply(model)
        val_m=val_epoch(model,val_loader,criterion,device);model.load_state_dict(orig_sd)
        scheduler.step();elapsed=time.time()-t0;lr=optimizer.param_groups[0]["lr"]
        pn="P1-LINEAR" if epoch<cfg.PHASE2_EPOCH else "P2-GATED" if epoch<cfg.PHASE3_EPOCH else "P3-REFINE"
        gi=""
        if model.phase>=2:gi=f" g=[f:{torch.sigmoid(model.gate_freq).item():.3f} s:{torch.sigmoid(model.gate_srm).item():.3f}]"
        log.info(f"Epoch {epoch:02d} [{pn}] train_loss={train_m['loss']:.4f} train_auc={train_m['auc']:.4f} val_loss={val_m['loss']:.4f} val_auc={val_m['auc']:.4f} val_eer={val_m['eer']:.4f} lr={lr:.2e}{gi} time={elapsed:.0f}s")
        metric={"epoch":epoch,"phase":pn,"model":"v9.2-staged","train_loss":train_m["loss"],"train_auc":train_m["auc"],"val_loss":val_m["loss"],"val_auc":val_m["auc"],"val_eer":val_m["eer"],"val_acc":val_m["acc"],"lr":lr,"time_s":elapsed,"modern_fakes":modern_fake}
        if model.phase>=2:metric["gate_freq"]=torch.sigmoid(model.gate_freq).item();metric["gate_srm"]=torch.sigmoid(model.gate_srm).item()
        with open(cfg.OUT/cfg.METRIC_FILE,"a") as f:f.write(json.dumps(metric)+"\n")
        try:os.system(f"aws s3 cp {cfg.OUT/cfg.METRIC_FILE} {cfg.S3_METRICS} --quiet")
        except:pass
        if val_m["auc"]>best_auc:
            best_auc=val_m["auc"];best_eer=val_m["eer"];best_epoch=epoch
            torch.save({"epoch":epoch,"model_state":model.state_dict(),"ema_state":ema.shadow,"val_auc":val_m["auc"],"val_eer":val_m["eer"],"config":{"backbone":"vit_large_patch16_dinov3.lvd1689m","version":"V9.2-staged","modern_fakes":modern_fake,"total_train":len(train_items)}},cfg.OUT/"best_v9_staged.pt")
            log.info(f"  * New best AUC={best_auc:.6f} EER={best_eer:.4f}")
            try:os.system(f"aws s3 cp {cfg.OUT/'best_v9_staged.pt'} {cfg.S3_BEST} --quiet")
            except:pass
        if epoch%5==0:torch.save({"epoch":epoch,"model_state":model.state_dict(),"ema_state":ema.shadow},cfg.OUT/"latest_v9_staged.pt")
        if epoch>cfg.PHASE3_EPOCH+15 and epoch-best_epoch>15:log.info(f"Early stopping (best={best_epoch})");break
    log.info(f"\nDONE -- Best AUC={best_auc:.6f} EER={best_eer:.4f} at epoch {best_epoch}")

if __name__=="__main__":main()
