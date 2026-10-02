#!/usr/bin/env python3
"""Deep-Check V5 — EfficientNet-V2-S variant. Same pipeline, different backbone."""

import os, sys, time, hashlib, logging, json, io, random
from pathlib import Path
from dataclasses import dataclass, field
from collections import defaultdict
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

@dataclass
class C:
    SZ: int = 224; BS: int = 48; EPOCHS: int = 150
    LR: float = 2e-3; WD: float = 0.05; DROPOUT: float = 0.4
    LABEL_SMOOTH: float = 0.1; MIXUP_ALPHA: float = 0.3; CUTMIX_ALPHA: float = 1.0
    MIXUP_PROB: float = 0.5; EMA_DECAY: float = 0.999; GRAD_CLIP: float = 1.0
    WORKERS: int = 4; DATA: Path = Path("/home/ubuntu/data")
    OUT: Path = Path("/home/ubuntu/training/v5_effnetv2"); METRIC_FILE: str = "metrics.jsonl"
    VAL_SOURCES: list = field(default_factory=lambda: ["lfw","utkface","stylegan-faces"])

class JPEGCompression:
    def __init__(s, qr=(30,95)): s.qr=qr
    def __call__(s, img):
        buf=io.BytesIO(); img.save(buf,format='JPEG',quality=random.randint(*s.qr))
        buf.seek(0); return Image.open(buf).convert('RGB')
class GaussianNoise:
    def __init__(s, sr=(0.01,0.05)): s.sr=sr
    def __call__(s, img):
        a=np.array(img).astype(np.float32)/255
        return Image.fromarray((np.clip(a+np.random.normal(0,random.uniform(*s.sr),a.shape).astype(np.float32),0,1)*255).astype(np.uint8))
class RandomDownUp:
    def __init__(s, sr=(0.25,0.75)): s.sr=sr
    def __call__(s, img):
        sc=random.uniform(*s.sr); w,h=img.size
        return img.resize((max(int(w*sc),16),max(int(h*sc),16)),Image.BILINEAR).resize((w,h),Image.BILINEAR)

def get_train_transform(sz):
    return transforms.Compose([
        transforms.RandomResizedCrop(sz,scale=(0.6,1.0),ratio=(0.8,1.2)),
        transforms.RandomHorizontalFlip(0.5),
        transforms.RandomApply([transforms.ColorJitter(0.4,0.4,0.4,0.15)],p=0.6),
        transforms.RandomGrayscale(p=0.15),
        transforms.RandomApply([transforms.GaussianBlur(5,sigma=(0.1,3.0))],p=0.3),
        transforms.RandomApply([JPEGCompression((20,85))],p=0.4),
        transforms.RandomApply([GaussianNoise((0.01,0.06))],p=0.3),
        transforms.RandomApply([RandomDownUp((0.25,0.6))],p=0.2),
        transforms.RandomRotation(15), transforms.ToTensor(),
        transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225]),
        transforms.RandomErasing(p=0.25,scale=(0.02,0.2))])
def get_val_transform(sz):
    return transforms.Compose([transforms.Resize(int(sz*1.1)),transforms.CenterCrop(sz),
        transforms.ToTensor(),transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])

def fast_hash(p):
    h=hashlib.md5()
    with open(p,'rb') as f: h.update(f.read(8192))
    return h.hexdigest()

def scan_dataset(root):
    MAPPINGS = [
        ("ffhq-real/**",0),("celeba/img_align_celeba/**",0),("celeba-hq/**",0),
        ("lfw/**",0),("utkface/**",0),("widerface/WIDER_train/**",0),
        ("widerface-extra/**",0),("human-faces/**",0),("landscape-real/**",0),
        ("140k-faces/**/real/**",0),("140k-faces/**/training_real/**",0),
        ("cifake/**/REAL/**",0),("gravex-200k/**/real/**",0),
        ("faceforensics/**/original_sequences/**",0),("faceforensics/**/youtube/**",0),
        ("real-and-fake-face/**/real/**",0),("real-and-fake-face/**/training_real/**",0),
        ("stylegan-faces/**",1),("deepfake-faces/**",1),("ai-faces-hq/**",1),
        ("140k-faces/**/fake/**",1),("140k-faces/**/training_fake/**",1),
        ("cifake/**/FAKE/**",1),("gravex-200k/**/ai_images/**",1),
        ("faceforensics/**/manipulated_sequences/**",1),("faceforensics/**/Deepfakes/**",1),
        ("faceforensics/**/Face2Face/**",1),("faceforensics/**/FaceSwap/**",1),
        ("faceforensics/**/NeuralTextures/**",1),("faceforensics/**/FaceShifter/**",1),
        ("real-and-fake-face/**/fake/**",1),("real-and-fake-face/**/training_fake/**",1)]
    exts={'.jpg','.jpeg','.png','.bmp','.webp'}; data=defaultdict(list)
    import glob as G
    for pat,lab in MAPPINGS:
        ms=G.glob(str(root/pat),recursive=True); src=pat.split('/')[0]; c=0
        for m in ms:
            p=Path(m)
            if p.is_file() and p.suffix.lower() in exts and p.stat().st_size>=1000:
                data[src].append((p,lab)); c+=1
        if c: log.info(f"  {pat}: {c} {'real' if lab==0 else 'fake'}")
    for src in sorted(data): items=data[src]; log.info(f"  {src}: {sum(1 for _,l in items if l==0)} real + {sum(1 for _,l in items if l==1)} fake")
    return data

