import http.server, json, os, time, uuid, shutil, cgi, urllib.parse
from http.cookies import SimpleCookie
from datetime import datetime

PORT = 8585
DATA_DIR = r"D:\minio-hdd\data"
META_FILE = r"D:\minio\upload_meta.json"
HTML_FILE = r"D:\minio\cloud_zhero.html"
USERS_FILE = r"D:\minio\users.json"
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

print("Cloud-Zhero v4 (fixed admin + security) on :" + str(PORT))
http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
