import json, sys
d = json.load(sys.stdin)
msgs = d.get("messages", [])
rounds = []
u = None
for m in msgs:
    r = m.get("info", {}).get("role")
    parts = m.get("parts", [])
    t = ""
    for p in parts:
        if p.get("type") == "text":
            t = p.get("text", "")
            break
    if not t.strip(): continue
    if r == "user":
        u = t
    elif r == "assistant" and u is not None:
        rounds.append({"user": u[:500], "assistant": t[:500]})
        u = None
print(json.dumps(rounds[-5:]))
