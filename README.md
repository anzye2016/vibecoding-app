# VibeCoding

在手机上继续电脑 opencode 的对话。

```
手机 App ←──WSS──→ your-domain.com:443 (nginx) ──WS──→ 127.0.0.1:8766 (relay) ←──WSS──→ PC 客户端 → opencode
```

## 快速开始

1. **复制配置文件**：`cp config.example.json config.json`，修改为自己的设置
2. **PC 客户端**：见 [PC 客户端](#pc-客户端)
3. **手机 App**：编译安装，填入 Token / Room ID / Work dir 连接
4. **中继服务器**：部署 relay，确保 Token 一致

## 目录结构

```
vibecoding-app/
├── config.example.json  # 配置模板（提交git）
├── config.json          # 实际配置（不提交git，自己创建）
├── app/                 # Expo Android 应用
│   ├── _layout.js           # 根布局（ErrorBoundary）
│   ├── index.js             # 聊天 UI
│   └── components/
│       └── MarkdownBlock.js  # 代码块渲染
├── client/              # PC 客户端
│   ├── client.js            # WebSocket + opencode 子进程管理
│   ├── compact.py           # 终端自动化（/compact 命令）
│   ├── stats.py             # Session token 统计
│   ├── last5.py             # 历史对话导出
│   └── package.json
├── relay/               # 中继服务器
│   ├── server.js            # WebSocket 房间配对转发
│   ├── fix-nginx.py         # Nginx 配置脚本
│   └── package.json
├── assets/              # 图标
├── app.json             # Expo 配置
└── package.json
```

## 配置文件

所有个性化设置集中在 `config.json`（从 `config.example.json` 模板创建）：

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

环境变量可以覆盖配置文件中的值，优先级：环境变量 > config.json。

## 认证

| 角色 | Token 来源 |
|------|-----------|
| PC 端 | `RELAY_TOKEN` 环境变量 或 `client/.vibecoding-token` 文件 |
| Phone 端 | App 内手动输入（AsyncStorage 自动保存） |

## PC 客户端

```powershell
cd client
npm install
node client.js
```

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ROOM` | `default` | 房间名，App 端输入相同的即可 |
| `RELAY_URL` | `config.relayUrl` | 中继地址 |
| `RELAY_TOKEN` | 从 `.vibecoding-token` 文件读取 | PC 认证令牌 |
| `OPENDCODE_BIN` | `%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe` | opencode 二进制路径 |
| `OPENDCODE_MODE` | `json` | 输出模式：`json`（JSON 流式）或 `text`（纯文本） |
| `COMPACT_PYTHON` | `config.compactPython` | Python 解释器（compact 脚本） |
| `ALLOWED_DIRS_FILE` | 单文件可替代 config.allowedDirs | 目录白名单文件路径 |

### 目录白名单

在 `config.json` 中配置 `allowedDirs` 数组（支持 Windows/WSL 格式，最后不要带 `/`）。也可以用 `ALLOWED_DIRS_FILE` 指向一个文本文件。

### 开机自启（Windows）

`scripts/vibecoding-client-wrapper.ps1` 是一个守护脚本：启动客户端 → 监听进程退出 → 5 秒后自动重启。

**1. 修改脚本中的项目路径**（如果不是默认路径）：

```powershell
$clientJs = "C:\vibecoding-app\client\client.js"   # 改为你的路径
```

**2. 创建计划任务**（管理员 PowerShell）：

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"C:\vibecoding-app\scripts\vibecoding-client-wrapper.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "vibecoding-client" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
```

重启后任务管理器的"任务计划程序"里可见。

## 输出模式

| 模式 | 触发 | 行为 |
|------|------|------|
| **json**（默认） | `OPENDCODE_MODE=json` | `--format json` 流式输出，按类型过滤：`text`/`reasoning` 全文发送，`tool_use` 只发命令名和参数，`step_*` 和工具结果静默跳过 |
| **text** | `OPENDCODE_MODE=text` | 纯文本输出 + burst 截断（40 行/2 秒连续暴行自动截断） |

## App 功能

### 连接与状态

- Token / Room ID / Work dir 输入，首次连接后自动保存
- 连接时自动加载最后 **10 轮**对话历史（仅首次连接加载）
- 断线显示 `--- Disconnected ---`，重连清屏 + 拉最新历史
- PC 离线时自动重置 Stop 按钮状态，不会卡死
- 连接失败有 ErrorBoundary 兜底，不白屏崩溃

### 键盘与输入

- 输入法弹出时自动顶起输入框（Keyboard API，不依赖系统 adjustResize）
- 点击输入框自动滚到底部
- 多行输入框随内容自动扩展
- Stop 状态和断线时输入框不可编辑

### 渲染与显示

- opencode 输出渲染：纯文本行（16px 等宽）+ 代码块（深色背景蓝色左边框）
- 处理中显示 `Thinking...` + 旋转动画 `| / - \`
- 历史消息轮次之间有空行分隔
- 所有输出文本和用户消息均可长按原生选择和复制

### 特殊命令

| 命令 | 说明 |
|------|------|
| `/model provider/model` | 切换模型（只第一轮生效，session 内记住） |
| `/variant high/minimal/max` | 推理强度（只第一轮生效，session 内记住） |
| `/compact` | 压缩对话历史（新终端执行，90s 等待） |
| `!!restart` | 重启 PC 客户端 |

### 历史对话

- 自动加载最后 10 轮对话
- 过滤逻辑：只显示 `text`（回复）+ `tool`（命令名和参数），跳过 `state.output`（执行结果）
- 工具调用显示格式：`[bash] git diff file.js`、`[read] /path/to/file.js`、`[edit] /path/to/file.js`

## 安全措施

| 措施 | 详情 |
|------|------|
| Relay 监听 | **仅 127.0.0.1**，不暴露公网端口 |
| 外部加密 | **WSS** — nginx 对外提供 HTTPS/WSS |
| 角色分离 | **PC/Phone 不同 Token**，分别验证 |
| 时序安全 | Token 比较使用 `timingSafeEqual` 防止时序攻击 |
| 目录白名单 | 客户端限制项目目录范围，不可访问任意路径 |

## 中继服务器

部署在云服务器，systemd 管理，含 30s ping/pong keepalive 和日志限速。

```bash
scp relay/server.js user@your-server:/opt/vibecoding-relay/
ssh user@your-server "sudo systemctl restart vibecoding-relay"
```

部署 relay 后运行 `fix-nginx.py` 添加 Nginx WebSocket 配置（自动读取 config.json 中的域名）。

## 编译 APK

```powershell
cd android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease
```

APK 位置：`android/app/build/outputs/apk/release/app-release.apk`

编译前确认 `config.json` 中 `relayUrl` 已设为你的中继地址（会编译到 APK 中）。
