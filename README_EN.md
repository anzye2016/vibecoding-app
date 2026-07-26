# VibeCoding

Continue opencode conversations from your phone.

```
Phone App ←──WSS──→ your-domain.com:443 (nginx) ──WS──→ 127.0.0.1:8766 (relay) ←──WSS──→ PC Client → opencode
```

## Screenshots

<p align="center">
  <img src="assets/vibecoding-themes-row.png" width="100%" alt="VibeCoding 5 themes × dark/light mode">
</p>

## Installation

### 1. Local Environment (Windows)

```powershell
scripts\setup.bat
```

Automatically:
- Checks Node.js / Python
- Runs `npm install`
- Creates `config.json` from template
- Generates `client/.vibecoding-token`

Then edit `config.json` with your relay address:

```json
{
  "relayUrl": "wss://your-domain.com/vibecoding/ws",
  "relayOrigin": "https://your-domain.com"
}
```

### 2. Relay Server (Linux)

SSH into your server and run:

```bash
bash scripts/setup-server.sh your-domain.com
```

Automatically:
- Installs Node.js
- Deploys relay to `/opt/vibecoding-relay/`
- Generates random tokens
- Creates systemd service and starts it
- Configures nginx WebSocket proxy
- Configures fail2ban for auth protection

> You need SSL certificates first: `certbot --nginx -d your-domain.com`

### 3. Sync Tokens

After server setup, view the tokens:

```bash
cat /opt/vibecoding-relay/tokens.env
```

Copy `PC_TOKEN` to `client/.vibecoding-token` on your PC. Save `PHONE_TOKEN` for the app.

### 4. Run PC Client

```bash
node client/client.js
```

See "Auto-start" below for running at boot.

### 5. Build & Install App

```powershell
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease
```

APK: `android/app/build/outputs/apk/release/app-release.apk`

Open the app, go to Settings and fill in:
- **Relay URL**: `wss://your-domain.com/vibecoding/ws`
- **Token**: the server's `PHONE_TOKEN`
- **Room ID**: `default` (must match PC client)
- **Work Dir**: your project path

## Directory Structure

```
vibecoding-app/
├── config.example.json       config template
├── config.json               actual config (gitignored)
├── app/                      Expo Android app
├── client/                   PC client
├── relay/                    relay server
├── scripts/
│   ├── setup.bat             Windows one-click setup
│   ├── setup-server.sh       Server one-click deploy
│   └── vibecoding-client-wrapper.ps1  daemon script
├── assets/
└── README.md
```

## Authentication

Tokens are sent via WebSocket subprotocol (`Sec-WebSocket-Protocol`), not in the URL.

| Role | Token Source |
|------|-------------|
| PC | `RELAY_TOKEN` env var or `client/.vibecoding-token` file |
| Phone | Manual input in app settings (saved to AsyncStorage) |

Connection URL (no token in URL): `wss://your-domain.com/vibecoding/ws/{room}/{role}`

## Configuration

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

## PC Client

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

The wrapper uses exponential backoff on crashes (5s → max 60s).

### Linux

Runs directly. opencode must be in PATH. `/compact` requires Windows terminal automation.

### Reconnect

TCP keepalive (15s) detects half-open connections. Combined with relay message buffering:

- **Foreground disconnect**: Auto-reconnects within 1s, preserves chat.
- **Background/lock disconnect**: Auto-reconnects on return to foreground.
- **Manual Disconnect**: Does NOT auto-reconnect. Tap Connect to resume.

### Commands

| Command | Description |
|---------|-------------|
| `/model provider/model` | Switch model |
| `/variant high/minimal/max` | Reasoning effort |
| `/compact` | Compact conversation (Windows only) |
| `!!restart` | Restart PC client |

### Stats Display

After each response: `c=ctx o=out r=reasoning` and model name.

## Relay Server

After running `scripts/setup-server.sh`, the relay runs as a systemd service. Supports offline message buffering (up to 500 PC→phone messages while phone is disconnected, flushed on reconnect).

### Manual nginx Reference

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

## App

### Build

```powershell
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease
```

APK: `android/app/build/outputs/apk/release/app-release.apk`

### Connect

Fill in Relay URL / Token / Room ID / Work Dir in settings. All values auto-save. No recompile needed to switch servers.

### Display

- V2 Bold Modern UI: chat bubbles (user accent / assistant card)
- 5 themes (Zinc / Slate / Forest / Rose / Amber) with dark/light mode
- Custom colors (bg/text/accent/text2) and chat background image
- Code blocks with colored left border; tables auto-wrap
- `Thinking...` spinner while processing
- Auto-loads last 30 rounds on first connect (configurable)
- Settings panel: connection config, theme picker, color customization

## Security

| Measure | Detail |
|---------|--------|
| Transport | WSS (TLS) end-to-end |
| Relay bind | 127.0.0.1 only |
| Role isolation | Separate PC/Phone tokens |
| Token compare | `timingSafeEqual` against timing attacks |
| Rate limiting | 30 msg/10s per room, 20 conn/min per IP |
| Msg buffer | Relay buffers up to 500 PC→phone messages when phone is offline |
| Dir whitelist | Restricts accessible paths |

## Security & Disclaimer

⚠️ **This project is provided as-is, without any warranty. Use at your own risk.**

| Risk | Note |
|------|------|
| **opencode has no sandbox** | 🔴 opencode runs with your user privileges and **can read/write any file on disk**. The directory whitelist only restricts which project you can select in the VibeCoding app — opencode itself has no sandbox. |
| Token stored in plaintext | PC: `client/.vibecoding-token` file. Phone: AsyncStorage. |
| No certificate pinning | App trusts system CAs. Malicious CA on device could intercept traffic. |
| Relay sees plaintext messages | TLS terminates at nginx. Run on trusted infrastructure. |
| Client-side whitelist only | Can be bypassed by a modified client. |
| No token rotation | Tokens are permanent until manually replaced. |

**You are responsible for**: securing your relay, tokens, and devices. The authors are not liable for any misuse or damages.

Third-party dependencies (npm, pip, Expo, React Native) are subject to their own licenses.

## License

MIT — see [LICENSE](./LICENSE)
