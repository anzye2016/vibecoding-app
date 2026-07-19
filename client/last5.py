import json, sys

raw = sys.stdin.buffer.read().decode("utf-8", errors="replace")
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
                lines.append(f"[{name}] {inp['command']}")
            else:
                lines.append(f"[{name}] {json.dumps(inp)}")
    return "\n\n".join(lines).strip()

rounds = []
u_text = None
a_parts = []

for m in msgs:
    r = m.get("info", {}).get("role")
    text = extract(m)
    if not text:
        continue
    if r == "user":
        if u_text is not None and a_parts:
            rounds.append({"user": u_text, "assistant": "\n\n".join(a_parts)})
        u_text = text
        a_parts = []
    elif r == "assistant":
        a_parts.append(text)

if u_text is not None and a_parts:
    rounds.append({"user": u_text, "assistant": "\n\n".join(a_parts)})

print(json.dumps(rounds[-10:]))
