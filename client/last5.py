import json, sys

with open(sys.argv[1], "r", encoding="utf-8") as f:
    raw = f.read()
d = json.loads(raw)
msgs = d.get("messages", [])

def extract(m):
    lines = []
    for p in m.get("parts", []):
        t = p.get("type")
        if t == "text":
            lines.append(p.get("text", ""))
        elif t == "tool":
            name = p.get("tool", "")
            state = p.get("state", {})
            inp = state.get("input", {})
            if isinstance(inp, dict) and "command" in inp:
                lines.append("[{}] {}".format(name, inp["command"]))
            elif isinstance(inp, dict) and "filePath" in inp:
                lines.append("[{}] {}".format(name, inp["filePath"]))
            else:
                lines.append("[{}] {}".format(name, json.dumps(inp)[:200]))
    result = "\n\n".join(lines).strip()
    return result

rounds = []
u_text = None

for m in msgs:
    r = m.get("info", {}).get("role")
    text = extract(m)
    if not text:
        continue
    if r == "user":
        u_text = text
    elif r == "assistant" and u_text is not None:
        rounds.append({"user": u_text, "assistant": text})

print(json.dumps(rounds[-30:]))
