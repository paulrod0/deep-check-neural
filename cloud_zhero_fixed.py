import http.server, json, os, time, uuid, shutil, cgi, urllib.parse, secrets, zipfile
from http.cookies import SimpleCookie
from datetime import datetime

PORT = 8585
DATA_DIR = r"D:\minio-hdd\data"
META_FILE = r"D:\minio\upload_meta.json"
HTML_FILE = r"D:\minio\cloud_zhero.html"
USERS_FILE = r"D:\minio\users.json"
SHARES_FILE = r"D:\minio\shared_links.json"
SESSIONS = {}

def load_users():
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}

def save_users(users):
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2, ensure_ascii=False)

def load_meta():
    try:
        with open(META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}

def save_meta(meta):
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

def load_shares():
    try:
        with open(SHARES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}

def save_shares(shares):
    with open(SHARES_FILE, "w", encoding="utf-8") as f:
        json.dump(shares, f, ensure_ascii=False, indent=2)

def get_buckets():
    buckets = []
    for name in os.listdir(DATA_DIR):
        if os.path.isdir(os.path.join(DATA_DIR, name)) and not name.startswith("."):
            buckets.append(name)
    return sorted(buckets)

def user_can_access(user_data, path):
    if user_data.get("role") == "admin":
        return True
    buckets = user_data.get("buckets", [])
    if not buckets:
        return False
    top = path.strip("/").split("/")[0] if path.strip("/") else ""
    if not top:
        return True
    return top in buckets

def sanitize_users_for_api(users):
    """Return users dict with passwords stripped for API response."""
    safe = {}
    for username, data in users.items():
        safe[username] = {k: v for k, v in data.items() if k != "password"}
    return safe

with open(HTML_FILE, "r", encoding="utf-8") as f:
    HTML_TEMPLATE = f.read()

def fmt_size(b):
    if b >= 1073741824: return f"{b/1073741824:.1f} GB"
    if b >= 1048576: return f"{b/1048576:.1f} MB"
    if b >= 1024: return f"{b/1024:.0f} KB"
    return f"{b} B"

def fmt_time(ts):
    dt = datetime.fromtimestamp(ts)
    now = datetime.now()
    diff = now - dt
    if diff.days == 0:
        if diff.seconds < 60: return "Just now"
        if diff.seconds < 3600: return f"{diff.seconds//60}m ago"
        return f"{diff.seconds//3600}h ago"
    if diff.days == 1: return "Yesterday"
    if diff.days < 7: return f"{diff.days}d ago"
    return dt.strftime("%b %d, %Y")

def get_icon(name, is_dir):
    if is_dir:
        return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M2 6C2 4.89543 2.89543 4 4 4H9L11 6H20C21.1046 6 22 6.89543 22 8V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z" fill="#4A9FE5" stroke="#3B8DD4" stroke-width="0.5"/></svg>'
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    colors = {"zip":"#E8A838","rar":"#E8A838","7z":"#E8A838","pdf":"#E84B3A","doc":"#4A7FE5","docx":"#4A7FE5","xls":"#3AAE5C","xlsx":"#3AAE5C","png":"#9B59B6","jpg":"#9B59B6","jpeg":"#9B59B6","mp4":"#E74C8B","mov":"#E74C8B","mp3":"#1ABC9C"}
    color = colors.get(ext, "#8B949E")
    label = ext.upper()[:4]
    return f'<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6 2C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2H6Z" fill="{color}" opacity="0.15" stroke="{color}" stroke-width="1.5"/><path d="M14 2V8H20" stroke="{color}" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" font-size="5" fill="{color}" font-weight="600">{label}</text></svg>'

def get_file_icon_html(name):
    """Generate a larger file icon for the public share page."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    colors = {"zip":"#E8A838","rar":"#E8A838","7z":"#E8A838","pdf":"#E84B3A","doc":"#4A7FE5","docx":"#4A7FE5","xls":"#3AAE5C","xlsx":"#3AAE5C","png":"#9B59B6","jpg":"#9B59B6","jpeg":"#9B59B6","gif":"#9B59B6","mp4":"#E74C8B","mov":"#E74C8B","avi":"#E74C8B","mp3":"#1ABC9C","wav":"#1ABC9C","txt":"#8B949E","csv":"#3AAE5C","pptx":"#E8A838","ppt":"#E8A838"}
    color = colors.get(ext, "#8B949E")
    label = ext.upper()[:4] if ext else "FILE"
    return f'<svg width="80" height="80" viewBox="0 0 24 24" fill="none"><path d="M6 2C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2H6Z" fill="{color}" opacity="0.15" stroke="{color}" stroke-width="1.5"/><path d="M14 2V8H20" stroke="{color}" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" font-size="5" fill="{color}" font-weight="600">{label}</text></svg>'

def html_escape(s):
    """Escape HTML special characters."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#39;")

