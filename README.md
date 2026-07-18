# VibeCoding

在手机上继续电脑 opencode 的对话。

```
手机 App ←→ 首尔 wxysyn.com 中继 ←→ PC 客户端 → opencode 子进程
```

## 目录结构

```
C:\vibecoding-app\
├── app/              # Expo Android 应用
│   ├── _layout.js
│   └── index.js      # 聊天 UI
├── client/           # Windows PC 客户端
│   ├── client.js     # WebSocket + 管理 opencode 子进程
│   ├── last5.py      # 导出最后 5 轮对话的 Python 脚本
│   └── package.json
├── relay/            # 首尔中继服务器
│   ├── server.js     # WebSocket 房间配对转发
│   └── package.json
├── assets/           # 图标
├── gen-icon.js       # 图标生成脚本
├── app.json          # Expo 配置
└── package.json
```

## PC 客户端

```bash
cd C:\vibecoding-app\client
npm install
node client.js
```

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ROOM` | `default` | 房间名，自由取名，手机端输入相同的即可 |
| `RELAY_URL` | `wss://wxysyn.com/vibecoding/ws` | 中继地址 |
| `RELAY_TOKEN` | `vibecoding-default-token` | 认证令牌 |

指定房间：

```powershell
$env:ROOM = "myroom"; node client.js
```

## 路径选择

客户端通过 WSL 运行 opencode，根据路径前缀自动选择二进制：

| 路径格式 | 示例 | 使用 opencode |
|----------|------|---------------|
| `/mnt/c/...` | `/mnt/c/Users/anzye/projects/esp32` | Windows opencode (1.18.1) |
| `C:\...` | `C:\Users\anzye\projects\esp32` | Windows opencode（自动转换） |
| `/home/...` | `/home/anzye/projects/foo` | WSL opencode (1.18.3) |

## 功能

- 发送消息到 PC opencode，`-s` 指定会话 ID 继续上次对话
- 连接时自动加载最后 5 轮对话历史
- 支持 opencode 斜杠命令（`/model`、`/compact`、`/model switch xxx`）
- Stop 按钮终止正在执行的命令
- 目录不存在时提示错误
- PC 断线自动重连

## 中继服务器

首尔服务器，systemd 管理：

```bash
scp relay/* ubuntu@43.155.246.153:/opt/vibecoding-relay/
ssh ubuntu@43.155.246.153 "cd /opt/vibecoding-relay && npm install"
ssh ubuntu@43.155.246.153 "sudo systemctl enable --now vibecoding-relay"
```

nginx 配置见 `relay/fix-nginx.py`。

## 编译 APK

```powershell
set JAVA_HOME=C:\tools\jdk-17.0.19+10

# 首次或改过 app.json / 新增原生依赖
npx expo prebuild --platform android --clean

# 日常改 JS 代码
cd android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease
```

APK: `android/app/build/outputs/apk/release/app-release.apk`
