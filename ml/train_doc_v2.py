#!/usr/bin/env python3
"""
Deep-Check Doc Forensics V2 -- DINOv2 + FreqBranch + SRM
==========================================================
Improvements over V1: FrequencyBranch, SRM, higher LR, 6 blocks unfreeze, 500K+ data
Target: val_auc > 0.98, val_eer < 5%
"""

import os, sys, time, hashlib, logging, json, io, random, copy, math
from pathlib import Path
from dataclasses import dataclass, field
from collections import defaultdict

import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torchvision import transforms
from PIL import Image
import timm

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

@dataclass
class C:
    SZ: int = 224
    BS_FROZEN: int = 64
    BS_FINETUNE: int = 24
    EPOCHS: int = 80
    LR: float = 1e-3
    LR_FINETUNE: float = 3e-5
    LR_FINETUNE_HEAD: float = 3e-4
    WD: float = 0.01
    LABEL_SMOOTH: float = 0.03
    EMA_DECAY: float = 0.999
    UNFREEZE_EPOCH: int = 8
    UNFREEZE_BLOCKS: int = 6
    GRAD_CLIP: float = 1.0
    WORKERS: int = 4
    FOCAL_GAMMA: float = 2.0
    DATA: Path = Path("/home/ubuntu/data")
    OUT: Path = Path("/home/ubuntu/training/doc_v2")
    METRIC_FILE: str = "metrics.jsonl"
    S3_METRICS: str = "s3://deep-check-models/training/doc_v2/metrics.jsonl"
    S3_BEST: str = "s3://deep-check-models/doc_forensics/v2/best_doc_v2.pt"
    VAL_SOURCES: list = field(default_factory=lambda: ["set4", "val"])


def compute_ela(img_bgr, quality=90):
    enc_param = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    _, buf = cv2.imencode('.jpg', img_bgr, enc_param)
    resaved = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    ela = cv2.absdiff(img_bgr, resaved).astype(np.float32)
    return np.clip(ela * 15.0, 0, 255).astype(np.uint8)

def compute_multi_ela(img_bgr):
    ela90 = compute_ela(img_bgr, quality=90)
    ela70 = compute_ela(img_bgr, quality=70)
    ela50 = compute_ela(img_bgr, quality=50)
    ela = ((ela90.astype(np.float32) + ela70.astype(np.float32) + ela50.astype(np.float32)) / 3.0)
    return np.clip(ela, 0, 255).astype(np.uint8)


def get_train_tf(sz):
    return transforms.Compose([
        transforms.RandomResizedCrop(sz, scale=(0.6, 1.0)),
        transforms.RandomHorizontalFlip(0.5),
        transforms.RandomVerticalFlip(0.2),
        transforms.RandomApply([transforms.ColorJitter(0.3, 0.3, 0.2, 0.1)], p=0.4),
        transforms.RandomGrayscale(p=0.1),
        transforms.RandomApply([transforms.GaussianBlur(5, sigma=(0.1, 2.0))], p=0.2),
    ])

def get_val_tf(sz):
    return transforms.Compose([
        transforms.Resize(int(sz * 1.15)),
        transforms.CenterCrop(sz),
    ])


def file_hash(p):
    try:
        sz = os.path.getsize(p)
        h = hashlib.md5(str(sz).encode())
        with open(p, "rb") as f:
            h.update(f.read(4096))
        return h.hexdigest()
    except Exception:
        return str(p)


