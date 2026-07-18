# VibeCoding

在手机上继续电脑 opencode 的对话。手机发消息 → 首尔服务器中转 → 电脑 opencode 执行 → 结果回传手机。

## 架构

```
手机 App (Expo/React Native)
    ↕ HTTPS/WebSocket
首尔服务器 wxysyn.com (Node.js Relay)
    ↕ WebSocket
Windows PC (Node.js Client → opencode CLI)
```

## 目录结构

```
C:\vibecoding-app\
├── app/              # Expo Android 应用
│   ├── _layout.js    # 根布局
│   ├── index.js      # 主屏幕（聊天UI）
│   └── ...
├── client/           # PC 客户端
│   ├── client.js     # WebSocket 连接 + opencode 子进程
│   └── package.json
├── relay/            # 首尔中继服务器
│   ├── server.js     # WebSocket 房间配对转发
│   └── package.json
├── assets/           # 图标资源
├── gen-icon.js       # 图标生成脚本
├── app.json          # Expo 配置
└── package.json      # Expo 依赖
```

## PC 客户端

```bash
cd C:\vibecoding-app\client
npm install
node client.js

# 环境变量（可选）
# RELAY_URL  - 中继地址，默认 wss://wxysyn.com/vibecoding/ws
# ROOM       - 房间ID，默认 default
# RELAY_TOKEN - 认证令牌，默认 vibecoding-default-token
```

## 中继服务器部署

首尔服务器，systemd 管理：

```bash
# 上传文件
scp relay/* ubuntu@43.155.246.153:/opt/vibecoding-relay/
# 安装依赖
ssh ubuntu@43.155.246.153 "cd /opt/vibecoding-relay && npm install"
# 启用服务
ssh ubuntu@43.155.246.153 "sudo systemctl enable --now vibecoding-relay"
```

nginx 反向代理配置见 `relay/fix-nginx.py`。

## 编译 APK

```powershell
set JAVA_HOME=C:\tools\jdk-17.0.19+10

# 首次或改了 app.json / 新增原生依赖时
npx expo prebuild --platform android --clean

# 日常改代码后
cd android
.\gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -x lintVitalAnalyzeRelease
```

APK 输出：`android/app/build/outputs/apk/release/app-release.apk`

## 使用

1. 电脑启动客户端：`cd client && node client.js`
2. 手机安装 APK，打开 App
3. 输入 Room ID（与 PC 一致）
4. 输入工作目录（如 `/mnt/c/Users/anzye/projects/my-app`）
5. 点击 Connect，开始对话

支持斜杠命令：`/model`、`/model switch xxx`、`/compact` 等。
