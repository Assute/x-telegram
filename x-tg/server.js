import 'dotenv/config';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.PORT || 3002);
const telegramApiBaseUrl = (process.env.TELEGRAM_API_BASE_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
const defaultChannelId = process.env.DEFAULT_CHANNEL_ID || '';
const extensionAccessToken = process.env.EXTENSION_ACCESS_TOKEN || '';
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 2147483648);
const allowedMediaHosts = new Set(['video.twimg.com', 'pbs.twimg.com']);
const uploadJobs = new Map();

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  response.end(JSON.stringify(payload));
}

function safeFileName(value) { return (value || `x_${Date.now()}.bin`).replace(/[^a-z0-9._-]/gi, '_').slice(0, 180); }
function isAuthorized(request) { return !extensionAccessToken || request.headers.authorization === `Bearer ${extensionAccessToken}`; }

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 1024 * 1024) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateMediaUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !allowedMediaHosts.has(url.hostname)) throw new Error('不允许的媒体地址');
  return url;
}

async function downloadRemoteMedia(mediaUrl, filePath) {
  const url = validateMediaUrl(mediaUrl);
  const remote = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: '*/*' } });
  if (!remote.ok || !remote.body) throw new Error(`服务器下载 X 媒体失败：HTTP ${remote.status}`);
  const declaredLength = Number(remote.headers.get('content-length') || 0);
  if (declaredLength > maxUploadBytes) throw new Error('媒体超过服务器大小限制');
  const output = createWriteStream(filePath, { flags: 'wx' });
  let total = 0;
  try {
    for await (const chunk of remote.body) {
      total += chunk.length;
      if (total > maxUploadBytes) throw new Error('媒体超过服务器大小限制');
      if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
    }
    await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
  } catch (error) {
    output.destroy();
    throw error;
  }
  return { size: total, contentType: remote.headers.get('content-type') || 'application/octet-stream', fileName: safeFileName(url.pathname.split('/').pop()) };
}

async function postMultipartFile(urlString, fields, fieldName, filePath, fileName, contentType) {
  const url = new URL(urlString);
  const boundary = `----xTelegramBoundary${randomUUID().replaceAll('-', '')}`;
  const fileStats = await stat(filePath);
  const fieldParts = Object.entries(fields).map(([key, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  const fileHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const fileTail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const contentLength = fieldParts.reduce((total, part) => total + part.length, 0) + fileHeader.length + fileStats.size + fileTail.length;
  const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = requestImpl(url, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': contentLength }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let result;
        try { result = JSON.parse(body); } catch { result = {}; }
        if (response.statusCode < 200 || response.statusCode >= 300 || !result.ok) reject(new Error(result.description || `Telegram API HTTP ${response.statusCode}`));
        else resolve(result.result);
      });
    });
    request.on('error', reject);
    for (const part of fieldParts) request.write(part);
    request.write(fileHeader);
    const fileStream = createReadStream(filePath);
    fileStream.on('error', (error) => { request.destroy(error); });
    fileStream.on('end', () => { request.write(fileTail); request.end(); });
    fileStream.pipe(request, { end: false });
  });
}

async function sendToTelegram(filePath, contentType, fileName, mediaType, channelId, caption) {
  if (!botToken) throw new Error('服务器未配置 TELEGRAM_BOT_TOKEN');
  if (!channelId) throw new Error('未配置 Telegram 频道 ID');
  const isVideo = mediaType === 'video';
  const isAnimation = mediaType === 'gif';
  const isPhoto = mediaType === 'image';
  if (!isVideo && !isAnimation && !isPhoto) throw new Error('不支持的媒体类型');
  const method = isVideo ? 'sendVideo' : isAnimation ? 'sendAnimation' : 'sendPhoto';
  const fieldName = isVideo ? 'video' : isAnimation ? 'animation' : 'photo';
  return postMultipartFile(`${telegramApiBaseUrl}/bot${botToken}/${method}`, {
    chat_id: channelId,
    caption: caption.slice(0, 1024),
    ...(isVideo ? { supports_streaming: 'true' } : {})
  }, fieldName, filePath, fileName, contentType);
}
async function runUploadJob(taskId, payload) {
  let temporaryDirectory;
  const job = uploadJobs.get(taskId);
  if (!job) return;
  const update = (phase, extra = {}) => {
    job.phase = phase;
    Object.assign(job, extra);
    job.updatedAt = Date.now();
  };
  try {
    update('downloading');
    const mediaUrl = validateMediaUrl(payload.mediaUrl).href;
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'x-tg-'));
    const downloaded = await downloadRemoteMedia(mediaUrl, join(temporaryDirectory, 'media'));
    const extension = payload.mediaType === 'video' ? '.mp4' : downloaded.fileName.match(/\.[a-z0-9]{2,5}$/i)?.[0] || '.bin';
    const fileName = safeFileName(`x_${payload.tweetId || Date.now()}${extension}`);
    const storedPath = join(temporaryDirectory, fileName);
    const rawPath = join(temporaryDirectory, 'media');
    const { rename } = await import('node:fs/promises');
    await rename(rawPath, storedPath);
    update('telegram', { bytes: downloaded.size });
    const message = await sendToTelegram(storedPath, downloaded.contentType, fileName, payload.mediaType || 'image', defaultChannelId, payload.caption || (payload.tweetUrl ? `来自 X：${payload.tweetUrl}` : '来自 X 的媒体'));
    update('completed', { bytes: downloaded.size, telegramMessageId: message.message_id, mediaType: payload.mediaType || 'image' });
  } catch (error) {
    console.error('[upload]', error.message);
    update('error', { error: error.message || '上传失败' });
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    setTimeout(() => uploadJobs.delete(taskId), 10 * 60 * 1000);
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Authorization,Content-Type'
    });
    return response.end();
  }
  if (request.method === 'GET' && request.url === '/health') return json(response, 200, { ok: true });
  const taskMatch = request.method === 'GET' ? request.url.match(/^\/api\/v1\/uploads\/([^/]+)$/) : null;
  if (taskMatch) {
    if (!isAuthorized(request)) return json(response, 401, { error: 'Unauthorized' });
    const job = uploadJobs.get(taskMatch[1]);
    if (!job) return json(response, 404, { error: '任务不存在或已过期' });
    return json(response, 200, { ok: job.phase !== 'error', taskId: taskMatch[1], phase: job.phase, ...(job.error ? { error: job.error } : {}), ...(job.bytes ? { bytes: job.bytes } : {}), ...(job.telegramMessageId ? { telegramMessageId: job.telegramMessageId } : {}), ...(job.mediaType ? { mediaType: job.mediaType } : {}) });
  }
  if (request.method !== 'POST' || request.url !== '/api/v1/uploads') return json(response, 404, { error: 'Not found' });
  if (!isAuthorized(request)) return json(response, 401, { error: 'Unauthorized' });
  try {
    const payload = await readJson(request);
    validateMediaUrl(payload.mediaUrl);
    const taskId = randomUUID();
    uploadJobs.set(taskId, { phase: 'queued', createdAt: Date.now(), updatedAt: Date.now() });
    void runUploadJob(taskId, payload);
    return json(response, 202, { ok: true, taskId, phase: 'queued' });
  } catch (error) {
    return json(response, 400, { error: error.message || '上传失败' });
  }
});
server.listen(port, '0.0.0.0', () => console.log(`x-telegram server listening on :${port}`));



