"""Model updater: checks S3 for new approved models every N seconds."""
import os, json, subprocess, time, logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/models"))
S3_BUCKET = os.getenv("S3_BUCKET", "deep-check-models")
S3_PREFIX = os.getenv("S3_PREFIX", "approved")
CHECK_INTERVAL = int(os.getenv("CHECK_INTERVAL", "21600"))  # 6 hours
ML_WORKER_URL = os.getenv("ML_WORKER_URL", "http://ml-worker:8001")
VERSIONS_FILE = MODEL_DIR / "versions.json"

ENGINES = ["deepfake", "doc_forensics", "keystroke"]


def get_local_versions():
    if VERSIONS_FILE.exists():
        return json.loads(VERSIONS_FILE.read_text())
    return {}

def save_local_versions(v):
    VERSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    VERSIONS_FILE.write_text(json.dumps(v, indent=2))

def s3_get_json(key):
    r = subprocess.run(["aws", "s3", "cp", f"s3://{S3_BUCKET}/{key}", "-", "--quiet"], capture_output=True, text=True)
    if r.returncode != 0: return None
    try: return json.loads(r.stdout)
    except: return None

def s3_download(key, dest):
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["aws", "s3", "cp", f"s3://{S3_BUCKET}/{key}", str(dest), "--quiet"], capture_output=True, text=True)
    return r.returncode == 0

def notify_worker():
    try:
        import urllib.request
        req = urllib.request.Request(f"{ML_WORKER_URL}/models/reload", method="POST")
        urllib.request.urlopen(req, timeout=30)
        log.info("ML worker notified to reload")
    except Exception as e:
        log.warning(f"Failed to notify worker: {e}")

def check_updates():
    local = get_local_versions()
    updated = []

    for engine in ENGINES:
        manifest = s3_get_json(f"{S3_PREFIX}/{engine}/manifest.json")
        if not manifest: continue

        remote_v = manifest.get("version", "")
        local_v = local.get(engine, {}).get("version", "")

        if remote_v and remote_v != local_v:
            model_file = manifest.get("file", "")
            if model_file:
                s3_key = f"{S3_PREFIX}/{engine}/{model_file}"
                local_path = MODEL_DIR / engine / model_file
                log.info(f"Downloading {engine} {remote_v}: {model_file}")
                if s3_download(s3_key, local_path):
                    local[engine] = {"version": remote_v, "file": model_file,
                                     "auc": manifest.get("auc"), "eer": manifest.get("eer")}
                    updated.append(engine)

    if updated:
        save_local_versions(local)
        log.info(f"Updated: {updated}")
        notify_worker()
    else:
        log.info("All models up to date")

    return updated


def main():
    log.info(f"Model updater started. Checking every {CHECK_INTERVAL}s")
    log.info(f"S3: s3://{S3_BUCKET}/{S3_PREFIX}/")

    # Check immediately on startup
    check_updates()

    # Then check periodically
    while True:
        time.sleep(CHECK_INTERVAL)
        try:
            check_updates()
        except Exception as e:
            log.error(f"Update check failed: {e}")


if __name__ == "__main__":
    main()
