import sqlite3, json, sys, os

session_id = sys.argv[1]
db_path = os.path.expanduser(r"~\.local\share\opencode\opencode.db")

db = sqlite3.connect(db_path)
msgs = db.execute(
    "SELECT data FROM message WHERE session_id=? AND json_extract(data, '$.tokens') IS NOT NULL",
    (session_id,)
).fetchall()

total_in = total_out = total_reason = total_cache = 0
for (r,) in msgs:
    d = json.loads(r)
    tokens = d.get("tokens", {})
    cache = tokens.get("cache", {})
    total_in += tokens.get("input", 0)
    total_out += tokens.get("output", 0)
    total_reason += tokens.get("reasoning", 0)
    total_cache += cache.get("read", 0) + cache.get("write", 0)

# Context is typically input + cache_read (what's sent to the model)
context = total_in + total_cache
total = total_in + total_out + total_reason

result = {
    "context": context,
    "total": total,
    "input": total_in,
    "output": total_out,
    "reasoning": total_reason,
}
print(json.dumps(result))
