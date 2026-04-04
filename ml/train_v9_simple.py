#!/usr/bin/env python3
"""V9.4 SIMPLE -- DINOv3 + Linear head only. No branches. Same as V8 but with modern data."""
import os,sys,time,hashlib,logging,json,io,random,copy
from pathlib import Path
from dataclasses import dataclass,field
from collections import defaultdict
import numpy as np,torch,torch.nn as nn,torch.nn.functional as F
from torch.utils.data import Dataset,DataLoader,WeightedRandomSampler
from torchvision import transforms
from PIL import Image
import timm
logging.basicConfig(level=logging.INFO,format="%(asctime)s %(message)s")
log=logging.getLogger(__name__)

@dataclass
class C:
    SZ:int=224; BS_P1:int=512; BS_P2:int=64; EPOCHS:int=50
    LR_P1:float=1e-3; LR_P2_BB:float=1e-5; LR_P2_HEAD:float=1e-4
    WD:float=0.01; LABEL_SMOOTH:float=0.05; EMA_DECAY:float=0.999
    UNFREEZE_EPOCH:int=7; UNFREEZE_BLOCKS:int=4; GRAD_CLIP:float=1.0; WORKERS:int=4
    DATA:Path=Path("/home/ubuntu/data"); OUT:Path=Path("/home/ubuntu/training/v9_simple")
    S3_METRICS:str="s3://deep-check-models/training/v9_simple/metrics.jsonl"
    S3_BEST:str="s3://deep-check-models/deepfake/v9/best_v9_simple.pt"
    VAL_SOURCES:list=field(default_factory=lambda:["lfw","utkface","val-fakes","val-modern-fakes"])

class JPEGCompr:
    def __init__(self,qr=(20,95)): self.qr=qr
    def __call__(self,img):
        buf=io.BytesIO(); img.save(buf,format="JPEG",quality=random.randint(*self.qr)); buf.seek(0); return Image.open(buf).convert("RGB")
class GNoise:
    def __init__(self,sr=(0.01,0.05)): self.sr=sr
    def __call__(self,img):
        a=np.array(img).astype(np.float32)/255; a=np.clip(a+np.random.normal(0,random.uniform(*self.sr),a.shape).astype(np.float32),0,1); return Image.fromarray((a*255).astype(np.uint8))

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
        sz=os.path.getsize(p); h=hashlib.md5(str(sz).encode())
        with open(p,"rb") as f: h.update(f.read(4096))
        return h.hexdigest()
    except: return str(p)

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
        ("ai-modern/sfhq-t2i/images/**",1),
        ("ai-modern/deepdetect2025/**/real/**",0),("ai-modern/deepdetect2025/**/fake/**",1),
        ("ai-modern/genimage/real_pool/**",0),("ai-modern/genimage/sd_pool/**",1),
        ("ai-modern/genimage/gan_pool/**",1),("ai-modern/genimage/mj_pool/**",1),
        ("ai-modern/labeled-deepfake/Real/**",0),
        ("ai-modern/labeled-deepfake/DALL-E/**",1),("ai-modern/labeled-deepfake/Midjourney/**",1),
        ("ai-modern/labeled-deepfake/Stable Diffusion/**",1),("ai-modern/labeled-deepfake/StyleGAN/**",1),
        ("ai-modern/labeled-deepfake/FaceSwap/**",1),("ai-modern/labeled-deepfake/FaceShifter/**",1),
        ("ai-modern/labeled-deepfake/Face2Face/**",1),("ai-modern/labeled-deepfake/NeuralTextures/**",1),
        ("ai-modern/labeled-deepfake/DeepFaceLab/**",1),
        ("ai-modern/**/fake/**",1),("ai-modern/**/FAKE/**",1),("ai-modern/**/Fake/**",1),
        ("val-modern-fakes/**",1)]
    exts={".jpg",".jpeg",".png",".bmp",".webp"}; data=defaultdict(list); hashes=set()
    import glob as g
    for pat,lab in MAPS:
        ms=g.glob(str(root/pat),recursive=True); src=pat.split("/")[0]; cnt=0
        for m in ms:
            p=Path(m)
            if not p.is_file() or p.suffix.lower() not in exts: continue
            if p.stat().st_size<1024: continue
            h=file_hash(str(p))
            if h in hashes: continue
            hashes.add(h); data[src].append((str(p),lab)); cnt+=1
        if cnt>0:
            lbl = "REAL" if lab==0 else "FAKE"
            log.info(f"  {pat}: {cnt} ({lbl})")
    return data

def split_data(data,val_sources):
    train,val=[],[]; val_src=set(s.lower() for s in val_sources)
    for src,items in data.items():
        if src.lower() in val_src or any(vs in src.lower() for vs in val_src): val.extend(items)
        else: train.extend(items)
    return train,val

class FaceDataset(Dataset):
    def __init__(self,items,tf): self.items=items; self.tf=tf
    def __len__(self): return len(self.items)
    def __getitem__(self,i):
        path,label=self.items[i]
        try: return self.tf(Image.open(path).convert("RGB")),label
        except: j=random.randint(0,len(self.items)-1); return self.tf(Image.open(self.items[j][0]).convert("RGB")),self.items[j][1]

class SimpleClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.backbone=timm.create_model("vit_large_patch16_dinov3.lvd1689m",pretrained=True,num_classes=0,dynamic_img_size=True,img_size=224)
        fd=self.backbone.num_features
        self.head=nn.Sequential(nn.LayerNorm(fd),nn.Dropout(0.15),nn.Linear(fd,1))
        for p in self.backbone.parameters(): p.requires_grad=False
        log.info(f"SimpleClassifier: DINOv3({fd}D) + Linear. Backbone FROZEN")
    def forward(self,x): return self.head(self.backbone(x)).squeeze(-1)
    def unfreeze(self,n=4):
        blocks=self.backbone.blocks
        for i in range(len(blocks)-n,len(blocks)):
            for p in blocks[i].parameters(): p.requires_grad=True
        if hasattr(self.backbone,"norm"):
            for p in self.backbone.norm.parameters(): p.requires_grad=True
        t=sum(p.numel() for p in self.parameters() if p.requires_grad)
        log.info(f"Unfroze last {n}: {t/1e6:.1f}M trainable")

class EMA:
    def __init__(self,model,decay=0.999): self.decay=decay; self.shadow={k:v.clone() for k,v in model.state_dict().items()}
    def update(self,model):
        for k,v in model.state_dict().items(): self.shadow[k]=self.decay*self.shadow[k]+(1-self.decay)*v
    def apply(self,model): model.load_state_dict(self.shadow)

def compute_metrics(logits,labels):
    from sklearn.metrics import roc_auc_score,roc_curve
    probs=torch.sigmoid(logits).cpu().numpy(); labels_np=labels.cpu().numpy()
    try: auc_val=roc_auc_score(labels_np,probs)
    except: auc_val=0.5
    try: fpr,tpr,_=roc_curve(labels_np,probs); idx=np.nanargmin(np.abs(fpr-(1-tpr))); eer_val=float(fpr[idx])
    except: eer_val=0.5
    acc_val=float(((probs>0.5).astype(int)==labels_np).mean())
    return {"auc":auc_val,"eer":eer_val,"acc":acc_val}

def train_epoch(model,loader,optimizer,criterion,scaler,device,cfg):
    model.train(); total_loss=0; all_l,all_lab=[],[]
    for i,(imgs,labels) in enumerate(loader):
        imgs,labels=imgs.to(device),labels.to(device).float()
        with torch.amp.autocast("cuda"): logits=model(imgs); loss=criterion(logits,labels)
        optimizer.zero_grad(); scaler.scale(loss).backward(); scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(),cfg.GRAD_CLIP); scaler.step(optimizer); scaler.update()
        total_loss+=loss.item(); all_l.append(logits.detach()); all_lab.append(labels.detach())
        if (i+1)%50==0: log.info(f"  batch {i+1}/{len(loader)}: loss={loss.item():.4f}")
    m=compute_metrics(torch.cat(all_l),torch.cat(all_lab)); m["loss"]=total_loss/len(loader); return m

@torch.no_grad()
def val_epoch(model,loader,criterion,device):
    model.eval(); total_loss=0; all_l,all_lab=[],[]
    for imgs,labels in loader:
        imgs,labels=imgs.to(device),labels.to(device).float()
        with torch.amp.autocast("cuda"): logits=model(imgs); loss=criterion(logits,labels)
        total_loss+=loss.item(); all_l.append(logits); all_lab.append(labels)
    m=compute_metrics(torch.cat(all_l),torch.cat(all_lab)); m["loss"]=total_loss/max(len(loader),1); return m