def scan_dataset(root):
    MAPS = [
        # forensics-rf: "Data Set X/Data Set X/{train,test,validation}/{real,fake}"
        ("forensics-rf/Data Set 1/**/real/**", 0),
        ("forensics-rf/Data Set 1/**/fake/**", 1),
        ("forensics-rf/Data Set 2/**/real/**", 0),
        ("forensics-rf/Data Set 2/**/fake/**", 1),
        ("forensics-rf/Data Set 3/**/real/**", 0),
        ("forensics-rf/Data Set 3/**/fake/**", 1),
        ("forensics-rf/Data Set 4/**/real/**", 0),  # VAL
        ("forensics-rf/Data Set 4/**/fake/**", 1),  # VAL
        ("casia/**/Au/**", 0),
        ("casia/**/Tp/**", 1),
        ("casia/**/authentic/**", 0),
        ("casia/**/tampered/**", 1),
        ("casia-extra/**/Au/**", 0),
        ("casia-extra/**/Tp/**", 1),
        ("casia-v2-alt/**/Au/**", 0),
        ("casia-v2-alt/**/Tp/**", 1),
        ("defacto-copymove/**/img/**", 1),
        ("defacto-copymove/**/probe/**", 1),
        ("defacto-inpainting/**/img/**", 1),
        ("defacto-inpainting/**/probe/**", 1),
        ("defacto-splicing/**/img/**", 1),
        ("defacto-splicing/**/probe/**", 1),
        ("sci-forgery/**/forged/**", 1),
        ("sci-forgery/**/Forged/**", 1),
        ("sci-forgery/**/fake/**", 1),
        ("sci-forgery/**/original/**", 0),
        ("sci-forgery/**/Original/**", 0),
        ("sci-forgery/**/real/**", 0),
        ("sci-forgery/**/pristine/**", 0),
        ("cg1050/**/CG/**", 1),
        ("cg1050/**/PG/**", 0),
        ("landscape-real/**", 0),
        # Synthetic manipulations (generated from real images)
        ("synthetic-manip/**", 1),
        # FaceForensics++ (additional forgery data)
        ("faceforensics/**/real/**", 0),
        ("faceforensics/**/fake/**", 1),
        ("faceforensics/**/original/**", 0),
        ("faceforensics/**/manipulated/**", 1),
    ]
    exts = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
    data = defaultdict(list)
    hashes = set()
    import glob as g
    for pat, lab in MAPS:
        ms = g.glob(str(root / pat), recursive=True)
        src_key = pat.split("/")[0]
        if "Set 4" in pat or "Set4" in pat or "val" in pat.lower():
            src_key = "set4"
        cnt = 0
        for m in ms:
            p = Path(m)
            if not p.is_file() or p.suffix.lower() not in exts:
                continue
            if p.stat().st_size < 1024:
                continue
            h = file_hash(str(p))
            if h in hashes:
                continue
            hashes.add(h)
            data[src_key].append((str(p), lab))
            cnt += 1
        if cnt > 0:
            lab_name = "REAL" if lab == 0 else "FAKE"
            log.info(f"  {pat}: {cnt} images ({lab_name})")
    return data


def split_data(data, val_sources):
    train, val = [], []
    val_src = set(s.lower() for s in val_sources)
    for src, items in data.items():
        if src.lower() in val_src or any(vs in src.lower() for vs in val_src):
            val.extend(items)
        else:
            train.extend(items)
    return train, val


class DocForensicsDataset(Dataset):
    def __init__(self, items, sz, train=True):
        self.items = items
        self.sz = sz
        self.train = train
        self.tf = get_train_tf(sz) if train else get_val_tf(sz)
        self.normalize = transforms.Normalize(
            [0.485, 0.456, 0.406, 0.485, 0.456, 0.406],
            [0.229, 0.224, 0.225, 0.229, 0.224, 0.225]
        )
    def __len__(self):
        return len(self.items)
    def __getitem__(self, i):
        path, label = self.items[i]
        try:
            img_bgr = cv2.imread(path)
            if img_bgr is None:
                raise ValueError("bad image")
            img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
            ela = compute_multi_ela(img_bgr)
            ela_rgb = cv2.cvtColor(ela, cv2.COLOR_BGR2RGB) if len(ela.shape) == 3 else ela
            pil_rgb = Image.fromarray(img_rgb)
            pil_ela = Image.fromarray(ela_rgb)
            seed = random.randint(0, 2**32)
            random.seed(seed); torch.manual_seed(seed)
            pil_rgb = self.tf(pil_rgb)
            random.seed(seed); torch.manual_seed(seed)
            pil_ela = self.tf(pil_ela)
            rgb_t = transforms.ToTensor()(pil_rgb)
            ela_t = transforms.ToTensor()(pil_ela)
            x = torch.cat([rgb_t, ela_t], dim=0)
            if self.train and random.random() < 0.1:
                x = transforms.RandomErasing(p=1.0, scale=(0.02, 0.15))(x)
            x = self.normalize(x)
            return x, label
        except Exception:
            j = random.randint(0, len(self.items) - 1)
            return self.__getitem__(j)


