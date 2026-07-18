import sys

path = "/etc/nginx/sites-available/wxysyn.com"

vibecoding_block = """    # === VibeCoding ===
    location /vibecoding/ws {
        proxy_pass http://127.0.0.1:8766/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
        proxy_cache off;
    }

    # === ESP32 Relay ===
    location /relay/ {
        limit_req zone=relay burst=5 nodelay;
"""

with open(path, "r") as f:
    content = f.read()

old = "        limit_conn conn_static 50;\n        proxy_pass http://127.0.0.1:8765/;"
new = vibecoding_block + "        limit_conn conn_static 50;\n        proxy_pass http://127.0.0.1:8765/;"

content = content.replace(old, new, 1)

with open(path, "w") as f:
    f.write(content)

print("done")