def main():
    cfg=C(); cfg.OUT.mkdir(parents=True,exist_ok=True)
    device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log.info(f"Device: {device}")
    log.info("Scanning datasets..."); data=scan_dataset(cfg.DATA)
    total_real=sum(1 for items in data.values() for _,l in items if l==0)
    total_fake=sum(1 for items in data.values() for _,l in items if l==1)
    log.info(f"Total: {total_real} real + {total_fake} fake = {total_real+total_fake}")
    modern=sum(1 for items in data.values() for p,l in items if l==1 and "ai-modern" in p)
    log.info(f"Modern AI fakes: {modern}")
    train_items,val_items=split_data(data,cfg.VAL_SOURCES); random.shuffle(train_items)
    tr=sum(1 for _,l in train_items if l==0); tf_=sum(1 for _,l in train_items if l==1)
    vr=sum(1 for _,l in val_items if l==0); vf=sum(1 for _,l in val_items if l==1)
    log.info(f"Train: {tr} real + {tf_} fake = {len(train_items)}")
    log.info(f"Val: {vr} real + {vf} fake = {len(val_items)}")
    labels=[l for _,l in train_items]; cc=[labels.count(0),labels.count(1)]
    sampler=WeightedRandomSampler([1.0/cc[l] for l in labels],len(train_items),replacement=True)
    train_ds=FaceDataset(train_items,get_train_tf(cfg.SZ)); val_ds=FaceDataset(val_items,get_val_tf(cfg.SZ))
    train_loader=DataLoader(train_ds,batch_size=cfg.BS_P1,sampler=sampler,num_workers=cfg.WORKERS,pin_memory=True,drop_last=True)
    val_loader=DataLoader(val_ds,batch_size=cfg.BS_P1,num_workers=cfg.WORKERS,pin_memory=True)
    model=SimpleClassifier().to(device); ema=EMA(model,decay=cfg.EMA_DECAY)
    criterion=nn.BCEWithLogitsLoss(pos_weight=torch.tensor([tr/max(tf_,1)]).to(device))
    optimizer=torch.optim.AdamW(filter(lambda p:p.requires_grad,model.parameters()),lr=cfg.LR_P1,weight_decay=cfg.WD)
    scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,T_max=cfg.UNFREEZE_EPOCH,eta_min=cfg.LR_P1*0.01)
    scaler=torch.amp.GradScaler("cuda"); best_auc=0; best_eer=1.0; best_epoch=0
    sep="="*60
    log.info(f"\n{sep}\nV9.4 SIMPLE -- DINOv3 + Linear\n{sep}")
    for epoch in range(1,cfg.EPOCHS+1):
        t0=time.time()
        if epoch==cfg.UNFREEZE_EPOCH:
            log.info(f"\n{sep}\nPHASE 2: Unfreezing last {cfg.UNFREEZE_BLOCKS} blocks\n{sep}")
            model.unfreeze(cfg.UNFREEZE_BLOCKS)
            train_loader=DataLoader(train_ds,batch_size=cfg.BS_P2,sampler=sampler,num_workers=cfg.WORKERS,pin_memory=True,drop_last=True)
            val_loader=DataLoader(val_ds,batch_size=cfg.BS_P2,num_workers=cfg.WORKERS,pin_memory=True)
            bb_p=[p for n,p in model.backbone.named_parameters() if p.requires_grad]
            head_p=list(model.head.parameters())
            optimizer=torch.optim.AdamW([{"params":bb_p,"lr":cfg.LR_P2_BB},{"params":head_p,"lr":cfg.LR_P2_HEAD}],weight_decay=cfg.WD)
            scheduler=torch.optim.lr_scheduler.CosineAnnealingLR(optimizer,T_max=cfg.EPOCHS-cfg.UNFREEZE_EPOCH,eta_min=1e-7)
            ema=EMA(model,decay=cfg.EMA_DECAY)
        train_m=train_epoch(model,train_loader,optimizer,criterion,scaler,device,cfg); ema.update(model)
        orig_sd={k:v.clone() for k,v in model.state_dict().items()}; ema.apply(model)
        val_m=val_epoch(model,val_loader,criterion,device); model.load_state_dict(orig_sd)
        scheduler.step(); elapsed=time.time()-t0; lr=optimizer.param_groups[0]["lr"]
        phase="P1-FROZEN" if epoch<cfg.UNFREEZE_EPOCH else "P2-UNFREEZE"
        va=val_m["auc"]; ve=val_m["eer"]; ta=train_m["auc"]; gap=ta-va
        log.info(f"Epoch {epoch:02d} [{phase}] val_auc={va:.4f} val_eer={ve:.4f} train_auc={ta:.4f} gap={gap:.4f} lr={lr:.2e} time={elapsed:.0f}s")
        metric={"epoch":epoch,"phase":phase,"model":"v9.4-simple",
                "train_loss":train_m["loss"],"train_auc":ta,
                "val_loss":val_m["loss"],"val_auc":va,"val_eer":ve,"val_acc":val_m["acc"],
                "lr":lr,"gap":gap,"time_s":elapsed,"modern_fakes":modern}
        with open(cfg.OUT/"metrics.jsonl","a") as f: f.write(json.dumps(metric)+"\n")
        try: os.system(f"aws s3 cp {cfg.OUT/'metrics.jsonl'} {cfg.S3_METRICS} --quiet")
        except: pass
        if va>best_auc:
            best_auc=va; best_eer=ve; best_epoch=epoch
            torch.save({"epoch":epoch,"model_state":model.state_dict(),"ema_state":ema.shadow,
                        "val_auc":va,"val_eer":ve,
                        "config":{"backbone":"vit_large_patch16_dinov3.lvd1689m","version":"V9.4-simple",
                                  "modern_fakes":modern,"total_train":len(train_items)}},
                       cfg.OUT/"best_v9_simple.pt")
            log.info(f"  * New best AUC={best_auc:.6f} EER={best_eer:.4f}")
            try: os.system(f"aws s3 cp {cfg.OUT/'best_v9_simple.pt'} {cfg.S3_BEST} --quiet")
            except: pass
        if epoch%5==0: torch.save({"epoch":epoch,"model_state":model.state_dict(),"ema_state":ema.shadow},cfg.OUT/"latest.pt")
        if epoch>cfg.UNFREEZE_EPOCH+15 and epoch-best_epoch>15: log.info(f"Early stopping (best={best_epoch})"); break
    log.info(f"\nDONE -- Best AUC={best_auc:.6f} EER={best_eer:.4f} at epoch {best_epoch}")

if __name__=="__main__": main()
