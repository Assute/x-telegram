# x-telegram

在 X 推文操作栏添加上传按钮，由服务器下载媒体并上传到 Telegram，同时保留完整推文文案。

## 目录

- `extension/`：Chrome Manifest V3 插件
- `userscript/`：油猴脚本
- `x-tg/`：Node.js 后端

## 先启动 Telegram Local Bot API

后端依赖 Telegram Local Bot API。请先准备 Telegram 的 `api_id` 和 `api_hash`，然后运行下面的 Docker 命令。`api_id` 和 `api_hash` 可从 Telegram 官方开发者页面获取。

`TELEGRAM_LOCAL=1` 用于允许本地文件 API 请求，数据通过 Docker volume 持久化保存。

将命令中的 `你的_api_id` 和 `你的_api_hash` 替换成自己的值：

```bash
docker run -d \
  --name telegram-bot-api \
  --restart always \
  -p 8081:8081 \
  -v telegram-bot-api-data:/var/lib/telegram-bot-api \
  -e TELEGRAM_API_ID=你的_api_id \
  -e TELEGRAM_API_HASH=你的_api_hash \
  -e TELEGRAM_LOCAL=1 \
  aiogram/telegram-bot-api:latest
```

检查容器是否运行：

```bash
docker ps --filter name=telegram-bot-api
docker logs --tail 100 telegram-bot-api
```

确认 Local Bot API 正常后，再启动 `x-tg` 后端。后端默认连接：`http://127.0.0.1:8081`。

停止和重新启动容器：

```bash
docker stop telegram-bot-api
docker start telegram-bot-api
```

## 启动后端

```powershell
cd x-tg
npm install
npm start
```

编辑 `x-tg/.env`：

```env
PORT=3002
TELEGRAM_API_BASE_URL=http://127.0.0.1:8081
TELEGRAM_BOT_TOKEN=你的BotToken
DEFAULT_CHANNEL_ID=-1001234567890
EXTENSION_ACCESS_TOKEN=设置一个访问密钥
MAX_UPLOAD_BYTES=2147483648
```

Bot 必须已经加入目标频道或群组，并具有发送媒体权限。

## 安装 Chrome 插件

1. 先启动 Telegram Local Bot API 和 `x-tg` 后端。
2. 打开 Chrome 扩展程序页面并开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择 `extension/` 文件夹。
5. 打开插件设置，填写后端地址和访问密钥。
6. 刷新 X 页面。

## 安装油猴脚本

1. 安装 Tampermonkey。
2. 导入 `userscript/x-telegram-uploader.user.js`。
3. 在油猴菜单中打开 `配置 x-telegram`。
4. 同时填写后端地址和访问密钥并保存。
5. 刷新 X 页面。

## 上传行为

- 图片使用 Telegram `sendPhoto` 发送为图片消息。
- 视频使用 Telegram `sendVideo` 发送为视频消息。
- GIF 使用 Telegram `sendAnimation` 发送为动画消息。
- 视频优先选择 X 提供的最高码率资源。
- 上传过程中图标会区分 URL 提交、服务器下载和 Telegram 上传阶段。
- Telegram Bot Token 只放在服务器 `x-tg/.env`，不要写进插件或油猴脚本。

## 仅部署 `x-tg` 后端

如果服务器不需要 Chrome 插件和油猴脚本，可以只检出仓库中的 `x-tg` 文件夹：

```bash
cd /opt
svn checkout https://github.com/Assute/x-telegram/trunk/x-tg x-tg
cd /opt/x-tg
npm install
npm start
```

后续只更新后端代码：

```bash
cd /opt/x-tg
svn update
npm install
npm start
```

如果服务器没有 `svn` 命令，先安装：

```bash
apt update
apt install -y subversion
```
