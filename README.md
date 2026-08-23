# x-telegram

最小可运行版本：在 X 图片上显示上传按钮，插件读取当前页面可访问的图片并发送到后端，后端再调用 Telegram Bot API 上传到频道。

## 目录

- `extension/`：Chrome Manifest V3 插件
- `x-tg/`：Node.js 后端

## 启动后端

```powershell
cd x-tg
Copy-Item .env.example .env
npm install
npm start
```

编辑 `.env`：

```env
TELEGRAM_API_BASE_URL=http://127.0.0.1:8081
TELEGRAM_BOT_TOKEN=你的BotToken
DEFAULT_CHANNEL_ID=-1001234567890
EXTENSION_ACCESS_TOKEN=设置一个访问密钥
```

Bot 必须已经加入频道并具有发消息权限。

## 安装插件

1. 打开 Chrome 扩展程序页面并开启开发者模式。
2. 点击“加载已解压的扩展程序”。
3. 选择 `extension/` 文件夹。
4. 打开插件设置，填写后端地址、访问密钥和频道 ID。
5. 刷新 X 页面。

默认后端地址：`http://127.0.0.1:3002`

## 当前限制

- 支持图片和视频；视频会优先选择页面当前可访问的最高码率资源，并以文件方式上传。建议先播放视频再点击按钮。
- 后端当前同步上传，尚未加入队列和断点续传。
- Bot Token 只放在服务器 `.env`，不要写进插件。






