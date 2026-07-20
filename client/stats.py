import sqlite3, json, sys, os

session_id = sys.argv[1]

paths = [
    os.path.expanduser(r"~\.local\share\opencode\opencode.db"),
    "/home/anzye/.local/share/opencode/opencode.db",
    "/home/anzye/.opencode/opencode.db",
]

db = None
for p in paths:
    if os.path.exists(p):
        try:
            db = sqlite3.connect(p)
            if db.execute("SELECT 1 FROM message WHERE session_id=? LIMIT 1", (session_id,)).fetchone():
                break
            db.close()
            db = None
        except:
            db = None

if not db:
    print(json.dumps({"error": "session not found"}))
    sys.exit(0)

msgs = db.execute(
    "SELECT data FROM message WHERE session_id=? AND json_extract(data, '$.tokens') IS NOT NULL ORDER BY id",
    (session_id,)
).fetchall()

cum_in = cum_out = 0
last_in = last_out = 0
model = variant = ""
for (r,) in msgs:
    d = json.loads(r)
    tokens = d.get("tokens", {})
    inp = tokens.get("input", 0)
    out = tokens.get("output", 0)
    if inp > 0 or out > 0:
        last_in = inp
        last_out = out
    cum_in += inp
    cum_out += out
    mid = d.get("modelID", "")
    if mid:
        model = mid
        v = d.get("variant", "")
        if v:
            variant = v

print(json.dumps({
    "last_in": last_in,
    "last_out": last_out,
    "sum_in": cum_in,
    "sum_out": cum_out,
    "model": model,
    "variant": variant,
}))
