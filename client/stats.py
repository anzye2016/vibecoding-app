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
    "SELECT data FROM message WHERE session_id=? AND json_extract(data, '$.tokens') IS NOT NULL",
    (session_id,)
).fetchall()

total_in = total_out = total_reason = total_cache = 0
model = variant = ""
for (r,) in msgs:
    d = json.loads(r)
    tokens = d.get("tokens", {})
    cache = tokens.get("cache", {})
    total_in += tokens.get("input", 0)
    total_out += tokens.get("output", 0)
    total_reason += tokens.get("reasoning", 0)
    total_cache += cache.get("read", 0) + cache.get("write", 0)
    if not model and d.get("modelID"):
        model = d["providerID"] + "/" + d["modelID"]
    if not variant:
        variant = d.get("variant", "")

context = total_in + total_cache
total = total_in + total_out + total_reason

print(json.dumps({
    "context": context,
    "total": total,
    "input": total_in,
    "output": total_out,
    "reasoning": total_reason,
    "model": model,
    "variant": variant,
}))
