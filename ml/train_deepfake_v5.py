#!/usr/bin/env python3
"""
Deep-Check V5 — Deepfake Pixel Detector (Browser-Deployable)
=============================================================
Architecture: EfficientNet-B4 + FrequencyBranchV2 (~70MB ONNX, same as V3)
Key fix: Diverse REAL images to eliminate domain gap.

Real:  LFW + WiderFace + CelebA + DFDC-real + CIFAKE-real + 140K-real
Fake:  StyleGAN2 + CIFAKE-AI + DFDC-fake + RAF-fake
Augmentation: Social media simulation (JPEG, noise, color shifts)
Training: Focal Loss + Mixup/CutMix + EMA + Cosine Annealing
"""
import os, sys, json, hashlib, random, logging, time, io
from pathlib import Path
from collections import Counter
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torchvision import transforms
from PIL import Image, ImageEnhance
import timm

# ── Config ─────────────────────────────────────────────────
class C:
    DATA  = Path(os.environ.get("DATA_ROOT", "/home/ubuntu/data"))
    OUT   = Path(os.environ.get("OUTPUT_DIR", "/home/ubuntu/training/v5"))
    BACKBONE = "efficientnet_b4"
    SZ = 224; BS = 32; EPOCHS = 150; LR = 1e-4; WD = 1e-4
    WARMUP = 5; LS = 0.05; FOCAL_G = 2.0
    MIXUP_A = 0.2; CUTMIX_A = 1.0; EMA_D = 0.999
    VAL = 0.1; CAP = 50000; WORKERS = 8
    ONNX_OP = 17; PATIENCE = 20

C.OUT.mkdir(parents=True, exist_ok=True)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s',
    handlers=[logging.StreamHandler(), logging.FileHandler(C.OUT/"train.log")])
log = logging.getLogger()