def build_splits(cfg):
    log.info("Scanning..."); data=scan_dataset(cfg.DATA)
    ti,vi=[],[]
    for s,items in data.items():
        if s in cfg.VAL_SOURCES: vi.extend(items)
        else: ti.extend(items)
    th=set(); tc=[]
    for p,l in ti:
        h=fast_hash(p)
        if h not in th: th.add(h); tc.append((p,l))
    vh=set(); vc=[]
    for p,l in vi:
        h=fast_hash(p)
        if h not in vh and h not in th: vh.add(h); vc.append((p,l))
    tr=[(p,l) for p,l in tc if l==0]; tf=[(p,l) for p,l in tc if l==1]
    mc=min(len(tr),len(tf))
    if mc==0: log.error("No data!"); sys.exit(1)
    random.shuffle(tr); random.shuffle(tf); tb=tr[:mc]+tf[:mc]; random.shuffle(tb)
    vr=[(p,l) for p,l in vc if l==0]; vf=[(p,l) for p,l in vc if l==1]; vm=min(len(vr),len(vf))
    if vm==0: vb=vc
    else: random.shuffle(vr); random.shuffle(vf); vb=vr[:vm]+vf[:vm]; random.shuffle(vb)
    log.info(f"Final: {len(tb)} train ({mc}/class), {len(vb)} val ({vm}/class)")
    return tb, vb

class FaceDataset(Dataset):
    def __init__(s,items,t): s.items=items; s.transform=t
    def __len__(s): return len(s.items)
    def __getitem__(s,i):
        p,l=s.items[i]
        try: return s.transform(Image.open(p).convert('RGB')),l
        except: return s.__getitem__(random.randint(0,len(s.items)-1))

class FrequencyBranch(nn.Module):
    def __init__(s):
        super().__init__()
        lap=torch.tensor([[0,1,0],[1,-4,1],[0,1,0]],dtype=torch.float32)
        s.register_buffer('lap3',lap.view(1,1,3,3).repeat(3,1,1,1))
        l5=torch.zeros(5,5); l5[0,2]=l5[4,2]=l5[2,0]=l5[2,4]=1
        l5[1,2]=l5[3,2]=l5[2,1]=l5[2,3]=2; l5[2,2]=-12
        s.register_buffer('lap5',l5.view(1,1,5,5).repeat(3,1,1,1))
        s.conv=nn.Sequential(nn.Conv2d(6,32,3,padding=1),nn.BatchNorm2d(32),nn.ReLU(),
            nn.Conv2d(32,64,3,stride=2,padding=1),nn.BatchNorm2d(64),nn.ReLU(),
            nn.AdaptiveAvgPool2d(1),nn.Flatten())
    def forward(s,x):
        return s.conv(torch.cat([F.conv2d(x,s.lap3,padding=1,groups=3),F.conv2d(x,s.lap5,padding=2,groups=3)],1))

class DeepCheckV5_V2(nn.Module):
    def __init__(s,dropout=0.4):
        super().__init__()
        import timm
        s.backbone=timm.create_model('tf_efficientnetv2_s',pretrained=True,num_classes=0)
        bb=s.backbone.num_features; s.freq=FrequencyBranch()
        s.head=nn.Sequential(nn.Linear(bb+64,512),nn.BatchNorm1d(512),nn.GELU(),nn.Dropout(dropout),
            nn.Linear(512,128),nn.BatchNorm1d(128),nn.GELU(),nn.Dropout(dropout),nn.Linear(128,1))
    def forward(s,x): return s.head(torch.cat([s.backbone(x),s.freq(x)],1)).squeeze(-1)