class FrequencyBranchV3(nn.Module):
    def __init__(self, in_ch=6, out_dim=48):
        super().__init__()
        self.scales = [32, 64, 128, 224]
        self.encoders = nn.ModuleList([nn.Sequential(
            nn.Conv2d(in_ch, 24, 3, padding=1), nn.GELU(),
            nn.Conv2d(24, 24, 3, padding=1), nn.GELU(),
            nn.AdaptiveAvgPool2d(4),
        ) for _ in range(4)])
        self.proj = nn.Linear(24 * 4 * 4 * 4, out_dim)
    def forward(self, x):
        feats = []
        for i, sz in enumerate(self.scales):
            xf = F.interpolate(x, size=(sz, sz), mode='bilinear', align_corners=False)
            hp = xf - F.avg_pool2d(xf, 3, 1, 1)
            feats.append(self.encoders[i](hp).flatten(1))
        return self.proj(torch.cat(feats, 1))


class SRMBranch(nn.Module):
    def __init__(self, out_dim=32):
        super().__init__()
        self.srm_conv = nn.Conv2d(1, 9, 5, padding=2, bias=False)
        with torch.no_grad():
            k = torch.zeros(9, 1, 5, 5)
            k[0,0,2,1]=1; k[0,0,2,2]=-1
            k[1,0,1,2]=1; k[1,0,2,2]=-1
            k[2,0,1,2]=1; k[2,0,2,1]=1; k[2,0,2,2]=-4; k[2,0,2,3]=1; k[2,0,3,2]=1
            k[3,0,1,1]=1; k[3,0,1,3]=1; k[3,0,2,2]=-4; k[3,0,3,1]=1; k[3,0,3,3]=1
            k[4,0,1,1]=-1; k[4,0,1,2]=2; k[4,0,1,3]=-1; k[4,0,2,1]=2; k[4,0,2,2]=-4; k[4,0,2,3]=2; k[4,0,3,1]=-1; k[4,0,3,2]=2; k[4,0,3,3]=-1
            k[5,0]=torch.tensor([[0,0,-1,0,0],[0,-1,-2,-1,0],[-1,-2,16,-2,-1],[0,-1,-2,-1,0],[0,0,-1,0,0]],dtype=torch.float32)
            k[6,0,1,1]=1; k[6,0,2,2]=-1
            k[7,0,1,3]=1; k[7,0,2,2]=-1
            k[8,0]=torch.tensor([[-1,-2,0,2,1],[-4,-8,0,8,4],[-6,-12,0,12,6],[-4,-8,0,8,4],[-1,-2,0,2,1]],dtype=torch.float32)/12
            self.srm_conv.weight = nn.Parameter(k)
        self.srm_conv.weight.requires_grad = False
        self.encoder = nn.Sequential(
            nn.Conv2d(9, 32, 3, padding=1), nn.GELU(),
            nn.Conv2d(32, 32, 3, stride=2, padding=1), nn.GELU(),
            nn.AdaptiveAvgPool2d(4),
        )
        self.proj = nn.Linear(32*4*4, out_dim)
    def forward(self, x):
        gray = 0.299*x[:,0:1]+0.587*x[:,1:2]+0.114*x[:,2:3]
        return self.proj(self.encoder(self.srm_conv(gray)).flatten(1))


