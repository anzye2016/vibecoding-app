# VibeCoding

在手机上继续电脑 opencode 的对话。

```
手机 App ←──WSS──→ your-domain.com:443 (nginx) ──WS──→ 127.0.0.1:8766 (relay) ←──WSS──→ PC 客户端 → opencode
```

## 截图

<p align="center">
  <img src="assets/screenshot1.jpg" width="300" alt="VibeCoding">
  <img src="assets/screenshot2.jpg" width="300" alt="VibeCoding">
</p>

## 快速开始

1. **复制配置**：`cp config.example.json config.json`，修改为自己的路径
2. **部署中继服务器** → 配置 Token 和 systemd → 启动
3. **运行 PC 客户端** → 连接 relay
4. **编译安装 App** → 填入连接信息

## 目录结构

```
vibecoding-app/
├── config.example.json       配置模板（提交 git）
├── config.json               实际配置（不提交，从模板创建）
├── app/                      Expo Android 应用
├── client/                   PC 客户端（Windows / Linux）
├── relay/                    中继服务器
├── scripts/                  部署辅助脚本
├── assets/                   图标、截图
└── LICENSE
```

## 中继服务器

部署在云服务器，systemd 管理。

### 生成 Token

```bash
openssl rand -hex 32  # PC 用
openssl rand -hex 32  # Phone 用
```

### systemd 服务

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
Environment=HOST=127.0.0.1
Environment=PORT=8766
Environment=ORIGIN=https://your-domain.com
Environment=PC_TOKEN=your_pc_token_here
Environment=PHONE_TOKEN=your_phone_token_here

[Install]
WantedBy=multi-user.target
```

### 部署

```bash
scp relay/package.json relay/server.js user@your-server:/opt/vibecoding-relay/
ssh user@your-server "cd /opt/vibecoding-relay && npm install"
sudo systemctl daemon-reload && sudo systemctl enable --now vibecoding-relay
```

### Nginx 反向代理

配置好 SSL 后，运行 `relay/fix-nginx.py`（自动读取 config.json 中的域名）。

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

Token 通过 WebSocket 子协议（`Sec-WebSocket-Protocol`）传输，不经过 URL。

| 角色 | Token 来源 |
|------|-----------|
| PC 端 | `RELAY_TOKEN` 环境变量 或 `client/.vibecoding-token` 文件 |
| Phone 端 | App 设置页手动输入（AsyncStorage 自动保存） |

连接 URL（不含 Token）：`wss://your-domain.com/vibecoding/ws/{room}/{role}`

## 配置

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

环境变量优先于配置文件。

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

编辑 `config.json` 中的 `allowedDirs` 数组，支持 Windows、WSL、Linux 路径。

### 开机自启（Windows）

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"C:\vibecoding-app\scripts\vibecoding-client-wrapper.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "vibecoding-client" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
```

守护脚本支持崩溃指数退避（5s → 最大 60s）。

### Linux

直接运行，opencode 需在 PATH 中。`/compact` 命令不可用（依赖 Windows 终端自动化）。

### 特殊命令

| 命令 | 说明 |
|------|------|
| `/model provider/model` | 切换模型 |
| `/variant high/minimal/max` | 推理强度 |
| `/compact` | 压缩对话（仅 Windows） |
| `!!restart` | 重启 PC 客户端 |

### Token 统计

每次回复后显示：`c=上下文 o=输出 r=思考` 以及模型名称。

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

设置页填入 Relay URL / Token / Room ID / Work Dir。自动保存，换服务器无需重新编译。

### 显示

- 等宽纯文本 + 深色代码块（蓝色左边框）
- 处理中显示 Thinking... 旋转动画
- 首次连接自动加载最近 10 轮历史
- 长按可复制文本

## 安全

| 措施 | 详情 |
|------|------|
| 传输加密 | WSS（TLS）全链路 |
| Relay 监听 | 仅 127.0.0.1 |
| 角色隔离 | PC / Phone 独立 Token |
| Token 验证 | `timingSafeEqual` 防时序攻击 |
| 速率限制 | 每房间 30 条/10s，每 IP 20 次连接/分钟 |
| 目录白名单 | 限制可访问路径 |

## 安全说明与免责

⚠️ **本软件按现状提供，无任何保证。**

| 风险 | 说明 |
|------|------|
| Token 明文存储 | PC: `client/.vibecoding-token` 文件；Phone: AsyncStorage。设备安全由用户自行保障。 |
| 无证书锁定 | App 信任系统 CA，请确保证书有效。 |
| Relay 可见明文消息 | TLS 在 nginx 终止，relay 能读到明文。请部署在可信环境。 |
| 白名单仅客户端侧 | 可被绕过，服务端无强制。 |
| Token 无自动轮换 | Token 泄露后需手动更换。 |

**用户自行承担**：中继服务器安全、Token 保管、设备安全。作者不对滥用或数据泄露承担责任。

第三方依赖（npm、pip、Expo、React Native）适用各自许可证。

## 许可

Apache-2.0 — 见 [LICENSE](./LICENSE)