def build_share_page(share_id, share_data):
    """Build the public download page HTML for a shared link."""
    file_path = share_data["path"]
    file_name = os.path.basename(file_path)
    full_path = os.path.join(DATA_DIR, file_path)

    # Check expiration
    expires = share_data.get("expires")
    expired = expires is not None and time.time() > expires

    if not os.path.isfile(full_path):
        error_msg = "This file no longer exists."
    elif expired:
        error_msg = "This link has expired."
    else:
        error_msg = None

    safe_name = html_escape(file_name)
    icon_html = get_file_icon_html(file_name)

    if error_msg:
        content_block = f'<div style="color:#E84B3A;font-size:16px;margin:20px 0">{html_escape(error_msg)}</div>'
    else:
        file_size = fmt_size(os.path.getsize(full_path))
        content_block = f'''
            <div style="color:#8b949e;font-size:14px;margin-bottom:24px">{html_escape(file_size)}</div>
            <a href="/s/{html_escape(share_id)}/download" style="display:inline-flex;align-items:center;gap:10px;padding:14px 36px;background:#4A9FE5;color:#fff;border-radius:10px;font-size:16px;font-weight:600;text-decoration:none;transition:background 0.15s">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3a.75.75 0 01.75.75v7.69l2.22-2.22a.75.75 0 011.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 011.06-1.06l2.22 2.22V3.75A.75.75 0 0110 3zM3 15.25a.75.75 0 01.75.75v.25c0 .138.112.25.25.25h12a.25.25 0 00.25-.25V16a.75.75 0 011.5 0v.25A1.75 1.75 0 0116 18H4a1.75 1.75 0 01-1.75-1.75V16a.75.75 0 01.75-.75z"/></svg>
                Download
            </a>
        '''

    return f'''<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{safe_name} - Cloud-Zhero</title>
<link rel="icon" href="https://zhero.es/images/logos/logoHardDigitalMarketingWhiteOrange.png">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center}}
.card{{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:48px;text-align:center;max-width:480px;width:calc(100% - 32px);box-shadow:0 8px 30px rgba(0,0,0,0.4)}}
.logo{{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:32px}}
.logo img{{height:28px}}.logo span{{font-size:16px;font-weight:700}}
.file-icon{{margin-bottom:16px}}
.file-name{{font-size:20px;font-weight:600;margin-bottom:8px;word-break:break-all}}
a:hover{{background:#3B8DD4!important}}
.footer{{margin-top:32px;font-size:12px;color:#8b949e}}
</style>
</head><body>
<div class="card">
    <div class="logo"><img src="https://zhero.es/images/logos/logoHardDigitalMarketingWhiteOrange.png" alt=""><span>Cloud-Zhero</span></div>
    <div class="file-icon">{icon_html}</div>
    <div class="file-name">{safe_name}</div>
    {content_block}
</div>
<div class="footer">Powered by Cloud-Zhero</div>
</body></html>'''


def _safe_join_share(base_full, rel):
    """Resolve a relative subpath under a shared folder, refusing traversal."""
    rel = (rel or "").replace("\\", "/").strip("/")
    full = os.path.normpath(os.path.join(base_full, rel)) if rel else base_full
    base_norm = os.path.normpath(base_full)
    if not (full == base_norm or full.startswith(base_norm + os.sep)):
        return None
    return full


