# VibeCoding

**中文** — 在手机上继续电脑 opencode 的对话。  
**English** — Continue opencode conversations from your phone.

```
Phone App ←──WSS──→ your-domain.com:443 (nginx) ──WS──→ 127.0.0.1:8766 (relay) ←──WSS──→ PC Client → opencode
```

---

## Quick Start / 快速开始

1. **Copy config**: `cp config.example.json config.json`, edit with your paths
2. **Deploy relay** → set tokens and systemd → start
3. **Run PC client** → connect to relay
4. **Build and install App** → fill in connection info

---

## Directory Structure / 目录结构

```
vibecoding-app/
├── config.example.json       # config template (committed)
├── config.json               # actual config (gitignored, create from template)
├── app/                      # Expo Android app
├── client/                   # PC client (Windows / Linux)
│   ├── client.js
│   ├── compact.py            # Windows terminal automation
│   ├── stats.py
│   └── last5.py
├── relay/                    # relay server
│   ├── server.js
│   ├── fix-nginx.py
│   └── package.json
├── scripts/
│   └── vibecoding-client-wrapper.ps1
└── assets/
```

---

## Relay Server / 中继服务器

Deploy on a cloud server, managed by systemd.

### Tokens / Token

```bash
openssl rand -hex 32  # for PC
openssl rand -hex 32  # for Phone
```

### systemd Service

`/etc/systemd/system/vibecoding-relay.service`:

```ini
[Unit]
Description=VibeCoding Relay Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/vibecoding-relay
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=HOST=127.0.0.1
Environment=PORT=8766
Environment=ORIGIN=https://your-domain.com
Environment=PC_TOKEN=your_pc_token_here
Environment=PHONE_TOKEN=your_phone_token_here

[Install]
WantedBy=multi-user.target
```

### Deploy / 部署

```bash
scp relay/package.json relay/server.js user@your-server:/opt/vibecoding-relay/
ssh user@your-server "cd /opt/vibecoding-relay && npm install"
sudo systemctl daemon-reload
sudo systemctl enable --now vibecoding-relay
```

### Nginx Reverse Proxy

After SSL is configured, run `relay/fix-nginx.py` (reads domain from config.json). Manual equivalent:

```nginx
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
}
```

---

## Authentication / 认证机制

Tokens are sent via WebSocket subprotocol (`Sec-WebSocket-Protocol`), not in the URL.

| Role | Token Source |
|------|-------------|
| PC | `RELAY_TOKEN` env var or `client/.vibecoding-token` file |
| Phone | Manual input in app settings (saved to AsyncStorage) |

Connection URL (no token in URL): `wss://your-domain.com/vibecoding/ws/{room}/{role}`

---

## Config File / 配置文件

```json
{
  "relayUrl": "wss://your-domain.com/vibecoding/ws",
  "relayOrigin": "https://your-domain.com",
  "relayHost": "127.0.0.1",
  "relayPort": 8766,
  "compactPython": "python",
  "opencodeBinWsl": "/home/YOU/.npm-global/bin/opencode",
  "statsDbPaths": ["/home/YOU/.local/share/opencode/opencode.db"],
  "allowedDirs": ["/home/YOU/projects/"]
}
```

Environment variables override config.json.

---

## PC Client / PC 客户端

### Install & Run

```bash
cd client
npm install
node client.js
```

### Environment Variables / 环境变量

| Variable | Default | Description |
|----------|---------|-------------|
| `ROOM` | `default` | Room name |
| `RELAY_URL` | `config.relayUrl` | Relay address |
| `RELAY_TOKEN` | reads `.vibecoding-token` | PC auth token |
| `OPENDCODE_BIN` | auto-detected | opencode binary path |
| `OPENDCODE_MODE` | `json` | Output format |
| `COMPACT_PYTHON` | `config.compactPython` | Python interpreter |

### Directory Whitelist / 目录白名单

Configure `allowedDirs` in config.json. Supports Windows, WSL, and Linux paths.

### Auto-start (Windows) / 开机自启

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"C:\vibecoding-app\scripts\vibecoding-client-wrapper.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "vibecoding-client" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
```

The wrapper uses exponential backoff on crashes (5s → max 60s).

### Linux Notes / Linux 说明

Runs directly. opencode must be in PATH. `/compact` is unavailable (requires Windows terminal automation).

### Commands / 特殊命令

| Command | Description |
|---------|-------------|
| `/model provider/model` | Switch model |
| `/variant high/minimal/max` | Reasoning effort |
| `/compact` | Compact conversation (Windows only) |
| `!!restart` | Restart PC client |

### Stats Display / Token 统计

After each response, the client shows: `c=ctx o=out r=reasoning` and model name.

---

## App

### Build / 编译

```powershell
cd C:\vibecoding-app
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease
```

APK: `android/app/build/outputs/apk/release/app-release.apk`

### Connect / 连接

Fill in Relay URL / Token / Room ID / Work Dir in settings. All values auto-save. No recompilation needed to switch servers.

### Display / 显示

- Monospace text + code blocks (dark background, blue left border)
- `Thinking...` spinner while processing
- Auto-loads last 10 conversation rounds on first connect
- Long-press to select and copy text

---

## Security / 安全

| Measure | Detail |
|---------|--------|
| Transport | WSS (TLS) end-to-end |
| Relay bind | 127.0.0.1 only |
| Role isolation | Separate PC/Phone tokens |
| Token compare | `timingSafeEqual` against timing attacks |
| Dir whitelist | Restricts accessible paths |

---

## Security Considerations / 安全说明

| Risk | Mitigation / Warning |
|------|---------------------|
| **Token stored in plaintext on disk** | PC: `client/.vibecoding-token` file. Phone: AsyncStorage (plaintext). Keep your device secure, no auto-rotation. |
| **No rate limiting on relay** | ⚠️ Added default limits (30 msg/10s per room, 5 conn/min per IP). Tune in relay code if needed. |
| **No certificate pinning** | App trusts system CAs. Ensure your relay uses a valid TLS certificate. |
| **Relay sees all messages** | TLS terminates at nginx, relay sees plaintext. Run relay on trusted infrastructure only. |
| **Directory whitelist enforced client-side** | A modified client can bypass this. Server-side enforcement not supported. |

**Disclaimer / 免责声明**: This project is provided as-is, without any warranty. You are responsible for securing your own relay server, tokens, and devices. The authors are not liable for any misuse or data breaches.

## License / 开源许可

Apache-2.0
