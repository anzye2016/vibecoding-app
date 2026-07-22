# VibeCoding

Continue opencode conversations from your phone.
在手机上继续电脑 opencode 的对话。

```
Phone App ←──WSS──→ your-domain.com:443 (nginx) ──WS──→ 127.0.0.1:8766 (relay) ←──WSS──→ PC Client → opencode
```

## Quick Start / 快速开始

1. **Copy config**: `cp config.example.json config.json`, edit with your paths / 复制配置文件并修改
2. **Deploy relay** → set tokens and systemd → start / 部署中继服务器
3. **Run PC client** → connect to relay / 运行 PC 客户端
4. **Build and install App** → fill in connection info / 编译安装 App

## Directory Structure / 目录结构

```
vibecoding-app/
├── config.example.json       # config template (committed)
├── config.json               # actual config (gitignored)
├── app/                      # Expo Android app
├── client/                   # PC client (Windows / Linux)
├── relay/                    # relay server
├── scripts/                  # deployment helpers
└── assets/
```

## Relay Server / 中继服务器

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
sudo systemctl daemon-reload && sudo systemctl enable --now vibecoding-relay
```

### Nginx Reverse Proxy

Run `relay/fix-nginx.py` after SSL is configured. Manual equivalent:

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
Token 通过 WebSocket 子协议传输，不经过 URL。

| Role | Token Source |
|------|-------------|
| PC | `RELAY_TOKEN` env var or `client/.vibecoding-token` file |
| Phone | Manual input in app settings (saved to AsyncStorage) |

Connection URL (no token in URL / 不含 Token):

```
wss://your-domain.com/vibecoding/ws/{room}/{role}
```

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

Environment variables override config.json. 环境变量优先于配置文件。

---

## PC Client / PC 客户端

### Install & Run / 安装运行

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

The wrapper uses exponential backoff on crashes (5s → max 60s). 崩溃时指数退避。

### Linux Notes / Linux 说明

Runs directly. opencode must be in PATH. `/compact` is unavailable (Windows only).
直接运行，opencode 需在 PATH 中。/compact 不可用。

### Commands / 特殊命令

| Command | Description |
|---------|-------------|
| `/model provider/model` | Switch model / 切换模型 |
| `/variant high/minimal/max` | Reasoning effort / 推理强度 |
| `/compact` | Compact conversation (Windows only) / 压缩对话 |
| `!!restart` | Restart PC client / 重启客户端 |

### Stats Display / Token 统计

After each response: `c=ctx o=out r=reasoning` + model name. 每次回复后显示。

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

Fill in Relay URL / Token / Room ID / Work Dir. All values auto-save. No recompile needed to switch servers.
设置页填入 Relay URL、Token、房间名、项目目录。自动保存，换服务器不重编译。

### Display / 显示

- Monospace text + code blocks (dark background, blue left border)
- `Thinking...` spinner while processing
- Auto-loads last 10 rounds on first connect
- Long-press to copy

---

## Security / 安全

| Measure | Detail |
|---------|--------|
| Transport | WSS (TLS) end-to-end |
| Relay bind | 127.0.0.1 only |
| Role isolation | Separate PC/Phone tokens |
| Token compare | `timingSafeEqual` against timing attacks |
| Rate limiting | 30 msg/10s per room, 20 conn/min per IP |
| Dir whitelist | Restricts accessible paths |

## Security Considerations / 安全说明与免责

⚠️ **This project is provided as-is, without any warranty. 本软件按现状提供，无任何保证。**

| Risk | Warning / 说明 |
|------|----------------|
| Token in plaintext on disk | PC: `client/.vibecoding-token`; Phone: AsyncStorage. Keep device secure. 设备安全由用户自行保障。 |
| No certificate pinning | App trusts system CAs. Use a valid TLS certificate. App 信任系统 CA，请确保证书有效。 |
| Relay sees plaintext messages | TLS terminates at nginx. Run relay on trusted infrastructure. Relay 能读到明文，请部署在可信环境。 |
| Client-side whitelist only | A modified client bypasses it. No server-side enforcement. 白名单仅客户端侧，可被绕过。 |
| No cloud backup of tokens | Lost token = lost access. Back up manually. Token 丢失无法找回，请自行备份。 |

**You are responsible for**: securing your own relay, tokens, and devices. The authors are not liable for any misuse or data breaches.
**用户自行承担**：中继服务器安全、Token 保管、设备安全。作者不对滥用或数据泄露承担责任。

Third-party dependencies (npm, pip, Expo, React Native) are subject to their own licenses.
第三方依赖（npm、pip、Expo、React Native）适用各自许可证。

## License / 开源许可

Apache-2.0 — see [LICENSE](./LICENSE)