def build_share_folder_page(share_id, share_data, sub_path=""):
    """Build the public folder browsing page HTML for a shared folder link."""
    folder_rel = share_data["path"]
    folder_name = os.path.basename(folder_rel.rstrip("/")) or folder_rel
    shared_by = share_data.get("name", "")
    base_full = os.path.join(DATA_DIR, folder_rel)

    # Check expiration
    expires = share_data.get("expires")
    expired = expires is not None and time.time() > expires

    if not os.path.isdir(base_full):
        error_msg = "This folder no longer exists."
    elif expired:
        error_msg = "This link has expired."
    else:
        error_msg = None

    # Resolve sub_path within the shared folder
    if not error_msg and sub_path:
        browse_full = _safe_join_share(base_full, sub_path)
        if not browse_full or not os.path.isdir(browse_full):
            error_msg = "Subfolder not found."
        else:
            browse_full = browse_full  # already set
    else:
        browse_full = base_full

    safe_folder = html_escape(folder_name)
    safe_shared_by = html_escape(shared_by)

    # Build breadcrumb
    breadcrumb_html = f'<a href="/s/{html_escape(share_id)}" style="color:#4A9FE5;text-decoration:none">{safe_folder}</a>'
    if sub_path and not error_msg:
        parts = sub_path.strip("/").split("/")
        cum = ""
        for i, part in enumerate(parts):
            cum += ("/" if cum else "") + part
            safe_part = html_escape(part)
            if i == len(parts) - 1:
                breadcrumb_html += f' <span style="color:#8b949e">/</span> <span>{safe_part}</span>'
            else:
                safe_cum = html_escape(cum)
                breadcrumb_html += f' <span style="color:#8b949e">/</span> <a href="/s/{html_escape(share_id)}?path={urllib.parse.quote(cum, safe="")}" style="color:#4A9FE5;text-decoration:none">{safe_part}</a>'

    if error_msg:
        content_block = f'<div style="color:#E84B3A;font-size:16px;margin:30px 0">{html_escape(error_msg)}</div>'
    else:
        # List directory contents
        items = []
        try:
            for name in sorted(os.listdir(browse_full)):
                if name.startswith(".") or name.startswith("_"):
                    continue
                fp = os.path.join(browse_full, name)
                is_dir = os.path.isdir(fp)
                sz = 0 if is_dir else os.path.getsize(fp)
                items.append({"name": name, "is_dir": is_dir, "size": sz})
        except Exception:
            pass
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

        # Build file rows
        rows_html = ""
        current_sub = sub_path.strip("/") if sub_path else ""
        for item in items:
            safe_name = html_escape(item["name"])
            item_sub = (current_sub + "/" + item["name"]).strip("/") if current_sub else item["name"]
            if item["is_dir"]:
                icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M2 6C2 4.89543 2.89543 4 4 4H9L11 6H20C21.1046 6 22 6.89543 22 8V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z" fill="#4A9FE5" stroke="#3B8DD4" stroke-width="0.5"/></svg>'
                link = f'/s/{html_escape(share_id)}?path={urllib.parse.quote(item_sub, safe="")}'
                rows_html += f'<tr style="border-bottom:1px solid #30363d;cursor:pointer" onclick="window.location=\'{link}\'"><td style="padding:12px;display:flex;align-items:center;gap:10px">{icon}<span>{safe_name}/</span></td><td style="padding:12px;text-align:right;color:#8b949e">--</td><td style="padding:12px;text-align:right"></td></tr>'
            else:
                ext = item["name"].rsplit(".", 1)[-1].lower() if "." in item["name"] else ""
                colors = {"zip":"#E8A838","rar":"#E8A838","pdf":"#E84B3A","doc":"#4A7FE5","docx":"#4A7FE5","xls":"#3AAE5C","xlsx":"#3AAE5C","png":"#9B59B6","jpg":"#9B59B6","jpeg":"#9B59B6","mp4":"#E74C8B","mov":"#E74C8B","mp3":"#1ABC9C"}
                color = colors.get(ext, "#8B949E")
                label = ext.upper()[:4] if ext else "FILE"
                icon = f'<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 2C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2H6Z" fill="{color}" opacity="0.15" stroke="{color}" stroke-width="1.5"/><path d="M14 2V8H20" stroke="{color}" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" font-size="5" fill="{color}" font-weight="600">{label}</text></svg>'
                dl_link = f'/s/{html_escape(share_id)}/download?file={urllib.parse.quote(item_sub, safe="")}'
                size_str = fmt_size(item["size"])
                rows_html += f'<tr style="border-bottom:1px solid #30363d"><td style="padding:12px;display:flex;align-items:center;gap:10px">{icon}<span>{safe_name}</span></td><td style="padding:12px;text-align:right;color:#8b949e">{html_escape(size_str)}</td><td style="padding:12px;text-align:right"><a href="{dl_link}" style="color:#4A9FE5;text-decoration:none;font-size:13px">Download</a></td></tr>'

        if not items:
            rows_html = '<tr><td colspan="3" style="padding:30px;text-align:center;color:#8b949e">This folder is empty</td></tr>'

        zip_url = f'/s/{html_escape(share_id)}/download'
        if current_sub:
            zip_url += f'?file={urllib.parse.quote(current_sub, safe="")}&amp;zip=1'
        else:
            zip_url += ''

        content_block = f'''
            <div style="margin-bottom:20px">
                <a href="{zip_url}" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:#4A9FE5;color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3a.75.75 0 01.75.75v7.69l2.22-2.22a.75.75 0 011.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 011.06-1.06l2.22 2.22V3.75A.75.75 0 0110 3zM3 15.25a.75.75 0 01.75.75v.25c0 .138.112.25.25.25h12a.25.25 0 00.25-.25V16a.75.75 0 011.5 0v.25A1.75 1.75 0 0116 18H4a1.75 1.75 0 01-1.75-1.75V16a.75.75 0 01.75-.75z"/></svg>
                    Download all as ZIP
                </a>
            </div>
            <table style="width:100%;border-collapse:collapse">
                <thead><tr style="border-bottom:1px solid #30363d">
                    <th style="text-align:left;padding:10px 12px;font-size:12px;color:#8b949e;text-transform:uppercase">Name</th>
                    <th style="text-align:right;padding:10px 12px;font-size:12px;color:#8b949e;text-transform:uppercase">Size</th>
                    <th style="text-align:right;padding:10px 12px;font-size:12px;color:#8b949e;text-transform:uppercase;width:100px"></th>
                </tr></thead>
                <tbody>{rows_html}</tbody>
            </table>
        '''

    return f'''<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{safe_folder} - Cloud-Zhero</title>
<link rel="icon" href="https://zhero.es/images/logos/logoHardDigitalMarketingWhiteOrange.png">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 16px}}
.card{{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;max-width:700px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,0.4)}}
.logo{{display:flex;align-items:center;gap:10px;margin-bottom:24px}}
.logo img{{height:28px}}.logo span{{font-size:16px;font-weight:700}}
.folder-title{{font-size:18px;font-weight:600;margin-bottom:4px;display:flex;align-items:center;gap:8px}}
.breadcrumb{{font-size:14px;margin-bottom:4px}}
.shared-by{{font-size:13px;color:#8b949e;margin-bottom:20px}}
table tr:hover{{background:rgba(74,159,229,0.05)}}
a:hover{{opacity:0.85}}
.footer{{margin-top:24px;font-size:12px;color:#8b949e}}
</style>
</head><body>
<div class="card">
    <div class="logo"><img src="https://zhero.es/images/logos/logoHardDigitalMarketingWhiteOrange.png" alt=""><span>Cloud-Zhero</span></div>
    <div class="breadcrumb">{breadcrumb_html}</div>
    <div class="shared-by">Shared by {safe_shared_by}</div>
    {content_block}
</div>
<div class="footer">Powered by Cloud-Zhero</div>
</body></html>'''