# ── Model ──────────────────────────────────────────────────
class FreqBranch(nn.Module):
    def __init__(self, scales=(1,2,4), dim=128):
        super().__init__()
        self.scales = scales
        self.conv = nn.Sequential(
            nn.Conv2d(len(scales)*3, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(True),
            nn.AdaptiveAvgPool2d(7),
            nn.Conv2d(64, dim, 3, padding=1), nn.BatchNorm2d(dim), nn.ReLU(True),
            nn.AdaptiveAvgPool2d(1), nn.Flatten())
    def _lap(self, x, s):
        if s > 1:
            x = F.interpolate(F.interpolate(x, scale_factor=1/s, mode='bilinear', align_corners=False),
                              scale_factor=s, mode='bilinear', align_corners=False)
        k = torch.tensor([[0,1,0],[1,-4,1],[0,1,0]], dtype=x.dtype, device=x.device)
        k = k[None,None].repeat(x.size(1),1,1,1)
        return F.conv2d(x, k, padding=1, groups=x.size(1))
    def forward(self, x):
        return self.conv(torch.cat([self._lap(x,s) for s in self.scales], 1))

class DetectorV5(nn.Module):
    def __init__(self):
        super().__init__()
        self.bb = timm.create_model(C.BACKBONE, pretrained=True, num_classes=0)
        d = self.bb.num_features
        self.freq = FreqBranch()
        self.head = nn.Sequential(
            nn.Linear(d+128, 512), nn.BatchNorm1d(512), nn.ReLU(True), nn.Dropout(0.3),
            nn.Linear(512, 128), nn.BatchNorm1d(128), nn.ReLU(True), nn.Dropout(0.2),
            nn.Linear(128, 1))
    def forward(self, x):
        return self.head(torch.cat([self.bb(x), self.freq(x)], 1)).squeeze(-1)

class EMA:
    def __init__(self, m, d=0.999):
        self.d = d; self.s = {k:v.clone() for k,v in m.state_dict().items()}
    def update(self, m):
        for k,v in m.state_dict().items(): self.s[k] = self.d*self.s[k]+(1-self.d)*v
    def apply(self, m): m.load_state_dict(self.s)
    def state_dict(self): return self.s

class FocalLoss(nn.Module):
    def __init__(self, g=2.0, ls=0.05):
        super().__init__(); self.g=g; self.ls=ls
    def forward(self, logits, t):
        ts = t*(1-self.ls)+0.5*self.ls
        bce = F.binary_cross_entropy_with_logits(logits, ts, reduction='none')
        pt = torch.where(t>0.5, torch.sigmoid(logits), 1-torch.sigmoid(logits))
        return ((1-pt)**self.g * bce).mean()

# ── Augmentation ───────────────────────────────────────────
class SocialMedia:
    def __call__(self, img):
        if random.random()<0.3:
            w,h=img.size; s=random.uniform(0.4,0.7)
            img=img.resize((int(w*s),int(h*s)),Image.BILINEAR).resize((w,h),Image.BILINEAR)
        if random.random()<0.4:
            buf=io.BytesIO(); img.save(buf,'JPEG',quality=random.randint(30,75))
            buf.seek(0); img=Image.open(buf).convert('RGB')
        if random.random()<0.2:
            img=ImageEnhance.Color(img).enhance(random.uniform(0.8,1.3))
            img=ImageEnhance.Brightness(img).enhance(random.uniform(0.85,1.15))
        if random.random()<0.15:
            a=np.array(img,dtype=np.float32)
            a=np.clip(a+np.random.normal(0,random.uniform(3,12),a.shape),0,255).astype(np.uint8)
            img=Image.fromarray(a)
        return img

class TrainAug:
    def __init__(self):
        self.sm=SocialMedia()
        self.t=transforms.Compose([
            transforms.RandomResizedCrop(C.SZ, scale=(0.8,1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomApply([transforms.ColorJitter(0.2,0.2,0.1,0.05)],p=0.3),
            transforms.RandomGrayscale(p=0.05),
            transforms.RandomApply([transforms.GaussianBlur(5,(0.1,2.0))],p=0.1),
            transforms.ToTensor(),
            transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225]),
            transforms.RandomErasing(p=0.1)])
    def __call__(self,img):
        if random.random()<0.3: img=self.sm(img)
        return self.t(img)

ValAug=transforms.Compose([
    transforms.Resize(int(C.SZ*1.1)), transforms.CenterCrop(C.SZ),
    transforms.ToTensor(), transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])

# ── Dataset ────────────────────────────────────────────────
def fhash(p):
    h=hashlib.sha256();
    with open(p,'rb') as f: h.update(f.read(65536))
    return h.hexdigest()

def collect(root, label, cap=50000):
    exts={'.jpg','.jpeg','.png','.webp','.bmp'}
    fs=[(str(p),label) for p in Path(root).rglob('*') if p.suffix.lower() in exts]
    random.shuffle(fs); return fs[:cap]

def find_sub(root, names):
    for n in names:
        p=Path(root)/n
        if p.exists(): return p
        ms=list(Path(root).rglob(n))
        if ms: return ms[0]
    return None

class DS(Dataset):
    def __init__(self, samples, tf=None):
        self.s=samples; self.tf=tf
    def __len__(self): return len(self.s)
    def __getitem__(self, i):
        try:
            img=Image.open(self.s[i][0]).convert('RGB')
            if self.tf: img=self.tf(img)
            return img, torch.tensor(self.s[i][1], dtype=torch.float32)
        except: return self[random.randint(0,len(self)-1)]

# ── Data Pipeline ──────────────────────────────────────────
def dl_kaggle(slug, dest):
    """Download a kaggle dataset safely using subprocess."""
    import subprocess
    dest.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["kaggle","datasets","download","-d",slug,"-p",str(dest),"--unzip","--quiet"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        log.warning(f"[WARN] Failed {slug}: {r.stderr[:200]}")
    return r.returncode

def download():
    d=C.DATA; d.mkdir(parents=True, exist_ok=True)
    kgs=[
        # Real + Fake mixed datasets
        ("ciplab/real-and-fake-face-detection","real-and-fake-face"),           # 1
        ("xhlulu/140k-real-and-fake-faces","140k-faces"),                       # 2
        ("birdy654/cifake-real-and-ai-generated-synthetic-images","cifake"),     # 3
        ("hamzafarooq0/dfdc-faces-extracted","dfdc-faces"),                     # 4
        # Real diverse datasets
        ("jessicali9530/celeba-dataset","celeba"),                              # 5
        ("unkownhihi/widerface","widerface"),                                   # 6
        # GAN / AI-generated datasets
        ("xhlulu/flickr-faces-hq-fid-comparison","ffhq-stylegan"),             # 7
        ("greatgamedota/ffhq-face-data-set","ffhq-real"),                      # 8
        ("arnaud58/landscape-pictures","landscape-real"),                       # 9
        ("superpotato9/dalle-recognition-dataset","dalle-faces"),               # 10
        ("shahzaibbaloch10/ai-generated-images","ai-generated-misc"),           # 11
        ("danielmao2573/deepfakedetection","deepfake-detection"),               # 12
        ("dagnelies/deepfake-faces","deepfake-faces"),                          # 13
    ]
    for slug,name in kgs:
        dest=d/name
        if dest.exists() and any(dest.iterdir()):
            log.info(f"[SKIP] {name}"); continue
        log.info(f"[DL] {slug}")
        dl_kaggle(slug, dest)
    # LFW (direct — not on Kaggle)
    import subprocess
    lfw=d/"lfw"
    if not lfw.exists() or not any(lfw.rglob("*.jpg")):
        log.info("[DL] LFW (direct)"); lfw.mkdir(parents=True, exist_ok=True)
        subprocess.run(["wget","-q","http://vis-www.cs.umass.edu/lfw/lfw.tgz","-P",str(lfw)])
        subprocess.run(["tar","xzf",str(lfw/"lfw.tgz"),"-C",str(lfw)])
        (lfw/"lfw.tgz").unlink(missing_ok=True)

def build_data():
    d=C.DATA; R=[]; F=[]

    # ── REAL sources (13 diverse sources) ──

    # 1. CelebA — 200K celebrity photos
    p=d/"celeba"/"img_align_celeba"
    if p.exists(): r=collect(p,0,40000); log.info(f"CelebA: {len(r)} real"); R+=r

    # 2. FFHQ real — 70K Flickr high-quality faces
    p=d/"ffhq-real"/"thumbnails128x128"
    if p.exists(): r=collect(p,0,30000); log.info(f"FFHQ-real: {len(r)} real"); R+=r

    # 3. Human Faces — diverse real faces
    p=d/"human-faces"/"Humans"
    if p.exists(): r=collect(p,0,20000); log.info(f"HumanFaces: {len(r)} real"); R+=r

    # 4. Landscape real — real scene photos (non-face)
    p=d/"landscape-real"
    if p.exists(): r=collect(p,0,10000); log.info(f"Landscape: {len(r)} real"); R+=r

    # 5. 140K real faces (FFHQ subset)
    p=find_sub(d/"140k-faces",["real_vs_fake/real-vs-fake/real","real_faces","real"])
    if not p: p=find_sub(d/"140k-faces",["real_vs_fake"])  # try deeper
    if p: r=collect(p,0,40000); log.info(f"140K-real: {len(r)}"); R+=r

    # 6. RAF real
    p=find_sub(d/"real-and-fake-face",["real_and_fake_face/training_real","real_and_fake_face_detection/real","real","training_real"])
    if p: r=collect(p,0,10000); log.info(f"RAF-real: {len(r)}"); R+=r

    # 7. CIFAKE real
    p=find_sub(d/"cifake",["train/REAL","test/REAL","REAL"])
    if p: r=collect(p,0,20000); log.info(f"CIFAKE-real: {len(r)}"); R+=r

    # 8. GRAVEX-200K real
    p=find_sub(d/"gravex-200k",["my_real_vs_ai_dataset/my_real_vs_ai_dataset/real","my_real_vs_ai_dataset/real","real"])
    if p: r=collect(p,0,40000); log.info(f"GRAVEX-real: {len(r)}"); R+=r

    # 9. FaceForensics++ real
    p=find_sub(d/"faceforensics",["dataset_processed_split/train/real","train/real","real"])
    if p: r=collect(p,0,20000); log.info(f"FF++-real: {len(r)}"); R+=r

    # 10. AI Faces HQ real
    p=d/"ai-faces-hq"/"AI-face-detection-Dataset"/"real"
    if p.exists(): r=collect(p,0,10000); log.info(f"AIFacesHQ-real: {len(r)}"); R+=r

    # 11. StyleGAN dataset Real
    p=d/"stylegan-faces"/"Final Dataset"/"Real"
    if p.exists(): r=collect(p,0,10000); log.info(f"StyleGAN-real: {len(r)}"); R+=r

    # ── FAKE sources (diverse generators) ──

    # 1. 140K fakes (StyleGAN2)
    p=find_sub(d/"140k-faces",["real_vs_fake/real-vs-fake/fake","fake_faces","fake"])
    if not p: p=find_sub(d/"140k-faces",["real_vs_fake"])
    if p: f=collect(p,1,40000); log.info(f"140K-fake: {len(f)}"); F+=f

    # 2. CIFAKE AI-generated
    p=find_sub(d/"cifake",["train/FAKE","test/FAKE","FAKE"])
    if p: f=collect(p,1,30000); log.info(f"CIFAKE-fake: {len(f)}"); F+=f

    # 3. RAF fake
    p=find_sub(d/"real-and-fake-face",["real_and_fake_face/training_fake","real_and_fake_face_detection/fake","fake","training_fake"])
    if p: f=collect(p,1,10000); log.info(f"RAF-fake: {len(f)}"); F+=f

    # 4. GRAVEX-200K AI
    p=find_sub(d/"gravex-200k",["my_real_vs_ai_dataset/my_real_vs_ai_dataset/ai","my_real_vs_ai_dataset/ai","ai"])
    if p: f=collect(p,1,40000); log.info(f"GRAVEX-fake: {len(f)}"); F+=f

    # 5. FaceForensics++ fakes (multiple generators)
    p=find_sub(d/"faceforensics",["dataset_processed_split/train/fake","train/fake","fake"])
    if p: f=collect(p,1,30000); log.info(f"FF++-fake: {len(f)}"); F+=f

    # 6. AI Faces HQ fake
    p=d/"ai-faces-hq"/"AI-face-detection-Dataset"/"AI"
    if p.exists(): f=collect(p,1,10000); log.info(f"AIFacesHQ-fake: {len(f)}"); F+=f

    # 7. StyleGAN faces Fake
    p=d/"stylegan-faces"/"Final Dataset"/"Fake"
    if p.exists(): f=collect(p,1,10000); log.info(f"StyleGAN-fake: {len(f)}"); F+=f

    # 8. Deepfake faces (faces_224 — all fake)
    p=d/"deepfake-faces"/"faces_224"
    if p.exists(): f=collect(p,1,15000); log.info(f"DFfaces: {len(f)}"); F+=f

    log.info(f"\nRaw: {len(R)} real + {len(F)} fake")
    if not R or not F: log.error("No data!"); sys.exit(1)

    # Dedup
    seen=set(); dedup=[]
    for p,l in R+F:
        try:
            h=fhash(p)
            if h not in seen: seen.add(h); dedup.append((p,l))
        except: pass
    log.info(f"After dedup: {len(dedup)}")

    # Balance
    rs=[(p,l) for p,l in dedup if l==0]; fs=[(p,l) for p,l in dedup if l==1]
    cap=min(len(rs),len(fs),120000)
    random.shuffle(rs); random.shuffle(fs)
    rs=rs[:cap]; fs=fs[:cap]
    log.info(f"Balanced: {cap} per class = {2*cap} total")

    # Split
    all_s=rs+fs; random.shuffle(all_s)
    vs=int(len(all_s)*C.VAL)
    return all_s[vs:], all_s[:vs]

# ── Mixup/CutMix ──────────────────────────────────────────
def mixup(x,y,a=0.2):
    l=np.random.beta(a,a); i=torch.randperm(x.size(0),device=x.device)
    return l*x+(1-l)*x[i], l*y+(1-l)*y[i]

def cutmix(x,y,a=1.0):
    l=np.random.beta(a,a); i=torch.randperm(x.size(0),device=x.device)
    B,_,H,W=x.shape; r=np.sqrt(1-l); cw,ch=int(W*r),int(H*r)
    cx,cy=random.randint(0,W),random.randint(0,H)
    x1,y1=max(0,cx-cw//2),max(0,cy-ch//2); x2,y2=min(W,cx+cw//2),min(H,cy+ch//2)
    x[:,:,y1:y2,x1:x2]=x[i,:,y1:y2,x1:x2]
    l=1-(x2-x1)*(y2-y1)/(W*H)
    return x, l*y+(1-l)*y[i]

# ── Training ───────────────────────────────────────────────
def train_ep(model, loader, opt, crit, dev, ep):
    model.train(); tot=0; cor=0; n=0
    for bi,(img,lab) in enumerate(loader):
        img,lab=img.to(dev),lab.to(dev)
        if ep>C.WARMUP and random.random()<0.5:
            img,lab = (mixup if random.random()<0.5 else cutmix)(img,lab)
        opt.zero_grad(); lo=model(img); loss=crit(lo,lab)
        loss.backward(); nn.utils.clip_grad_norm_(model.parameters(),1.0); opt.step()
        tot+=loss.item(); cor+=((torch.sigmoid(lo)>0.5).float()==(lab>0.5).float()).sum().item(); n+=lab.size(0)
        if bi%100==0: log.info(f"  B{bi}/{len(loader)} L:{loss.item():.4f}")
    return tot/len(loader), cor/n

@torch.no_grad()
def val_ep(model, loader, crit, dev):
    model.eval(); tot=0; probs=[]; labs=[]
    for img,lab in loader:
        img,lab=img.to(dev),lab.to(dev)
        lo=model(img); tot+=crit(lo,lab).item()
        probs.extend(torch.sigmoid(lo).cpu().numpy()); labs.extend(lab.cpu().numpy())
    probs,labs=np.array(probs),np.array(labs)
    acc=((probs>0.5)==labs).mean()
    try:
        from sklearn.metrics import roc_auc_score, roc_curve
        auc=roc_auc_score(labs,probs)
        fpr,tpr,_=roc_curve(labs,probs); fnr=1-tpr
        eer=(fpr[np.nanargmin(np.abs(fpr-fnr))]+fnr[np.nanargmin(np.abs(fpr-fnr))])/2
    except: auc,eer=0.0,1.0
    return tot/len(loader),acc,auc,eer

def export_onnx(model, path, dev):
    model.eval()
    torch.onnx.export(model, torch.randn(1,3,C.SZ,C.SZ,device=dev), str(path),
        input_names=["face_image"], output_names=["logit"], opset_version=C.ONNX_OP,
        dynamic_axes={"face_image":{0:"batch"},"logit":{0:"batch"}})
    log.info(f"ONNX: {path} ({os.path.getsize(path)/1e6:.1f}MB)")

def main():
    log.info("="*50+"\nDeep-Check V5 Training\n"+"="*50)
    dev=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if torch.cuda.is_available():
        log.info(f"GPU: {torch.cuda.get_device_name()} ({torch.cuda.get_device_properties(0).total_memory/1e9:.1f}GB)")

    download()
    tr,vl=build_data()
    tr_ds=DS(tr,TrainAug()); vl_ds=DS(vl,ValAug)
    labs=[l for _,l in tr]; wts=[1.0/Counter(labs)[l] for _,l in tr]
    tr_dl=DataLoader(tr_ds,C.BS,sampler=WeightedRandomSampler(wts,len(wts)),num_workers=C.WORKERS,pin_memory=True,drop_last=True)
    vl_dl=DataLoader(vl_ds,C.BS*2,False,num_workers=C.WORKERS,pin_memory=True)

    model=DetectorV5().to(dev)
    log.info(f"Params: {sum(p.numel() for p in model.parameters())/1e6:.1f}M")
    opt=torch.optim.AdamW(model.parameters(),C.LR,weight_decay=C.WD)
    sched=torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(opt,20,2,1e-6)
    crit=FocalLoss(C.FOCAL_G,C.LS); ema=EMA(model,C.EMA_D)

    best_auc=0; best_eer=1; noimpr=0
    for ep in range(1,C.EPOCHS+1):
        t0=time.time()
        if ep<=C.WARMUP:
            for pg in opt.param_groups: pg['lr']=C.LR*ep/C.WARMUP
        tl,ta=train_ep(model,tr_dl,opt,crit,dev,ep)
        ema.update(model)
        if ep>C.WARMUP: sched.step()

        orig={k:v.clone() for k,v in model.state_dict().items()}
        ema.apply(model)
        vl_l,va,vauc,veer=val_ep(model,vl_dl,crit,dev)
        model.load_state_dict(orig)

        log.info(f"E{ep:3d}/{C.EPOCHS} TL:{tl:.4f} TA:{ta:.4f} VL:{vl_l:.4f} VA:{va:.4f} AUC:{vauc:.6f} EER:{veer:.4f} LR:{opt.param_groups[0]['lr']:.6f} {time.time()-t0:.0f}s")

        if vauc>best_auc or (vauc==best_auc and veer<best_eer):
            best_auc=vauc; best_eer=veer; noimpr=0
            ema.apply(model)
            torch.save({'ep':ep,'state':model.state_dict(),'auc':vauc,'eer':veer},C.OUT/"best.pt")
            export_onnx(model,C.OUT/"deepfake_pixel_v5.onnx",dev)
            model.load_state_dict(orig)
            log.info(f"  >>> BEST AUC:{vauc:.6f} EER:{veer:.4f}")
        else: noimpr+=1

        if ep%10==0:
            torch.save({'ep':ep,'state':model.state_dict(),'ema':ema.state_dict()},C.OUT/f"ckpt_{ep}.pt")
        with open(C.OUT/"metrics.jsonl",'a') as f:
            f.write(json.dumps({'ep':ep,'tl':tl,'ta':ta,'vl':vl_l,'va':va,'auc':vauc,'eer':veer})+'\n')
        if noimpr>=C.PATIENCE: log.info(f"Early stop ep {ep}"); break

    # Final
    ckpt=torch.load(C.OUT/"best.pt",weights_only=False)
    model.load_state_dict(ckpt['state'])
    export_onnx(model,C.OUT/"deepfake_pixel_v5_final.onnx",dev)
    os.system(f"aws s3 cp {C.OUT}/deepfake_pixel_v5_final.onnx s3://deep-check-models/deepfake/deepfake_pixel_v5.onnx")
    os.system(f"aws s3 cp {C.OUT}/best.pt s3://deep-check-models/deepfake/v5_best.pt")
    log.info(f"\nDONE — Best AUC:{best_auc:.6f} EER:{best_eer:.4f}")

if __name__=='__main__': main()
