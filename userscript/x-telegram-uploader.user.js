// ==UserScript==
// @name         x-telegram
// @namespace    x-telegram-uploader-v2
// @version      1.3.0
// @description  在 X 推文操作栏添加下载按钮，服务器下载媒体并上传到 Telegram，同时保留完整推文文案
// @author       x-telegram
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// ==/UserScript==

(() => {
  'use strict';

  const BUTTON_CLASS = 'xtu-userscript-download-button';
  const processedArticles = new WeakSet();
  const activeUploads = new Map();
  const DEFAULT_BACKEND = '';
  const GUEST_AUTHORIZATION = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const TWEET_QUERY_ID = 'zAz9764BcLZOJ0JU2wrd1A';
  const TWEET_FEATURES = {
    creator_subscriptions_tweet_preview_api_enabled: true,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_share_attachment_enabled: true,
    articles_preview_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    standardized_nudges_misinfo: true,
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_enhance_cards_enabled: false
  };
  const TWEET_FIELD_TOGGLES = { withArticleRichContentState: true, withArticlePlainText: false };

  const style = document.createElement('style');
  style.textContent = `
    .xtu-userscript-download-item { align-items:center!important; display:flex!important; flex:0 0 34px!important; height:34px!important; justify-content:center!important; margin:0!important; min-width:34px!important; padding:0!important; }
    .${BUTTON_CLASS} { align-items:center; background:transparent; border:0; border-radius:9999px; color:rgb(83,100,113); cursor:pointer; display:flex; flex:0 0 34px; height:34px; justify-content:center; line-height:0; margin:0!important; padding:0; transition:background-color 120ms ease,color 120ms ease; width:34px; }
    .${BUTTON_CLASS} svg { display:block; fill:currentColor; height:20px; width:20px; }
    .${BUTTON_CLASS}:hover { background:rgba(29,155,240,.1); color:rgb(29,155,240); }
    .${BUTTON_CLASS}[data-state="url"] { color:rgb(29,155,240); }
    .${BUTTON_CLASS}[data-state="downloading"] { color:rgb(255,126,0); }
    .${BUTTON_CLASS}[data-state="telegram"] { color:rgb(135,90,210); }
    .${BUTTON_CLASS}[data-state="success"] { color:rgb(0,186,124); }
    .${BUTTON_CLASS}[data-state="error"] { color:rgb(244,33,46); }
    .${BUTTON_CLASS} svg.animated { animation:xtu-userscript-pulse 900ms linear infinite; transform-origin:center; }
    @keyframes xtu-userscript-pulse { 0% { opacity:.45; transform:scale(.88) rotate(0deg); } 50% { opacity:1; transform:scale(1.08) rotate(8deg); } 100% { opacity:.45; transform:scale(.88) rotate(0deg); } }
    .xtu-config-backdrop { align-items:center; background:rgba(0,0,0,.55); display:flex; inset:0; justify-content:center; position:fixed; z-index:2147483647; }
    .xtu-config-panel { background:#fff; border-radius:16px; box-shadow:0 12px 40px rgba(0,0,0,.25); box-sizing:border-box; color:#0f1419; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; max-width:420px; padding:24px; width:calc(100vw - 32px); }
    .xtu-config-title { font-size:20px; font-weight:700; margin:0 0 20px; }
    .xtu-config-label { display:block; font-size:14px; font-weight:600; margin:14px 0 6px; }
    .xtu-config-input { border:1px solid #cfd9de; border-radius:8px; box-sizing:border-box; font-size:15px; outline:0; padding:10px 12px; width:100%; }
    .xtu-config-input:focus { border-color:#1d9bf0; box-shadow:0 0 0 2px rgba(29,155,240,.2); }
    .xtu-config-error { color:#d93025; font-size:13px; min-height:18px; margin-top:10px; }
    .xtu-config-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:18px; }
    .xtu-config-button { border:0; border-radius:9999px; cursor:pointer; font-size:14px; font-weight:700; padding:9px 16px; }
    .xtu-config-cancel { background:#eff3f4; color:#0f1419; }
    .xtu-config-save { background:#1d9bf0; color:#fff; }

  `;
  document.documentElement.appendChild(style);

  function getSettings() {
    return {
      backendUrl: String(GM_getValue('backendUrl', DEFAULT_BACKEND)).trim().replace(/\/$/, ''),
      accessToken: String(GM_getValue('accessToken', ''))
    };
  }

  function configure() {
    const settings = getSettings();
    document.querySelector('.xtu-config-backdrop')?.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'xtu-config-backdrop';
    const panel = document.createElement('form');
    panel.className = 'xtu-config-panel';
    panel.innerHTML = `
      <h2 class="xtu-config-title">x-telegram 配置</h2>
      <label class="xtu-config-label" for="xtu-config-backend">后端地址</label>
      <input class="xtu-config-input" id="xtu-config-backend" type="url" placeholder="http://your-server:3002" autocomplete="off">
      <label class="xtu-config-label" for="xtu-config-token">访问密钥</label>
      <input class="xtu-config-input" id="xtu-config-token" type="password" placeholder="请输入插件访问密钥" autocomplete="off">
      <div class="xtu-config-error" aria-live="polite"></div>
      <div class="xtu-config-actions">
        <button class="xtu-config-button xtu-config-cancel" type="button">取消</button>
        <button class="xtu-config-button xtu-config-save" type="submit">保存</button>
      </div>
    `;
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    const backendInput = panel.querySelector('#xtu-config-backend');
    const tokenInput = panel.querySelector('#xtu-config-token');
    const errorBox = panel.querySelector('.xtu-config-error');
    backendInput.value = settings.backendUrl;
    tokenInput.value = settings.accessToken;
    backendInput.focus();

    panel.querySelector('.xtu-config-cancel').addEventListener('click', () => backdrop.remove());
    panel.addEventListener('submit', (event) => {
      event.preventDefault();
      const backendUrl = backendInput.value.trim().replace(/\/$/, '');
      const accessToken = tokenInput.value.trim();
      if (!backendUrl || !accessToken) {
        errorBox.textContent = '后端地址和访问密钥都不能为空';
        return;
      }
      let parsedUrl;
      try { parsedUrl = new URL(backendUrl); } catch {
        errorBox.textContent = '后端地址格式不正确';
        return;
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        errorBox.textContent = '后端地址必须使用 http:// 或 https://';
        return;
      }
      GM_setValue('backendUrl', backendUrl);
      GM_setValue('accessToken', accessToken);
      backdrop.remove();
    });
  }
  GM_registerMenuCommand('配置 x-telegram', configure);

  function getTweetUrl(article) {
    const link = [...article.querySelectorAll('a[href*="/status/"]')].find((item) => /\/status\/\d+/.test(item.getAttribute('href') || ''));
    return link ? new URL(link.getAttribute('href'), location.origin).href : location.href;
  }
  function getTweetId(url) { return url.match(/\/status\/(\d+)/)?.[1] || ''; }
  function getCookie(name) { return document.cookie.split(';').map((item) => item.trim().split('=')).find(([key]) => key === name)?.[1] || ''; }
  function cleanText(value) { return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+\n/g, '\n').trim(); }

  function getCaption(tweet, article) {
    const legacy = tweet?.legacy || {};
    const user = tweet?.core?.user_results?.result?.legacy || tweet?.core?.user_results?.result?.user?.legacy || tweet?.user?.legacy || {};
    const displayName = user.name || article.querySelector('[data-testid="User-Name"] span')?.textContent?.trim() || '';
    const screenName = user.screen_name || article.querySelector('[data-testid="User-Name"] a[href^="/"]')?.getAttribute('href')?.replace(/^\//, '') || '';
    const noteText = tweet?.note_tweet?.note_tweet_results?.result?.text || tweet?.note_tweet_results?.result?.text || '';
    const text = cleanText(noteText || legacy.full_text || tweet?.text || article.querySelector('[data-testid="tweetText"]')?.innerText || '');
    const author = displayName && screenName ? `${displayName} @${screenName}` : displayName || (screenName ? `@${screenName}` : '');
    return [author, text].filter(Boolean).join('\n');
  }

  async function readTweet(article, tweetId) {
    const params = new URLSearchParams({
      variables: JSON.stringify({ tweetId, withCommunity: false, includePromotedContent: false, withVoice: false }),
      features: JSON.stringify(TWEET_FEATURES),
      fieldToggles: JSON.stringify(TWEET_FIELD_TOGGLES)
    });
    const headers = {
      authorization: GUEST_AUTHORIZATION,
      'x-csrf-token': getCookie('ct0'),
      'x-twitter-client-language': document.documentElement.lang || 'zh-CN',
      'x-twitter-active-user': 'yes',
      accept: 'application/json'
    };
    const guestToken = getCookie('gt');
    if (guestToken) headers['x-guest-token'] = guestToken;
    const response = await fetch(`https://x.com/i/api/graphql/${TWEET_QUERY_ID}/TweetResultByRestId?${params}`, { credentials: 'include', headers });
    if (!response.ok) throw new Error(`X GraphQL 请求失败：HTTP ${response.status}`);
    const payload = await response.json();
    const root = payload?.data?.tweetResult?.result;
    const tweet = root?.tweet || root;
    const media = tweet?.legacy?.extended_entities?.media || tweet?.extended_entities?.media || [];
    const items = media.flatMap((item) => {
      if (item.type === 'photo' && item.media_url_https) return [{ url: `${item.media_url_https}?format=jpg&name=4096x4096`, type: 'image' }];
      if ((item.type === 'video' || item.type === 'animated_gif') && Array.isArray(item.video_info?.variants)) {
        const variant = item.video_info.variants.filter((entry) => entry.content_type === 'video/mp4' && entry.url).sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))[0];
        return variant ? [{ url: variant.url, type: item.type === 'animated_gif' ? 'gif' : 'video' }] : [];
      }
      return [];
    });
    return { media: items, caption: getCaption(tweet, article) };
  }

  function requestBackend(method, url, body) {
    const settings = getSettings();
    if (!settings.backendUrl || !settings.accessToken) return Promise.reject(new Error('请先通过油猴菜单配置后端地址和访问密钥'));
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          ...(settings.accessToken ? { Authorization: `Bearer ${settings.accessToken}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 30000,
        onload: (response) => {
          let result = {};
          try { result = JSON.parse(response.responseText || '{}'); } catch {}
          if (response.status < 200 || response.status >= 300) return reject(new Error(result.error || `后端请求失败：HTTP ${response.status}`));
          resolve(result);
        },
        ontimeout: () => reject(new Error('后端请求超时')),
        onerror: () => reject(new Error('无法连接后端'))
      });
    });
  }

  function setState(button, state, title) {
    button.dataset.state = state;
    button.title = title;
    button.disabled = ['url', 'downloading', 'telegram'].includes(state);
    const svg = button.querySelector('svg');
    svg.classList.toggle('animated', ['url', 'downloading', 'telegram'].includes(state));
    svg.innerHTML = state === 'url'
      ? '<path d="M12 16V2.5m0 0 3 3m-3-3-3 3M5 12.5v5c0 .83.67 1.5 1.5 1.5h11c.83 0 1.5-.67 1.5-1.5v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 2" />'
      : state === 'downloading'
        ? '<path d="M12 8V2.5m0 5.5 3-3m-3 3-3-3M5 12.5v5c0 .83.67 1.5 1.5 1.5h11c.83 0 1.5-.67 1.5-1.5v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 2" />'
        : state === 'telegram'
          ? '<path d="M12 16V2.5m0 0 3 3m-3-3-3 3M5 12.5v5c0 .83.67 1.5 1.5 1.5h11c.83 0 1.5-.67 1.5-1.5v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 2" />'
          : state === 'success'
            ? '<path d="M5 12.5 10 17l9-10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />'
            : state === 'error'
              ? '<path d="M12 5v8M12 17v1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />'
              : '<path d="M12 16 17.7 10.3 16.29 8.88 13 12.18V2.59h-2v9.59L7.7 8.88 6.29 10.3 12 16Zm-7 1v2.5c0 .83.67 1.5 1.5 1.5h11c.83 0 1.5-.67 1.5-1.5V17h-2v1.5h-10V17H5Z" fill="currentColor" />';
  }

  async function uploadArticle(article, button) {
    const tweetUrl = getTweetUrl(article);
    const tweetId = getTweetId(tweetUrl);
    activeUploads.set(tweetId, button);
    try {
      setState(button, 'url', '正在读取并提交媒体 URL');
      const tweet = await readTweet(article, tweetId);
      if (!tweet.media.length) throw new Error('没有找到可下载的媒体');
      for (const [index, media] of tweet.media.entries()) {
        const progress = `${index + 1}/${tweet.media.length}`;
        setState(button, 'url', `正在提交第 ${progress} 个媒体 URL`);
        const task = await requestBackend('POST', `${getSettings().backendUrl}/api/v1/uploads`, { tweetUrl, tweetId, caption: tweet.caption, mediaUrl: media.url, mediaType: media.type });
        if (!task.taskId) throw new Error('后端没有返回任务 ID');
        setState(button, 'downloading', `服务器正在下载第 ${progress} 个媒体`);
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          const status = await requestBackend('GET', `${getSettings().backendUrl}/api/v1/uploads/${encodeURIComponent(task.taskId)}`);
          if (status.phase === 'downloading') setState(button, 'downloading', `服务器正在下载第 ${progress} 个媒体`);
          if (status.phase === 'telegram') setState(button, 'telegram', `正在上传第 ${progress} 个媒体到 Telegram`);
          if (status.phase === 'completed') break;
          if (status.phase === 'error') throw new Error(status.error || '服务器上传失败');
        }
      }
      setState(button, 'success', `已上传 ${tweet.media.length} 个媒体到 Telegram`);
    } catch (error) {
      console.error('[x-telegram]', error);
      setState(button, 'error', error.message || '上传失败，点击重试');
      button.disabled = false;
    } finally {
      activeUploads.delete(tweetId);
    }
  }

  function getActionGroup(article) {
    const groups = [...article.querySelectorAll('[role="group"]')];
    return groups.find((group) => group.querySelector('button[data-testid="bookmark"], button[data-testid="removeBookmark"], button[data-testid="share"]')) || groups.at(-1) || null;
  }
  function getActionItem(button) { return button?.closest('div[role="button"]')?.parentElement || button?.parentElement?.parentElement || button?.parentElement || null; }

  function inject(article) {
    if (processedArticles.has(article) || article.querySelector(`.${BUTTON_CLASS}`)) return;
    const tweetUrl = getTweetUrl(article);
    if (!getTweetId(tweetUrl)) return;
    const group = getActionGroup(article);
    if (!group) return;
    const shareItem = getActionItem(group.querySelector('button[data-testid="share"]'));
    const item = document.createElement('div');
    item.className = 'xtu-userscript-download-item';
    const button = document.createElement('button');
    button.className = BUTTON_CLASS;
    button.type = 'button';
    button.title = '上传推文媒体到 Telegram';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    button.appendChild(svg);
    item.appendChild(button);
    setState(button, 'idle', button.title);
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); uploadArticle(article, button); });
    if (shareItem?.parentElement === group) shareItem.insertAdjacentElement('beforebegin', item); else group.appendChild(item);
    processedArticles.add(article);
  }

  function scan() { document.querySelectorAll('article').forEach(inject); }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