def _safe_join(rel):
    """Resolve a relative path under DATA_DIR, refusing traversal."""
    rel = (rel or "").replace("\\", "/").strip("/")
    if not rel:
        return None
    full = os.path.normpath(os.path.join(DATA_DIR, rel))
    base = os.path.normpath(DATA_DIR)
    if not (full == base or full.startswith(base + os.sep)):
        return None
    return full


def _iter_zip_entries(rel_path):
    """Yield (arcname, absolute_path) tuples for a rel path.
    If it's a file, yields just that file using its basename as arcname.
    If it's a directory, walks recursively with arcnames rooted at the folder name."""
    full = _safe_join(rel_path)
    if not full or not os.path.exists(full):
        return
    base_name = os.path.basename(rel_path.rstrip("/")) or "root"
    if os.path.isfile(full):
        yield base_name, full
        return
    if os.path.isdir(full):
        for dirpath, dirnames, filenames in os.walk(full):
            # Skip hidden/underscore entries, same rule as file listing
            dirnames[:] = [d for d in dirnames if not d.startswith(".") and not d.startswith("_")]
            for fn in sorted(filenames):
                if fn.startswith(".") or fn.startswith("_"):
                    continue
                ap = os.path.join(dirpath, fn)
                rel = os.path.relpath(ap, full).replace("\\", "/")
                yield base_name + "/" + rel, ap


class StreamWriter:
    """File-like wrapper that streams raw bytes directly to wfile.
    Used with zipfile.ZipFile to avoid buffering the entire archive in memory.
    The caller is responsible for the HTTP framing (Connection: close + no
    Content-Length so the client reads until EOF)."""
    def __init__(self, wfile):
        self.wfile = wfile
        self.pos = 0
    def write(self, data):
        if not data:
            return 0
        self.wfile.write(data)
        n = len(data)
        self.pos += n
        return n
    def tell(self):
        return self.pos
    def flush(self):
        try:
            self.wfile.flush()
        except Exception:
            pass