class DocForensicsV2(nn.Module):
    def __init__(self, dropout=0.25):
        super().__init__()
        self.backbone = timm.create_model("vit_large_patch14_dinov2.lvd142m",
            pretrained=True, num_classes=0, dynamic_img_size=True, img_size=224)
        feat_dim = self.backbone.num_features
        old_pe = self.backbone.patch_embed.proj
        new_pe = nn.Conv2d(6, old_pe.out_channels, old_pe.kernel_size,
                           stride=old_pe.stride, padding=old_pe.padding)
        with torch.no_grad():
            new_pe.weight[:,:3] = old_pe.weight
            new_pe.weight[:,3:] = old_pe.weight * 0.1
            new_pe.bias = old_pe.bias
        self.backbone.patch_embed.proj = new_pe
        self.freq = FrequencyBranchV3(in_ch=6, out_dim=48)
        self.srm = SRMBranch(out_dim=32)
        total_dim = feat_dim + 48 + 32
        log.info(f"DocV2: DINOv2({feat_dim}) + Freq(48) + SRM(32) = {total_dim}")
        self.head = nn.Sequential(
            nn.LayerNorm(total_dim), nn.Dropout(dropout),
            nn.Linear(total_dim, 512), nn.GELU(), nn.Dropout(dropout*0.5),
            nn.Linear(512, 256), nn.GELU(), nn.Linear(256, 1),
        )
        for p in self.backbone.parameters():
            p.requires_grad = False
        for p in self.backbone.patch_embed.parameters():
            p.requires_grad = True
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        total_p = sum(p.numel() for p in self.parameters())
        log.info(f"Trainable: {trainable/1e6:.1f}M / {total_p/1e6:.1f}M")

    def forward(self, x):
        sem = self.backbone(x)
        freq = self.freq(x)
        srm = self.srm(x)
        return self.head(torch.cat([sem, freq, srm], dim=1)).squeeze(-1)

    def unfreeze_last_n(self, n=6):
        blocks = self.backbone.blocks
        for i in range(len(blocks)-n, len(blocks)):
            for p in blocks[i].parameters():
                p.requires_grad = True
        if hasattr(self.backbone, 'norm'):
            for p in self.backbone.norm.parameters():
                p.requires_grad = True
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        log.info(f"Unfroze last {n}: {trainable/1e6:.1f}M trainable")


class EMA:
    def __init__(self, model, decay=0.999):
        self.decay = decay
        self.shadow = {k: v.clone() for k, v in model.state_dict().items()}
    def update(self, model):
        for k, v in model.state_dict().items():
            self.shadow[k] = self.decay*self.shadow[k] + (1-self.decay)*v
    def apply(self, model):
        model.load_state_dict(self.shadow)


class FocalBCELoss(nn.Module):
    def __init__(self, gamma=2.0, smooth=0.03):
        super().__init__()
        self.gamma = gamma; self.smooth = smooth
    def forward(self, logits, targets):
        soft = targets*(1-self.smooth)+0.5*self.smooth
        bce = F.binary_cross_entropy_with_logits(logits, soft, reduction='none')
        pt = targets*torch.sigmoid(logits)+(1-targets)*(1-torch.sigmoid(logits))
        return ((1-pt)**self.gamma * bce).mean()


def compute_metrics(logits, labels):
    from sklearn.metrics import roc_auc_score, roc_curve
    probs = torch.sigmoid(logits).cpu().numpy()
    labels_np = labels.cpu().numpy()
    try: auc = roc_auc_score(labels_np, probs)
    except: auc = 0.5
    try:
        fpr, tpr, _ = roc_curve(labels_np, probs)
        idx = np.nanargmin(np.abs(fpr-(1-tpr)))
        eer = float(fpr[idx])
    except: eer = 0.5
    acc = float(((probs>0.5).astype(int)==labels_np).mean())
    return {"auc": auc, "eer": eer, "acc": acc}


