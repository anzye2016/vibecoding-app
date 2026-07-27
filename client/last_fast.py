import json, sys, subprocess, os, sqlite3

sid = sys.argv[1]
cwd = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()

# Get DB path from opencode (fast, just returns a path)
try:
    r = subprocess.run(["opencode.cmd", "db", "path"], capture_output=True, text=True, encoding="utf-8", cwd=cwd)
except FileNotFoundError:
    r = subprocess.run(["opencode", "db", "path"], capture_output=True, text=True, encoding="utf-8", cwd=cwd)

db_path = r.stdout.strip()
if not db_path or not os.path.exists(db_path):
    print(json.dumps([]))
    sys.exit(0)

# Open SQLite directly
conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
c = conn.cursor()

# Get recent user + assistant messages (limit 200)
c.execute("SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 200", (sid,))
msg_rows = c.fetchall()

msg_ids = [r["id"] for r in msg_rows]
if not msg_ids:
    print(json.dumps([]))
    sys.exit(0)

# Get all parts for these messages (one query)
placeholders = ",".join("?" * len(msg_ids))
c.execute(f"SELECT message_id, data FROM part WHERE message_id IN ({placeholders}) ORDER BY time_created ASC", msg_ids)
part_rows = c.fetchall()

conn.close()

# Group parts by message_id
parts_by_msg = {}
for p in part_rows:
    mid = p["message_id"]
    if mid not in parts_by_msg:
        parts_by_msg[mid] = []
    parts_by_msg[mid].append(p["data"])

# Build rounds (chronological order)
rounds = []
u_text = None

for r in reversed(msg_rows):
    info = {}
    try:
        info = json.loads(r["data"]) if isinstance(r["data"], str) else {}
    except:
        pass
    role = info.get("role", "")
    parts = parts_by_msg.get(r["id"], [])
    text = ""
    for pd in parts:
        try:
            p = json.loads(pd) if isinstance(pd, str) else {}
        except:
            continue
        t = p.get("type")
        if t == "text":
            text += "\n\n" + p.get("text", "")
        elif t == "tool":
            inp = (p.get("state") or {}).get("input") or {}
            cmd = inp.get("command") or inp.get("filePath") or ""
            if cmd:
                text += "\n\n[{}] {}".format(p.get("tool", ""), cmd)
    text = text.strip()
    if not text:
        continue
    if role == "user":
        if not (rounds and rounds[-1]["user"] == text):
            u_text = text
    elif role == "assistant" and u_text is not None:
        if rounds and rounds[-1]["user"] == u_text and "assistant" in rounds[-1]:
            rounds[-1]["assistant"] += "\n\n" + text
        else:
            rounds.append({"user": u_text, "assistant": text})

print(json.dumps(rounds[-30:]))