class Handler(http.server.BaseHTTPRequestHandler):
    def get_user(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        sid = cookie.get("sid")
        if sid:
            sess = SESSIONS.get(sid.value)
            if sess:
                users = load_users()
                ud = users.get(sess["username"])
                if ud:
                    sess["buckets"] = ud.get("buckets", [])
                    sess["role"] = ud.get("role", "user")
            return sess
        return None

    def send_json(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        if path == "/" or path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_TEMPLATE.encode())
            return

        if path == "/api/me":
            user = self.get_user()
            if user:
                self.send_json({"ok": True, "name": user["name"], "role": user["role"], "username": user["username"]})
            else:
                self.send_json({"ok": False})
            return

        if path == "/api/logout":
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            sid = cookie.get("sid")
            if sid and sid.value in SESSIONS:
                del SESSIONS[sid.value]
            self.send_response(302)
            self.send_header("Location", "/")
            self.send_header("Set-Cookie", "sid=; Path=/; Max-Age=0")
            self.end_headers()
            return

        if path == "/api/admin/users":
            user = self.get_user()
            if not user or user.get("role") != "admin":
                self.send_json({"error": "forbidden"}, 403)
                return
            users = load_users()
            self.send_json({"users": sanitize_users_for_api(users), "buckets": get_buckets()})
            return

        if path == "/api/shares":
            user = self.get_user()
            if not user:
                self.send_json({"error": "unauthorized"}, 401)
                return
            shares = load_shares()
            user_shares = []
            for sid, sdata in shares.items():
                if sdata.get("username") == user["username"] or user.get("role") == "admin":
                    user_shares.append({
                        "id": sid,
                        "path": sdata["path"],
                        "filename": os.path.basename(sdata["path"]),
                        "type": sdata.get("type", "file"),
                        "created": sdata.get("created", 0),
                        "expires": sdata.get("expires"),
                        "downloads": sdata.get("downloads", 0),
                        "created_by": sdata.get("name", "")
                    })
            user_shares.sort(key=lambda x: x["created"], reverse=True)
            self.send_json({"ok": True, "shares": user_shares})
            return

        # Public share page: /s/<id>
        if path.startswith("/s/"):
            parts = path[3:].strip("/").split("/")
            share_id = parts[0] if parts else ""
            is_download = len(parts) > 1 and parts[1] == "download"

            shares = load_shares()
            share_data = shares.get(share_id)
            if not share_data:
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"<html><body style='background:#0d1117;color:#e6edf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh'><h2>Link not found</h2></body></html>")
                return

            share_type = share_data.get("type", "file")

            if is_download:
                # Check expiration
                expires = share_data.get("expires")
                if expires is not None and time.time() > expires:
                    self.send_response(410)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(b"<html><body style='background:#0d1117;color:#e6edf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh'><h2>This link has expired</h2></body></html>")
                    return

                file_param = params.get("file", [""])[0]
                is_zip = params.get("zip", [""])[0] == "1"
                share_path = share_data["path"]
                base_full = os.path.join(DATA_DIR, share_path)

                if share_type == "folder":
                    if file_param and not is_zip:
                        # Download a specific file from the shared folder
                        target = _safe_join_share(base_full, file_param)
                        if not target or not os.path.isfile(target):
                            self.send_response(404)
                            self.send_header("Content-Type", "text/html; charset=utf-8")
                            self.end_headers()
                            self.wfile.write(b"<html><body style='background:#0d1117;color:#e6edf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh'><h2>File not found</h2></body></html>")
                            return
                        share_data["downloads"] = share_data.get("downloads", 0) + 1
                        shares[share_id] = share_data
                        save_shares(shares)
                        file_name = os.path.basename(target)
                        file_size = os.path.getsize(target)
                        self.send_response(200)
                        self.send_header("Content-Type", "application/octet-stream")
                        self.send_header("Content-Disposition", 'attachment; filename="' + file_name + '"')
                        self.send_header("Content-Length", str(file_size))
                        self.end_headers()
                        with open(target, "rb") as f:
                            while True:
                                chunk = f.read(1048576)
                                if not chunk:
                                    break
                                self.wfile.write(chunk)
                        return
                    else:
                        # Download folder (or subfolder) as ZIP
                        if file_param:
                            zip_root = _safe_join_share(base_full, file_param)
                            if not zip_root or not os.path.isdir(zip_root):
                                self.send_response(404)
                                self.end_headers()
                                return
                            zip_name_base = os.path.basename(file_param.rstrip("/"))
                        else:
                            zip_root = base_full
                            zip_name_base = os.path.basename(share_path.rstrip("/")) or "shared"

                        share_data["downloads"] = share_data.get("downloads", 0) + 1
                        shares[share_id] = share_data
                        save_shares(shares)

                        ts = time.strftime("%Y%m%d-%H%M%S")
                        zip_name = f"{zip_name_base}-{ts}.zip"
                        self.send_response(200)
                        self.send_header("Content-Type", "application/zip")
                        self.send_header("Content-Disposition", f'attachment; filename="{zip_name}"')
                        self.send_header("Cache-Control", "no-store")
                        self.send_header("Connection", "close")
                        self.end_headers()
                        writer = StreamWriter(self.wfile)
                        try:
                            with zipfile.ZipFile(writer, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
                                for dirpath, dirnames, filenames in os.walk(zip_root):
                                    dirnames[:] = [d for d in dirnames if not d.startswith(".") and not d.startswith("_")]
                                    for fn in sorted(filenames):
                                        if fn.startswith(".") or fn.startswith("_"):
                                            continue
                                        ap = os.path.join(dirpath, fn)
                                        rel = os.path.relpath(ap, zip_root).replace("\\", "/")
                                        arcname = zip_name_base + "/" + rel
                                        try:
                                            zi = zipfile.ZipInfo(arcname)
                                            zi.compress_type = zipfile.ZIP_STORED
                                            try:
                                                mtime = time.localtime(os.path.getmtime(ap))
                                                zi.date_time = mtime[:6]
                                            except Exception:
                                                pass
                                            with open(ap, "rb") as src, zf.open(zi, "w", force_zip64=True) as dst:
                                                while True:
                                                    chunk = src.read(1048576)
                                                    if not chunk:
                                                        break
                                                    dst.write(chunk)
                                        except Exception as e:
                                            print(f"share zip skip {ap}: {e}")
                            try:
                                self.wfile.flush()
                            except Exception:
                                pass
                        except Exception as e:
                            print(f"share zip stream error: {e}")
                        return
                else:
                    # File share download (original behavior)
                    full_path = os.path.join(DATA_DIR, share_path)
                    if not os.path.isfile(full_path):
                        self.send_response(404)
                        self.end_headers()
                        return
                    share_data["downloads"] = share_data.get("downloads", 0) + 1
                    shares[share_id] = share_data
                    save_shares(shares)
                    file_name = os.path.basename(full_path)
                    file_size = os.path.getsize(full_path)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Disposition", 'attachment; filename="' + file_name + '"')
                    self.send_header("Content-Length", str(file_size))
                    self.end_headers()
                    with open(full_path, "rb") as f:
                        while True:
                            chunk = f.read(1048576)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                    return
            else:
                # Serve public share page / folder browse page
                if share_type == "folder":
                    sub_path = params.get("path", [""])[0]
                    page_html = build_share_folder_page(share_id, share_data, sub_path)
                else:
                    page_html = build_share_page(share_id, share_data)
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(page_html.encode())
                return

        if path == "/api/files":
            user = self.get_user()
            if not user:
                self.send_json({"error": "unauthorized"}, 401)
                return
            rel = params.get("path", [""])[0].strip("/")
            users = load_users()
            ud = users.get(user["username"], {})
            if not user_can_access(ud, rel):
                self.send_json({"files": [], "error": "Access denied"})
                return
            full = os.path.join(DATA_DIR, rel)
            if not os.path.exists(full) or not os.path.isdir(full):
                self.send_json({"files": []})
                return
            meta = load_meta()
            files = []
            for name in sorted(os.listdir(full)):
                if name.startswith(".") or name.startswith("_"):
                    continue
                fp = os.path.join(full, name)
                fpath = (rel + "/" + name).strip("/")
                is_dir = os.path.isdir(fp)
                if not rel and is_dir and not user_can_access(ud, fpath):
                    continue
                try:
                    sz = os.path.getsize(fp) if not is_dir else 0
                    mt = os.path.getmtime(fp)
                except:
                    continue
                m = meta.get(fpath, {})
                files.append({"name": name, "path": fpath, "is_dir": is_dir, "size": fmt_size(sz), "modified": fmt_time(mt), "uploader": m.get("user"), "icon": get_icon(name, is_dir)})
            files.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
            disk = shutil.disk_usage("D:\\")
            self.send_json({"files": files, "storage": {"used": disk.used, "total": disk.total, "used_fmt": fmt_size(disk.used), "total_fmt": fmt_size(disk.total)}})
            return

        if path == "/api/download":
            user = self.get_user()
            if not user:
                self.send_json({"error": "unauthorized"}, 401)
                return
            rel = params.get("path", [""])[0]
            users = load_users()
            ud = users.get(user["username"], {})
            if not user_can_access(ud, rel):
                self.send_json({"error": "forbidden"}, 403)
                return
            fp = os.path.join(DATA_DIR, rel)
            if not os.path.isfile(fp):
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", 'attachment; filename="' + os.path.basename(fp) + '"')
            self.send_header("Content-Length", str(os.path.getsize(fp)))
            self.end_headers()
            with open(fp, "rb") as f:
                while True:
                    chunk = f.read(1048576)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            return

        if path == "/api/download-zip":
            user = self.get_user()
            if not user:
                self.send_json({"error": "unauthorized"}, 401)
                return
            users = load_users()
            ud = users.get(user["username"], {})

            raw = params.get("paths", [""])[0]
            if not raw:
                self.send_json({"error": "no paths"}, 400)
                return
            requested = [p.strip().strip("/") for p in raw.split(",") if p.strip()]
            if not requested:
                self.send_json({"error": "no paths"}, 400)
                return

            # Validate: access check + safe join + dedupe
            valid_entries = []  # list of rel_path
            seen = set()
            for rel in requested:
                if rel in seen:
                    continue
                seen.add(rel)
                if not user_can_access(ud, rel):
                    continue
                full = _safe_join(rel)
                if not full or not os.path.exists(full):
                    continue
                valid_entries.append(rel)

            if not valid_entries:
                self.send_json({"error": "no accessible paths"}, 404)
                return

            ts = time.strftime("%Y%m%d-%H%M%S")
            zip_name = f"cloud-zhero-{ts}.zip"

            # Stream the zip. We rely on HTTP/1.0 "read until EOF" framing:
            # no Content-Length and Connection: close so the client knows when
            # the body ends. ZIP_STORED = no compression (fast; media files are
            # already compressed). Nginx upstream will re-chunk for HTTP/2.
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="{zip_name}"')
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()

            writer = StreamWriter(self.wfile)
            try:
                with zipfile.ZipFile(writer, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
                    for rel in valid_entries:
                        for arcname, abspath in _iter_zip_entries(rel):
                            try:
                                zi = zipfile.ZipInfo(arcname)
                                zi.compress_type = zipfile.ZIP_STORED
                                try:
                                    mtime = time.localtime(os.path.getmtime(abspath))
                                    zi.date_time = mtime[:6]
                                except Exception:
                                    pass
                                with open(abspath, "rb") as src, zf.open(zi, "w", force_zip64=True) as dst:
                                    while True:
                                        chunk = src.read(1048576)
                                        if not chunk:
                                            break
                                        dst.write(chunk)
                            except Exception as e:
                                print(f"zip skip {abspath}: {e}")
                                continue
                try:
                    self.wfile.flush()
                except Exception:
                    pass
            except Exception as e:
                print(f"zip stream error: {e}")
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/login":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            username = body.get("user", "")
            password = body.get("pass", "")
            users = load_users()
            u = users.get(username)
            if u and u["password"] == password:
                sid = uuid.uuid4().hex
                SESSIONS[sid] = {"username": username, "name": u["name"], "role": u["role"]}
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Set-Cookie", "sid=" + sid + "; Path=/; HttpOnly; SameSite=Lax")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "name": u["name"], "role": u["role"], "username": username}).encode())
            else:
                self.send_json({"ok": False, "error": "Invalid credentials"}, 401)
            return

        if path == "/api/admin/users":
            user = self.get_user()
            if not user or user.get("role") != "admin":
                self.send_json({"error": "forbidden"}, 403)
                return
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            action = body.get("action")
            users = load_users()
            if action == "create":
                un = body.get("username", "").strip()
                if not un or not body.get("password"):
                    self.send_json({"error": "Username and password required"}, 400)
                    return
                if un in users:
                    self.send_json({"error": "User already exists"}, 400)
                    return
                users[un] = {"password": body["password"], "name": body.get("name", un), "role": body.get("role", "user"), "buckets": body.get("buckets", [])}
                save_users(users)
                self.send_json({"ok": True})
            elif action == "update":
                un = body.get("username")
                if un not in users:
                    self.send_json({"error": "User not found"}, 404)
                    return
                if body.get("name"):
                    users[un]["name"] = body["name"]
                if body.get("password"):
                    users[un]["password"] = body["password"]
                if "buckets" in body:
                    users[un]["buckets"] = body["buckets"]
                save_users(users)
                self.send_json({"ok": True})
            elif action == "delete":
                un = body.get("username")
                if un in users and users[un].get("role") != "admin":
                    del users[un]
                    save_users(users)
                    self.send_json({"ok": True})
                else:
                    self.send_json({"error": "Cannot delete admin"}, 400)
            else:
                self.send_json({"error": "Unknown action"}, 400)
            return

        if path == "/api/share":
            user = self.get_user()
            if not user:
                self.send_json({"error": "unauthorized"}, 401)
                return
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            file_path = body.get("path", "").strip("/")
            expires_hours = body.get("expires_hours")  # null = never
            # Verify file exists and user has access
            users = load_users()
            ud = users.get(user["username"], {})
            if not user_can_access(ud, file_path):
                self.send_json({"error": "Access denied"}, 403)
                return
            full_path = os.path.join(DATA_DIR, file_path)
            is_dir = os.path.isdir(full_path)
            if not os.path.isfile(full_path) and not is_dir:
                self.send_json({"error": "Path not found"}, 404)
                return
            # Create share
            share_id = secrets.token_hex(4)  # 8-char hex
            expires_ts = None
            if expires_hours is not None:
                expires_ts = time.time() + (float(expires_hours) * 3600)
            shares = load_shares()
            shares[share_id] = {
                "path": file_path,
                "type": "folder" if is_dir else "file",
                "username": user["username"],
                "name": user["name"],
                "created": time.time(),
                "expires": expires_ts,
                "downloads": 0
            }
            save_shares(shares)
            # Build URL using Host header
            host = self.headers.get("Host", "localhost:" + str(PORT))
            proto = "https" if "443" in host else "http"
            url = f"{proto}://{host}/s/{share_id}"
            self.send_json({"ok": True, "id": share_id, "url": url})
            return

        if path == "/api/share/delete":
            user = self.get_user()
            if not user:
                self.send_json({"error": "unauthorized"}, 401)
                return
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            share_id = body.get("id", "")
            shares = load_shares()
            share_data = shares.get(share_id)
            if not share_data:
                self.send_json({"error": "Share not found"}, 404)
                return
            # Only owner or admin can delete
            if share_data.get("username") != user["username"] and user.get("role") != "admin":
                self.send_json({"error": "forbidden"}, 403)
                return
            del shares[share_id]
            save_shares(shares)
            self.send_json({"ok": True})
            return

        if path == "/api/upload":
            user = self.get_user()
            if not user:
                self.send_json({"error": "unauthorized"}, 401)
                return
            content_type = self.headers.get("Content-Type", "")
            form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type})
            upload_path = form.getvalue("path", "").strip("/")
            users = load_users()
            ud = users.get(user["username"], {})
            if not user_can_access(ud, upload_path):
                self.send_json({"error": "Access denied to this bucket"}, 403)
                return
            file_item = form["file"]
            if file_item.filename:
                dest_dir = os.path.join(DATA_DIR, upload_path) if upload_path else DATA_DIR
                os.makedirs(dest_dir, exist_ok=True)
                dest = os.path.join(dest_dir, file_item.filename)
                with open(dest, "wb") as f:
                    while True:
                        chunk = file_item.file.read(1048576)
                        if not chunk:
                            break
                        f.write(chunk)
                meta = load_meta()
                fpath = ((upload_path + "/" if upload_path else "") + file_item.filename).strip("/")
                meta[fpath] = {"user": user["name"], "time": time.time(), "username": user["username"]}
                save_meta(meta)
                self.send_json({"ok": True, "file": file_item.filename})
            else:
                self.send_json({"error": "no file"}, 400)
            return

        if path == "/api/mkdir":
            user = self.get_user()
            if not user:
                self.send_json({"error": "unauthorized"}, 401)
                return
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            rel = body.get("path", "").strip("/")
            name = body.get("name", "").strip()
            users = load_users()
            ud = users.get(user["username"], {})
            target = ((rel + "/" if rel else "") + name).strip("/")
            if not user_can_access(ud, target):
                self.send_json({"error": "Access denied"}, 403)
                return
            full = os.path.join(DATA_DIR, rel, name) if rel else os.path.join(DATA_DIR, name)
            os.makedirs(full, exist_ok=True)
            meta = load_meta()
            meta[target] = {"user": user["name"], "time": time.time(), "username": user["username"]}
            save_meta(meta)
            self.send_json({"ok": True})
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, *a):
        pass

print("Cloud-Zhero v9 (multi-select + zip + delete + rename + folder sharing) on :" + str(PORT))
http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