class EMA:
    def __init__(s,m,d=0.999): s.decay=d; s.shadow={k:v.clone().detach() for k,v in m.state_dict().items()}
    def update(s,m):
        for k,v in m.state_dict().items(): s.shadow[k]=s.decay*s.shadow[k]+(1-s.decay)*v
    def apply(s,m): m.load_state_dict(s.shadow)

def mixup_data(x,y,a=0.3):
    lam=np.random.beta(a,a); idx=torch.randperm(x.size(0),device=x.device)
    return lam*x+(1-lam)*x[idx],y,y[idx],lam
def cutmix_data(x,y,a=1.0):
    lam=np.random.beta(a,a); idx=torch.randperm(x.size(0),device=x.device)
    _,_,H,W=x.shape; cr=np.sqrt(1.-lam); cw,ch=int(W*cr),int(H*cr)
    cx,cy=np.random.randint(W),np.random.randint(H)
    x1,y1=np.clip(cx-cw//2,0,W),np.clip(cy-ch//2,0,H)
    x2,y2=np.clip(cx+cw//2,0,W),np.clip(cy+ch//2,0,H)
    mx=x.clone(); mx[:,:,y1:y2,x1:x2]=x[idx,:,y1:y2,x1:x2]
    return mx,y,y[idx],1-((x2-x1)*(y2-y1)/(W*H))
def mix_crit(c,p,ya,yb,l): return l*c(p,ya.float())+(1-l)*c(p,yb.float())

class LabelSmoothBCE(nn.Module):
    def __init__(s,sm=0.1): super().__init__(); s.s=sm; s.bce=nn.BCEWithLogitsLoss()
    def forward(s,logits,t): return s.bce(logits,t*(1-s.s)+0.5*s.s)

def train_epoch(model,loader,opt,crit,scaler,dev,cfg,epoch):
    model.train(); tl,co,to=0,0,0
    for bi,(imgs,labs) in enumerate(loader):
        imgs,labs=imgs.to(dev),labs.to(dev)
        um=random.random()<0.5 and epoch>3
        if um:
            if random.random()<cfg.MIXUP_PROB: imgs,la,lb,lam=mixup_data(imgs,labs,cfg.MIXUP_ALPHA)
            else: imgs,la,lb,lam=cutmix_data(imgs,labs,cfg.CUTMIX_ALPHA)
        opt.zero_grad()
        with torch.amp.autocast('cuda'):
            lo=model(imgs); loss=mix_crit(crit,lo,la,lb,lam) if um else crit(lo,labs.float())
        scaler.scale(loss).backward(); scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(),cfg.GRAD_CLIP)
        scaler.step(opt); scaler.update()
        tl+=loss.item()*imgs.size(0)
        if not um: co+=((torch.sigmoid(lo)>0.5).long()==labs).sum().item()
        to+=imgs.size(0)
        if bi%200==0: log.info(f"  batch {bi}/{len(loader)} loss={loss.item():.4f}")
    return tl/to, co/to if to>0 else 0

@torch.no_grad()
def validate(model,loader,crit,dev):
    model.eval(); tl,co,to=0,0,0; ap,al=[],[]
    for imgs,labs in loader:
        imgs,labs=imgs.to(dev),labs.to(dev)
        with torch.amp.autocast('cuda'):
            lo=model(imgs); loss=crit(lo,labs.float())
        pr=torch.sigmoid(lo); tl+=loss.item()*imgs.size(0)
        co+=((pr>0.5).long()==labs).sum().item(); to+=imgs.size(0)
        ap.extend(pr.cpu().numpy()); al.extend(labs.cpu().numpy())
    from sklearn.metrics import roc_auc_score, roc_curve
    ap,al=np.array(ap),np.array(al)
    try:
        auc=roc_auc_score(al,ap); fpr,tpr,_=roc_curve(al,ap)
        fnr=1-tpr; ei=np.nanargmin(np.abs(fpr-fnr)); eer=(fpr[ei]+fnr[ei])/2
    except: auc,eer=0.5,0.5
    return tl/to,co/to,auc,eer

def export_onnx(model,path,dev):
    model.eval()
    torch.onnx.export(model,torch.randn(1,3,224,224,device=dev),str(path),
        input_names=["face_image"],output_names=["logit"],
        dynamic_axes={"face_image":{0:"batch"},"logit":{0:"batch"}},opset_version=17)
    log.info(f"ONNX: {path} ({path.stat().st_size/1024/1024:.1f}MB)")

def main():
    cfg=C(); cfg.OUT.mkdir(parents=True,exist_ok=True)
    dev=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log.info(f"Device: {dev}"); log.info("=== EfficientNet-V2-S ===")
    mf=cfg.OUT/cfg.METRIC_FILE
    if mf.exists(): mf.unlink()
    ti,vi=build_splits(cfg)
    tds=FaceDataset(ti,get_train_transform(cfg.SZ)); vds=FaceDataset(vi,get_val_transform(cfg.SZ))
    tl=DataLoader(tds,batch_size=cfg.BS,shuffle=True,num_workers=cfg.WORKERS,pin_memory=True,drop_last=True)
    vl=DataLoader(vds,batch_size=cfg.BS*2,shuffle=False,num_workers=cfg.WORKERS,pin_memory=True)
    log.info(f"Train: {len(tds)}, Val: {len(vds)}")
    model=DeepCheckV5_V2(dropout=cfg.DROPOUT).to(dev)
    log.info(f"Params: {sum(p.numel() for p in model.parameters())/1e6:.1f}M")
    crit=LabelSmoothBCE(cfg.LABEL_SMOOTH).to(dev)
    opt=torch.optim.AdamW([
        {'params':list(model.backbone.parameters()),'lr':cfg.LR*0.1},
        {'params':list(model.freq.parameters())+list(model.head.parameters()),'lr':cfg.LR}],weight_decay=cfg.WD)
    sched=torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(opt,T_0=20,T_mult=2,eta_min=1e-6)
    scaler=torch.amp.GradScaler('cuda'); ema=EMA(model,cfg.EMA_DECAY); best_auc=0; patience=0

    for epoch in range(1,cfg.EPOCHS+1):
        t0=time.time()
        tlo,ta=train_epoch(model,tl,opt,crit,scaler,dev,cfg,epoch)
        sched.step(); ema.update(model)
        orig={k:v.clone() for k,v in model.state_dict().items()}
        ema.apply(model); vlo,va,auc,eer=validate(model,vl,crit,dev); model.load_state_dict(orig)
        lr=opt.param_groups[0]['lr']; dt=time.time()-t0
        log.info(f"E {epoch}/{cfg.EPOCHS} TL:{tlo:.4f} TA:{ta:.4f} VL:{vlo:.4f} VA:{va:.4f} AUC:{auc:.6f} EER:{eer:.4f} LR:{lr:.6f} {dt:.0f}s")
        with open(mf,"a") as f: f.write(json.dumps({"epoch":epoch,"train_loss":tlo,"train_acc":ta,"val_loss":vlo,"val_acc":va,"auc":auc,"eer":eer,"lr":lr,"time":dt,"model":"efficientnetv2_s"})+"\n")
        if auc>best_auc:
            best_auc=auc; patience=0; ema.apply(model)
            torch.save(model.state_dict(),cfg.OUT/"best_v5_effnetv2.pt"); model.load_state_dict(orig)
            log.info(f"  >>> BEST AUC:{auc:.6f} EER:{eer:.4f}")
            try: ema.apply(model); export_onnx(model,cfg.OUT/"deepfake_pixel_v5_effnetv2.onnx",dev); model.load_state_dict(orig)
            except Exception as e: log.warning(f"  ONNX fail: {e}"); model.load_state_dict(orig)
        else:
            patience+=1
            if patience>=25: log.info(f"Early stop at {epoch}"); break
        if epoch%10==0: torch.save({'epoch':epoch,'model':model.state_dict(),'ema':ema.state_dict(),'best_auc':best_auc},cfg.OUT/f"ckpt_e{epoch}.pt")

    log.info(f"Done. Best AUC: {best_auc:.6f}")
    model.load_state_dict(torch.load(cfg.OUT/"best_v5_effnetv2.pt",weights_only=True))
    try: export_onnx(model,cfg.OUT/"deepfake_pixel_v5_effnetv2_final.onnx",dev)
    except Exception as e: log.warning(f"Final ONNX fail: {e}")
    os.system(f"aws s3 cp {cfg.OUT}/best_v5_effnetv2.pt s3://deep-check-models/deepfake/v5/best_v5_effnetv2.pt")
    if (cfg.OUT/"deepfake_pixel_v5_effnetv2_final.onnx").exists():
        os.system(f"aws s3 cp {cfg.OUT}/deepfake_pixel_v5_effnetv2_final.onnx s3://deep-check-models/deepfake/v5/deepfake_pixel_v5_effnetv2.onnx")

if __name__=="__main__": main()