def train_epoch(model, loader, optimizer, criterion, scaler, device, cfg):
    model.train(); total_loss = 0; all_l, all_lab = [], []
    for i, (imgs, labels) in enumerate(loader):
        imgs, labels = imgs.to(device), labels.to(device).float()
        with torch.amp.autocast("cuda"):
            logits = model(imgs); loss = criterion(logits, labels)
        optimizer.zero_grad(); scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), cfg.GRAD_CLIP)
        scaler.step(optimizer); scaler.update()
        total_loss += loss.item(); all_l.append(logits.detach()); all_lab.append(labels.detach())
        if (i+1) % 100 == 0:
            log.info(f"  batch {i+1}/{len(loader)}: loss={loss.item():.4f}")
    m = compute_metrics(torch.cat(all_l), torch.cat(all_lab))
    m["loss"] = total_loss/len(loader); return m


@torch.no_grad()
def val_epoch(model, loader, criterion, device):
    model.eval(); total_loss = 0; all_l, all_lab = [], []
    for imgs, labels in loader:
        imgs, labels = imgs.to(device), labels.to(device).float()
        with torch.amp.autocast("cuda"):
            logits = model(imgs); loss = criterion(logits, labels)
        total_loss += loss.item(); all_l.append(logits); all_lab.append(labels)
    m = compute_metrics(torch.cat(all_l), torch.cat(all_lab))
    m["loss"] = total_loss/max(len(loader),1); return m


