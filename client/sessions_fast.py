import json, sys, subprocess, os, sqlite3, platform

dir_path = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()

def find_db():
    xdg = os.environ.get("XDG_DATA_HOME") or ""
    if xdg:
        p = os.path.join(xdg, "opencode", "opencode.db")
        if os.path.exists(p): return p
    p = os.path.join(os.path.expanduser("~"), ".local", "share", "opencode", "opencode.db")
    if os.path.exists(p): return p
    if platform.system() == "Windows":
        for base in [os.environ.get("APPDATA", ""), os.environ.get("LOCALAPPDATA", "")]:
            if base:
                p = os.path.join(base, "opencode", "opencode.db")
                if os.path.exists(p): return p
    try:
        r = subprocess.run(["opencode.cmd", "db", "path"], capture_output=True, text=True, encoding="utf-8", cwd=dir_path)
    except FileNotFoundError:
        r = subprocess.run(["opencode", "db", "path"], capture_output=True, text=True, encoding="utf-8", cwd=dir_path)
    p = r.stdout.strip()
    if p and os.path.exists(p): return p
    return None

db_path = find_db()
if not db_path:
    print(json.dumps([]))
    sys.exit(0)

conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
c = conn.cursor()

# Normalize dir path for matching
nd = dir_path.replace("\\", "/").rstrip("/") + "/"

c.execute("""
    SELECT id, data, directory, updated, title
    FROM session
    ORDER BY updated DESC
    LIMIT 100
""")
rows = c.fetchall()
conn.close()

sessions = []
for r in rows:
    sd = (r["directory"] or "").replace("\\", "/").rstrip("/") + "/"
    if sd != nd:
        continue
    t = r["title"]
    if not t and r["data"]:
        try:
            d = json.loads(r["data"]) if isinstance(r["data"], str) else {}
            t = d.get("title", "")
        except:
            pass
    sessions.append({
        "id": r["id"],
        "title": t or "",
        "updated": r["updated"] or 0,
    })

print(json.dumps(sessions))
