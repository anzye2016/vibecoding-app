import json, sys, subprocess, os, time
from collections import OrderedDict

sid = sys.argv[1]
cwd = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()

def db(query):
    try:
        r = subprocess.run(["opencode.cmd", "db", query, "--format", "json"], capture_output=True, text=True, encoding="utf-8", cwd=cwd)
    except FileNotFoundError:
        r = subprocess.run(["opencode", "db", query, "--format", "json"], capture_output=True, text=True, encoding="utf-8", cwd=cwd)
    return json.loads(r.stdout) if r.stdout.strip() else []

t0 = time.time()

# Get recent user + assistant messages (limit 200)
msg_rows = db(f"SELECT id, data FROM message WHERE session_id = '{sid}' ORDER BY time_created DESC LIMIT 200")
msg_ids = [r["id"] for r in msg_rows]

# Get all parts for these messages
parts_rows = []
if msg_ids:
    ids_str = ",".join("'" + i + "'" for i in msg_ids)
    parts_rows = db(f"SELECT message_id, data FROM part WHERE message_id IN ({ids_str}) ORDER BY time_created ASC")

# Group parts by message_id
parts_by_msg = {}
for p in parts_rows:
    mid = p["message_id"]
    if mid not in parts_by_msg:
        parts_by_msg[mid] = []
    parts_by_msg[mid].append(p["data"])

# Build rounds (chronological order)
rounds = []
u_text = None

for r in reversed(msg_rows):
    info = {}
    try: info = json.loads(r["data"]) if isinstance(r["data"], str) else {}
    except: pass
    role = info.get("role", "")
    parts = parts_by_msg.get(r["id"], [])
    text = ""
    for pd in parts:
        try: p = json.loads(pd) if isinstance(pd, str) else {}
        except: continue
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

t = time.time() - t0
print(json.dumps(rounds[-30:]), file=sys.stdout)
print(f"[last_fast] {len(rounds)} rounds in {t:.1f}s", file=sys.stderr)
