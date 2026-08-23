const DEFAULTS = { backendUrl: 'http://127.0.0.1:3002', accessToken: '' };

async function getSettings() { return chrome.storage.local.get(DEFAULTS); }

async function uploadMedia(payload, sender) {
  const settings = await getSettings();
  if (!settings.backendUrl) throw new Error('请先填写后端地址');
  if (!payload.mediaUrl || payload.mediaUrl.startsWith('blob:')) throw new Error('无效的 X 媒体地址');
  const backend = settings.backendUrl.replace(/\/$/, '');
  const headers = {
    ...(settings.accessToken ? { Authorization: `Bearer ${settings.accessToken}` } : {}),
    'Content-Type': 'application/json'
  };
  let response;
  try {
    response = await fetch(`${backend}/api/v1/uploads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mediaUrl: payload.mediaUrl,
        caption: payload.caption || '',
        mediaType: payload.mediaType || 'image',
        tweetUrl: payload.tweetUrl || '',
        tweetId: payload.tweetId || ''
      })
    });
  } catch (error) {
    throw new Error(`连接后端失败：${error.message}`);
  }
  const created = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(created.error || `后端上传失败：HTTP ${response.status}`);
  if (!created.taskId) return created;
  const notify = (phase) => {
    if (sender?.tab?.id >= 0) chrome.tabs.sendMessage(sender.tab.id, { type: 'UPLOAD_PROGRESS', payload: { tweetId: payload.tweetId, phase } }).catch(() => {});
  };
  notify('downloading');
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const statusResponse = await fetch(`${backend}/api/v1/uploads/${encodeURIComponent(created.taskId)}`, { headers: { ...(settings.accessToken ? { Authorization: `Bearer ${settings.accessToken}` } : {}) } });
    const status = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) throw new Error(status.error || `查询上传状态失败：HTTP ${statusResponse.status}`);
    if (status.phase === 'downloading' || status.phase === 'telegram') notify(status.phase);
    if (status.phase === 'completed') { notify('completed'); return status; }
    if (status.phase === 'error') throw new Error(status.error || '上传失败');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'UPLOAD_MEDIA') return undefined;
  uploadMedia(message.payload, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
