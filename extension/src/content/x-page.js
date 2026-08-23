const BUTTON_CLASS = 'xtu-download-button';
const processedArticles = new WeakSet();
const activeUploads = new Map();
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

function getTweetUrl(article) {
  const link = [...article.querySelectorAll('a[href*="/status/"]')].find((item) => /\/status\/\d+/.test(item.getAttribute('href') || ''));
  return link ? new URL(link.getAttribute('href'), window.location.origin).href : window.location.href;
}

function getTweetId(tweetUrl) { return tweetUrl.match(/\/status\/(\d+)/)?.[1] || ''; }
function getCookie(name) { return document.cookie.split(';').map((item) => item.trim().split('=')).find(([key]) => key === name)?.[1] || ''; }

function cleanTweetText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function getTweetCaption(tweet, article) {
  const legacy = tweet?.legacy || {};
  const user = tweet?.core?.user_results?.result?.legacy || tweet?.core?.user_results?.result?.user?.legacy || tweet?.user?.legacy || {};
  const displayName = user.name || article.querySelector('[data-testid="User-Name"] span')?.textContent?.trim() || '';
  const screenName = user.screen_name || article.querySelector('[data-testid="User-Name"] a[href^="/"]')?.getAttribute('href')?.replace(/^\//, '') || '';
  const noteText = tweet?.note_tweet?.note_tweet_results?.result?.text || tweet?.note_tweet_results?.result?.text || '';
  const fullText = cleanTweetText(noteText || legacy.full_text || tweet?.text || article.querySelector('[data-testid="tweetText"]')?.innerText || '');
  const author = displayName && screenName ? displayName + ' @' + screenName : displayName ? displayName : screenName ? '@' + screenName : '';
  return [author, fullText].filter(Boolean).join('\n');
}

async function getTweetMedia(tweetId, article) {
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
  const response = await fetch('https://x.com/i/api/graphql/' + TWEET_QUERY_ID + '/TweetResultByRestId?' + params, { credentials: 'include', headers });
  if (!response.ok) throw new Error('X GraphQL 请求失败：HTTP ' + response.status);
  const payload = await response.json();
  const root = payload?.data?.tweetResult?.result;
  const tweet = root?.tweet || root;
  const media = tweet?.legacy?.extended_entities?.media || tweet?.extended_entities?.media || [];
  const items = media.flatMap((item) => {
    if (item.type === 'photo' && item.media_url_https) return [{ url: item.media_url_https + '?format=jpg&name=4096x4096', type: 'image' }];
    if ((item.type === 'video' || item.type === 'animated_gif') && Array.isArray(item.video_info?.variants)) {
      const variant = item.video_info.variants.filter((entry) => entry.content_type === 'video/mp4' && entry.url).sort((left, right) => Number(right.bitrate || 0) - Number(left.bitrate || 0))[0];
      return variant ? [{ url: variant.url, type: item.type === 'animated_gif' ? 'gif' : 'video' }] : [];
    }
    return [];
  });
  return { media: items, caption: getTweetCaption(tweet, article) };
}

function setButtonState(button, state, label) {
  if (!button) return;
  button.dataset.xtuState = state;
  button.title = label;
  button.disabled = ['url', 'downloading', 'telegram'].includes(state);
  const svg = button.querySelector('svg');
  if (!svg) return;
  svg.classList.toggle('xtu-animated', ['url', 'downloading', 'telegram'].includes(state));
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

function getActionGroup(article) {
  const groups = [...article.querySelectorAll('[role="group"]')];
  return groups.find((group) => group.querySelector('button[data-testid="bookmark"], button[data-testid="removeBookmark"], button[data-testid="share"]')) || groups.at(-1) || null;
}

function getActionItem(button) { return button?.closest('div[role="button"]')?.parentElement || button?.parentElement?.parentElement || button?.parentElement || null; }

async function uploadMedia(article, button) {
  const tweetUrl = getTweetUrl(article);
  const tweetId = getTweetId(tweetUrl);
  activeUploads.set(tweetId, button);
  setButtonState(button, 'url', '正在上传媒体 URL 到服务器');
  try {
    const tweetData = await getTweetMedia(tweetId, article);
    const mediaItems = tweetData.media;
    if (!mediaItems.length) throw new Error('没有找到推文媒体');
    for (const [index, media] of mediaItems.entries()) {
      const progress = `${index + 1}/${mediaItems.length}`;
      setButtonState(button, 'url', `正在上传第 ${progress} 个媒体 URL 到服务器`);
      const result = await chrome.runtime.sendMessage({
        type: 'UPLOAD_MEDIA',
        payload: { tweetUrl, tweetId, caption: tweetData.caption, mediaUrl: media.url, mediaType: media.type }
      });
      if (!result?.ok) throw new Error(result?.error || '上传失败');
    }
    setButtonState(button, 'success', `已上传 ${mediaItems.length} 个媒体到 Telegram`);
  } catch (error) {
    console.error('[x-telegram]', error);
    setButtonState(button, 'error', error.message || '上传失败，点击重试');
    button.disabled = false;
  } finally {
    activeUploads.delete(tweetId);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'UPLOAD_PROGRESS') return;
  const button = activeUploads.get(message.payload?.tweetId);
  if (!button) return;
  const phase = message.payload.phase;
  if (phase === 'downloading') setButtonState(button, 'downloading', '服务器正在下载视频');
  if (phase === 'telegram') setButtonState(button, 'telegram', '服务器正在上传到 Telegram');
});

function createDownloadButton(article) {
  if (article.querySelector('.' + BUTTON_CLASS)) return;
  const actionGroup = getActionGroup(article);
  if (!actionGroup) return;
  const shareButton = actionGroup.querySelector('button[data-testid="share"]');
  const shareItem = getActionItem(shareButton);
  const item = document.createElement('div');
  item.className = 'xtu-download-item';
  item.setAttribute('role', 'presentation');
  const button = document.createElement('button');
  button.className = BUTTON_CLASS;
  button.type = 'button';
  button.title = '上传推文媒体到 Telegram';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  button.appendChild(svg);
  item.appendChild(button);
  setButtonState(button, 'idle', button.title);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    uploadMedia(article, button);
  });
  if (shareItem?.parentElement === actionGroup) shareItem.insertAdjacentElement('beforebegin', item);
  else actionGroup.appendChild(item);
}

function injectButtons(article) {
  if (processedArticles.has(article) && article.querySelector(`.${BUTTON_CLASS}`)) return;
  if (!getTweetId(getTweetUrl(article))) return;
  createDownloadButton(article);
  processedArticles.add(article);
}

function scanPage() { document.querySelectorAll('article').forEach(injectButtons); }
new MutationObserver(scanPage).observe(document.body, { childList: true, subtree: true });
scanPage();





