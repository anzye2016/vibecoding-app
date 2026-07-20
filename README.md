# VibeCoding

在手机上继续电脑 opencode 的对话。

```
手机 App ←──WSS──→ your-domain.com:443 (nginx) ──WS──→ 127.0.0.1:8766 (relay) ←──WSS──→ PC 客户端 → opencode
```

## 快速开始

1. **复制配置文件**：`cp config.example.json config.json`，修改为自己的路径
2. **部署中继服务器** → Token 和 systemd 配置 → 启动
3. **运行 PC 客户端** → 连接 relay
4. **编译安装 App** → 填写连接信息

## 目录结构

```
vibecoding-app/
├── config.example.json  # 配置模板（提交 git）
├── config.json          # 实际配置（不提交，自己从模板创建）
├── app/                 # Expo Android 应用
│   ├── _layout.js
│   ├── index.js
│   └── components/MarkdownBlock.js
├── client/              # PC 客户端（Windows / Linux）
│   ├── client.js
│   ├── compact.py       # Windows 终端自动化
│   ├── stats.py
│   ├── last5.py
│   └── package.json
├── relay/               # 中继服务器
│   ├── server.js
│   ├── fix-nginx.py
│   └── package.json
├── scripts/             # 部署辅助
│   └── vibecoding-client-wrapper.ps1
└── assets/
```

## 中继服务器

部署在云服务器上，systemd 管理。

### 1. 准备 Token

```bash
# 生成两个 64 位十六进制 token
openssl rand -hex 32  # PC 用
openssl rand -hex 32  # Phone 用
```

### 2. 创建 systemd service

`/etc/systemd/system/vibecoding-relay.service`：

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

### 3. 部署

```bash
scp relay/package.json relay/server.js user@your-server:/opt/vibecoding-relay/
ssh user@your-server "cd /opt/vibecoding-relay && npm install"
sudo systemctl daemon-reload
sudo systemctl enable --now vibecoding-relay
```

### 4. Nginx 反向代理

已配置 nginx 证书后，运行 `relay/fix-nginx.py` 自动注入 WebSocket 代理配置（读取 config.json 中的域名）。

手动配置等效于：

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

## 认证机制

Token 通过 WebSocket 子协议（`Sec-WebSocket-Protocol` header）传输，不经过 URL。

| 角色 | Token 来源 |
|------|-----------|
| PC 端 | `RELAY_TOKEN` 环境变量 或 `client/.vibecoding-token` 文件 |
| Phone 端 | App 设置页手动输入（AsyncStorage 自动保存） |

连接 URL 格式（不含 Token）：

```
wss://your-domain.com/vibecoding/ws/{room}/{role}
```

## 配置文件

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

环境变量优先于 config.json。

## PC 客户端

### 安装运行

```bash
cd client
npm install
node client.js
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ROOM` | `default` | 房间名 |
| `RELAY_URL` | `config.relayUrl` | 中继地址 |
| `RELAY_TOKEN` | 读 `.vibecoding-token` 文件 | PC 认证 token |
| `OPENDCODE_BIN` | 自动检测 | opencode 可执行文件路径 |
| `OPENDCODE_MODE` | `json` | 输出格式 |
| `COMPACT_PYTHON` | `config.compactPython` | Python 解释器 |

### 目录白名单

在 `config.json` 中配置 `allowedDirs`，支持 Windows / WSL / Linux 路径。

### 开机自启（Windows）

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"C:\vibecoding-app\scripts\vibecoding-client-wrapper.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "vibecoding-client" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
```

守护脚本支持崩溃指数退避（5s → 10s → ... → max 60s）。

### Linux 说明

Linux 上直接运行，opencode 需在 PATH 中。`/compact` 命令不可用（依赖 Windows 终端自动化）。

## App

### 编译

```powershell
cd C:\vibecoding-app
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease
```

APK 位置：`android/app/build/outputs/apk/release/app-release.apk`

### 连接

设置页填入：Relay URL / Token / Room ID / Work dir。所有值自动保存，无需重新编译即可更换服务器。

### 特殊命令

| 命令 | 说明 |
|------|------|
| `/model provider/model` | 切换模型 |
| `/variant high/minimal/max` | 推理强度 |
| `/compact` | 压缩对话（仅 Windows） |
| `!!restart` | 重启 PC 客户端 |

### 显示

- opencode 输出：纯文本（等宽） + 代码块（深色背景蓝色左边框）
- 处理中显示 `Thinking...` 旋转动画
- 首次连接自动加载最近 10 轮历史
- 所有文本长按可复制

## 安全

| 措施 | 详情 |
|------|------|
| 传输加密 | WSS（TLS）全链路 |
| Relay 监听 | 仅 127.0.0.1 |
| 角色隔离 | PC / Phone 独立 Token |
| Token 验证 | `timingSafeEqual` 防时序攻击 |
| 目录白名单 | 限制可访问路径 |
