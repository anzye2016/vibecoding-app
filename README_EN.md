# VibeCoding

Continue opencode conversations from your phone.

```
Phone App ←──WSS──→ your-domain.com:443 (nginx) ──WS──→ 127.0.0.1:8766 (relay) ←──WSS──→ PC Client → opencode
```

## Quick Start

1. **Copy config**: `cp config.example.json config.json`, edit with your paths
2. **Deploy relay** → set tokens and systemd → start
3. **Run PC client** → connects to relay
4. **Build and install App** → fill in connection details

## Directory Structure

```
vibecoding-app/
├── config.example.json  # config template (committed)
├── config.json          # actual config (gitignored, create from template)
├── app/                 # Expo Android app
│   ├── _layout.js
│   ├── index.js
│   └── components/MarkdownBlock.js
├── client/              # PC client (Windows / Linux)
│   ├── client.js
│   ├── compact.py       # Windows terminal automation
│   ├── stats.py
│   ├── last5.py
│   └── package.json
├── relay/               # relay server
│   ├── server.js
│   ├── fix-nginx.py
│   └── package.json
├── scripts/             # deployment helpers
│   └── vibecoding-client-wrapper.ps1
└── assets/
```

## Relay Server

Deploy on a cloud server, managed by systemd.

### 1. Generate Tokens

```bash
openssl rand -hex 32  # for PC
openssl rand -hex 32  # for Phone
```

### 2. Create systemd service

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
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=8766
Environment=ORIGIN=https://your-domain.com
Environment=PC_TOKEN=your_pc_token_here
Environment=PHONE_TOKEN=your_phone_token_here

[Install]
WantedBy=multi-user.target
```

### 3. Deploy

```bash
scp relay/package.json relay/server.js user@your-server:/opt/vibecoding-relay/
ssh user@your-server "cd /opt/vibecoding-relay && npm install"
sudo systemctl daemon-reload
sudo systemctl enable --now vibecoding-relay
```

### 4. Nginx Reverse Proxy

After nginx is configured with SSL, run `relay/fix-nginx.py` to inject the WebSocket proxy config (reads domain from config.json).

Manual equivalent:

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

## Authentication

Tokens are sent via WebSocket subprotocol (`Sec-WebSocket-Protocol` header), not in the URL.

| Role | Token Source |
|------|-------------|
| PC | `RELAY_TOKEN` env var or `client/.vibecoding-token` file |
| Phone | Manual input in app settings (saved to AsyncStorage) |

Connection URL format (no token in URL):

```
wss://your-domain.com/vibecoding/ws/{room}/{role}
```

## Config File

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

Environment variables override config.json values.

## PC Client

### Install & Run

```bash
cd client
npm install
node client.js
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROOM` | `default` | Room name |
| `RELAY_URL` | `config.relayUrl` | Relay address |
| `RELAY_TOKEN` | reads `.vibecoding-token` | PC auth token |
| `OPENDCODE_BIN` | auto-detected | opencode binary path |
| `OPENDCODE_MODE` | `json` | Output format |
| `COMPACT_PYTHON` | `config.compactPython` | Python interpreter |

### Directory Whitelist

Configure `allowedDirs` in config.json. Supports Windows, WSL, and Linux paths.

### Auto-start (Windows)

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"C:\vibecoding-app\scripts\vibecoding-client-wrapper.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "vibecoding-client" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
```

The wrapper script uses exponential backoff on crashes (5s → 10s → ... → max 60s).

### Linux Notes

Runs directly on Linux. opencode must be in PATH. `/compact` is unavailable (requires Windows terminal automation).

## App

### Build

```powershell
cd C:\vibecoding-app
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease
```

APK: `android/app/build/outputs/apk/release/app-release.apk`

### Connect

Fill in Relay URL / Token / Room ID / Work Dir in the settings bar. All values are auto-saved. No recompilation needed to switch servers.

### Special Commands

| Command | Description |
|---------|-------------|
| `/model provider/model` | Switch model |
| `/variant high/minimal/max` | Reasoning effort |
| `/compact` | Compact conversation (Windows only) |
| `!!restart` | Restart PC client |

### Display

- opencode output: monospace text + code blocks (dark background, blue left border)
- Spinning `Thinking...` animation while processing
- Auto-loads last 10 conversation rounds on first connect
- Long-press to select and copy text

## Security

| Measure | Detail |
|---------|--------|
| Transport | WSS (TLS) end-to-end |
| Relay bind | 127.0.0.1 only |
| Role isolation | Separate PC/Phone tokens |
| Token comparison | `timingSafeEqual` against timing attacks |
| Directory whitelist | Restricts accessible paths |
