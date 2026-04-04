"""Model loader: download from S3, version check, hot reload."""
import os, json, logging, subprocess
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/models"))
S3_BUCKET = os.getenv("S3_BUCKET", "deep-check-models")
S3_PREFIX = os.getenv("S3_PREFIX", "approved")

ENGINES = {
    "deepfake": {"s3_path": "deepfake", "local_dir": "deepfake"},
    "doc_forensics": {"s3_path": "doc_forensics", "local_dir": "doc_forensics"},
    "keystroke": {"s3_path": "keystroke", "local_dir": "keystroke"},
}

VERSIONS_FILE = MODEL_DIR / "versions.json"


def get_local_versions():
    if VERSIONS_FILE.exists():
        return json.loads(VERSIONS_FILE.read_text())
    return {}


def save_local_versions(versions):
    VERSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    VERSIONS_FILE.write_text(json.dumps(versions, indent=2))


def s3_download(s3_key, local_path):
    """Download file from S3 using AWS CLI."""
    local_path = Path(local_path)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["aws", "s3", "cp", f"s3://{S3_BUCKET}/{s3_key}", str(local_path), "--quiet"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"S3 download failed: {result.stderr}")
        return False
    logger.info(f"Downloaded s3://{S3_BUCKET}/{s3_key} -> {local_path}")
    return True


def s3_read_json(s3_key):
    """Read JSON file from S3."""
    cmd = ["aws", "s3", "cp", f"s3://{S3_BUCKET}/{s3_key}", "-", "--quiet"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def check_and_download_models():
    """Check S3 for new model versions and download if newer."""
    local_versions = get_local_versions()
    updated = []

    for engine_name, cfg in ENGINES.items():
        s3_manifest_key = f"{S3_PREFIX}/{cfg['s3_path']}/manifest.json"
        manifest = s3_read_json(s3_manifest_key)

        if manifest is None:
            logger.debug(f"No manifest for {engine_name} at s3://{S3_BUCKET}/{s3_manifest_key}")
            continue

        remote_version = manifest.get("version", "")
        local_version = local_versions.get(engine_name, {}).get("version", "")

        if remote_version and remote_version != local_version:
            logger.info(f"{engine_name}: new version {remote_version} (local: {local_version or 'none'})")

            model_file = manifest.get("file", "")
            if model_file:
                s3_model_key = f"{S3_PREFIX}/{cfg['s3_path']}/{model_file}"
                local_model_path = MODEL_DIR / cfg["local_dir"] / model_file

                if s3_download(s3_model_key, local_model_path):
                    local_versions[engine_name] = {
                        "version": remote_version,
                        "file": model_file,
                        "auc": manifest.get("auc"),
                        "eer": manifest.get("eer"),
                        "downloaded_at": datetime.utcnow().isoformat(),
                    }
                    updated.append(engine_name)
                    logger.info(f"{engine_name}: updated to {remote_version}")
        else:
            logger.debug(f"{engine_name}: up to date ({local_version})")

    if updated:
        save_local_versions(local_versions)

    return updated


def ensure_models_exist():
    """Download models on first startup if not present."""
    for engine_name, cfg in ENGINES.items():
        local_dir = MODEL_DIR / cfg["local_dir"]
        if not local_dir.exists() or not any(local_dir.iterdir()):
            logger.info(f"{engine_name}: no local models, downloading from S3...")
            check_and_download_models()
            break


def get_model_status():
    """Return status of all models."""
    versions = get_local_versions()
    status = {}
    for engine_name, cfg in ENGINES.items():
        local_dir = MODEL_DIR / cfg["local_dir"]
        model_files = list(local_dir.glob("*.pt")) + list(local_dir.glob("*.onnx")) if local_dir.exists() else []
        v = versions.get(engine_name, {})
        status[engine_name] = {
            "version": v.get("version", "unknown"),
            "auc": v.get("auc"),
            "eer": v.get("eer"),
            "file": v.get("file", ""),
            "downloaded_at": v.get("downloaded_at", ""),
            "files_on_disk": len(model_files),
        }
    return status
