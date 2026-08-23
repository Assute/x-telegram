const DEFAULTS = { backendUrl: 'http://127.0.0.1:3002', accessToken: '' };
const fields = ['backendUrl', 'accessToken'];
async function load() { const settings = await chrome.storage.local.get(DEFAULTS); for (const field of fields) document.getElementById(field).value = settings[field] || ''; }
document.getElementById('save').addEventListener('click', async () => { const settings = Object.fromEntries(fields.map((field) => [field, document.getElementById(field).value.trim()])); await chrome.storage.local.set(settings); document.getElementById('status').textContent = '设置已保存'; });
load();


