import json, sys, os, re

def extract(text):
    lines = []
    for p in text.get("parts", []):
        t = p.get("type")
        if t == "text":
            lines.append(p.get("text", ""))
        elif t == "tool":
            inp = (p.get("state") or {}).get("input") or {}
            cmd = inp.get("command") or inp.get("filePath") or ""
            if cmd:
                lines.append("[{}] {}".format(p.get("tool", ""), cmd))
    return "\n\n".join(lines).strip()

export_file = sys.argv[1]
out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(export_file)

session_id = os.path.splitext(os.path.basename(export_file))[0]
track_file = os.path.join(out_dir, f".{session_id}_extracted_count")
out_file = os.path.join(out_dir, f"{session_id}_user_qs.json")

with open(export_file, "r", encoding="utf-8") as f:
    raw = f.read()

d = json.loads(raw)

prev_count = 0
if os.path.exists(track_file):
    with open(track_file, "r") as f:
        try: prev_count = int(f.read().strip())
        except: pass

all_msgs = d.get("messages", [])
existing = []
if os.path.exists(out_file):
    with open(out_file, "r", encoding="utf-8") as f:
        existing = json.load(f)

new_count = 0
for m in all_msgs[prev_count:]:
    if m.get("info", {}).get("role") == "user":
        text = extract(m)
        if text:
            existing.append({"idx": prev_count + new_count, "text": text})
            new_count += 1

with open(out_file, "w", encoding="utf-8") as f:
    json.dump(existing, f, ensure_ascii=False, indent=2)

with open(track_file, "w") as f:
    f.write(str(len(all_msgs)))

print(f"Total user questions: {len(existing)} (new: {new_count})")
print(f"Saved to: {out_file}")
