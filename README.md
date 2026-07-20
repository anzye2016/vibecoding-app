# VibeCoding

在手机上继续电脑 opencode 的对话。

```
手机 App ←──WSS──→ wxysyn.com:443 (nginx) ──WS──→ 127.0.0.1:8766 (relay) ←──WSS──→ PC 客户端 → opencode
```

## 目录结构

```
C:\vibecoding-app\
├── app/              # Expo Android 应用
│   ├── _layout.js        # 根布局（ErrorBoundary）
│   ├── index.js          # 聊天 UI（含 Token 输入框）
│   └── components/
│       └── MarkdownBlock.js  # 代码块渲染
├── client/           # Windows PC 客户端
│   ├── client.js         # WebSocket + opencode 子进程管理
│   ├── last5.py          # 历史对话导出处理
│   ├── allowed-dirs.txt  # 目录白名单（支持热修改）
│   └── package.json
├── relay/            # 首尔中继服务器
│   ├── server.js         # WebSocket 房间配对转发 + ping/pong keepalive
│   └── package.json
├── assets/           # 图标
├── app.json          # Expo 配置
└── package.json
```

## 认证

| 角色 | Token 来源 |
|------|-----------|
| PC 端 | `RELAY_TOKEN` 环境变量 或 `client/.vibecoding-token` 文件 |
| Phone 端 | App 内手动输入（AsyncStorage 自动保存） |

## PC 客户端

```powershell
cd C:\vibecoding-app\client
npm install
node client.js
```

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ROOM` | `default` | 房间名，App 端输入相同的即可 |
| `RELAY_URL` | `wss://wxysyn.com/vibecoding/ws` | 中继地址 |
| `RELAY_TOKEN` | 从 `.vibecoding-token` 文件读取 | PC 认证令牌 |
| `OPENDCODE_BIN` | `%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe` | opencode 二进制路径 |
| `OPENDCODE_MODE` | `json` | 输出模式：`json`（JSON 流式）或 `text`（纯文本） |
| `ALLOWED_DIRS_FILE` | `allowed-dirs.txt` | 目录白名单文件路径 |

### 开机自启

已配置 Windows 计划任务 `vibecoding-client`，开机自启 + 崩溃自动重启。wrapper 脚本在 `~/scripts/vibecoding-client-wrapper.ps1`。

### 目录白名单

编辑 `client/allowed-dirs.txt`（一行一个目录，支持 Windows/WSL 格式），修改后立即生效无需重启。

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

部署在首尔服务器 `43.155.246.153`，systemd 管理，含 30s ping/pong keepalive 和日志限速。

```bash
scp relay/server.js ubuntu@43.155.246.153:/opt/vibecoding-relay/
ssh ubuntu@43.155.246.153 "sudo systemctl restart vibecoding-relay"
```

## 编译 APK

```powershell
cd C:\vibecoding-app\android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease
```

APK 位置：`android/app/build/outputs/apk/release/app-release.apk`