def main():
    cfg = C(); cfg.OUT.mkdir(parents=True, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log.info(f"Device: {device}")

    log.info("Scanning datasets...")
    data = scan_dataset(cfg.DATA)
    total_real = sum(1 for items in data.values() for _,l in items if l==0)
    total_fake = sum(1 for items in data.values() for _,l in items if l==1)
    log.info(f"Total: {total_real} real + {total_fake} fake = {total_real+total_fake}")

    train_items, val_items = split_data(data, cfg.VAL_SOURCES)
    random.shuffle(train_items)
    train_real = sum(1 for _,l in train_items if l==0)
    train_fake = sum(1 for _,l in train_items if l==1)
    log.info(f"Train: {train_real} real + {train_fake} fake = {len(train_items)}")
    log.info(f"Val:   {sum(1 for _,l in val_items if l==0)} real + {sum(1 for _,l in val_items if l==1)} fake = {len(val_items)}")

    labels = [l for _,l in train_items]
    cc = [labels.count(0), labels.count(1)]
    if min(cc)==0: log.error("Missing class!"); sys.exit(1)
    weights = [1.0/cc[l] for l in labels]
    sampler = WeightedRandomSampler(weights, len(train_items), replacement=True)

    train_ds = DocForensicsDataset(train_items, cfg.SZ, train=True)
    val_ds = DocForensicsDataset(val_items, cfg.SZ, train=False)
    train_loader = DataLoader(train_ds, batch_size=cfg.BS_FROZEN, sampler=sampler,
                              num_workers=cfg.WORKERS, pin_memory=True, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=cfg.BS_FROZEN, num_workers=cfg.WORKERS, pin_memory=True)

    model = DocForensicsV2(dropout=0.25).to(device)
    ema = EMA(model, decay=cfg.EMA_DECAY)
    criterion = FocalBCELoss(gamma=cfg.FOCAL_GAMMA, smooth=cfg.LABEL_SMOOTH)
    optimizer = torch.optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=cfg.LR, weight_decay=cfg.WD)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(optimizer, T_0=cfg.UNFREEZE_EPOCH, T_mult=2, eta_min=cfg.LR*0.01)
    scaler = torch.amp.GradScaler("cuda")
    best_auc=0; best_eer=1.0; best_epoch=0

    log.info(f"\n{'='*60}")
    log.info(f"DOC FORENSICS V2 -- DINOv2 + FreqBranch + SRM")
    log.info(f"{'='*60}")

    for epoch in range(1, cfg.EPOCHS+1):
        t0 = time.time()
        if epoch == cfg.UNFREEZE_EPOCH:
            log.info(f"\n{'='*60}\nPHASE 2: Unfreezing last {cfg.UNFREEZE_BLOCKS} blocks\n{'='*60}")
            model.unfreeze_last_n(cfg.UNFREEZE_BLOCKS)
            train_loader = DataLoader(train_ds, batch_size=cfg.BS_FINETUNE, sampler=sampler,
                                      num_workers=cfg.WORKERS, pin_memory=True, drop_last=True)
            bb_p = [p for n,p in model.backbone.named_parameters() if p.requires_grad]
            other_p = list(model.freq.parameters())+list(model.srm.encoder.parameters())+list(model.srm.proj.parameters())+list(model.head.parameters())
            optimizer = torch.optim.AdamW([{"params":bb_p,"lr":cfg.LR_FINETUNE},{"params":other_p,"lr":cfg.LR_FINETUNE_HEAD}], weight_decay=cfg.WD)
            scheduler = torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(optimizer, T_0=10, T_mult=2, eta_min=1e-7)

        train_m = train_epoch(model, train_loader, optimizer, criterion, scaler, device, cfg)
        ema.update(model)
        orig_sd = {k:v.clone() for k,v in model.state_dict().items()}
        ema.apply(model)
        val_m = val_epoch(model, val_loader, criterion, device)
        model.load_state_dict(orig_sd)
        scheduler.step()
        elapsed = time.time()-t0; lr = optimizer.param_groups[0]["lr"]
        phase = "FROZEN" if epoch<cfg.UNFREEZE_EPOCH else "FINETUNE"

        log.info(f"Epoch {epoch:02d} [{phase}] train_loss={train_m['loss']:.4f} train_auc={train_m['auc']:.4f} val_loss={val_m['loss']:.4f} val_auc={val_m['auc']:.4f} val_eer={val_m['eer']:.4f} lr={lr:.2e} time={elapsed:.0f}s")

        metric = {"epoch":epoch,"phase":phase,"model":"doc-v2","train_loss":train_m["loss"],"train_auc":train_m["auc"],"val_loss":val_m["loss"],"val_auc":val_m["auc"],"val_eer":val_m["eer"],"val_acc":val_m["acc"],"lr":lr,"time_s":elapsed}
        with open(cfg.OUT/cfg.METRIC_FILE,"a") as f: f.write(json.dumps(metric)+"\n")
        try: os.system(f"aws s3 cp {cfg.OUT/cfg.METRIC_FILE} {cfg.S3_METRICS} --quiet")
        except: pass

        if val_m["auc"]>best_auc:
            best_auc=val_m["auc"]; best_eer=val_m["eer"]; best_epoch=epoch
            torch.save({"epoch":epoch,"model_state":model.state_dict(),"ema_state":ema.shadow,"val_auc":val_m["auc"],"val_eer":val_m["eer"],"config":{"backbone":"vit_large_patch14_dinov2.lvd142m","version":"DocForensics-V2","branches":["DINOv2-6ch(1024)","FreqV3(48)","SRM(32)"],"total_train":len(train_items)}}, cfg.OUT/"best_doc_v2.pt")
            log.info(f"  * New best AUC={best_auc:.6f} EER={best_eer:.4f}")
            try: os.system(f"aws s3 cp {cfg.OUT/'best_doc_v2.pt'} {cfg.S3_BEST} --quiet")
            except: pass

        if epoch%5==0:
            torch.save({"epoch":epoch,"model_state":model.state_dict(),"ema_state":ema.shadow}, cfg.OUT/"latest_doc_v2.pt")
        if epoch>cfg.UNFREEZE_EPOCH+20 and epoch-best_epoch>20:
            log.info(f"Early stopping (best={best_epoch})"); break

    log.info(f"\nDONE -- Best AUC={best_auc:.6f} EER={best_eer:.4f} at epoch {best_epoch}")

if __name__ == "__main__":
    main()
