// SPDX-License-Identifier: GPL-3.0-only
// Native SkyStream bridge helpers shared by the Ukrainian ports. See NOTICE.
const UA = 'Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Mobile Safari/537.36';
const base = () => manifest.baseUrl.replace(/\/+$/, '');
const clean = value => (value || '').replace(/\s+/g, ' ').trim();
const inner = node => node?.html ?? node?.innerHTML ?? '';
const origin = url => url.match(/^https?:\/\/[^/]+/i)?.[0] || '';
const unique = (items, key) => Array.from(new Map(items.map(item => [key(item), item])).values());

// SkyStream's URL polyfill does not fully resolve protocol-relative URLs or '..'.
function absolute(raw, parent = base() + '/') {
  let value = (raw || '').trim().replace(/&amp;/g, '&');
  if (!value || /^(data|javascript|blob):/i.test(value)) return '';
  if (value.startsWith('//')) value = 'https:' + value;
  if (/^https?:\/\//i.test(value)) return /\s/.test(value) ? '' : value;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return '';
  const host = origin(parent);
  if (!host) return '';
  const parentPath = parent.slice(host.length).split(/[?#]/)[0] || '/';
  const path = value.startsWith('/') ? value : value.startsWith('?')
    ? parentPath + value : parentPath.replace(/[^/]*$/, '') + value;
  const suffixAt = path.search(/[?#]/);
  const pathname = suffixAt < 0 ? path : path.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? '' : path.slice(suffixAt);
  const parts = [];
  for (const part of pathname.split('/')) {
    if (part === '..') { if (parts.length > 1) parts.pop(); }
    else if (part !== '.') parts.push(part);
  }
  return host + parts.join('/') + suffix;
}
function headers(referer = base()) {
  return { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7', Referer: referer };
}
class ProviderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
async function answer(cb, action) {
  let response;
  try { response = { success: true, data: await action() }; }
  catch (error) {
    response = { success: false, errorCode: error.code || 'NETWORK_ERROR',
      message: error instanceof ProviderError ? error.message : 'Не вдалося виконати запит до джерела. Перевірте з’єднання та повторіть спробу.' };
  }
  cb(response);
}
async function request(url, extraHeaders = headers(), body) {
  const response = body === undefined ? await http_get(url, extraHeaders) : await http_post(url, extraHeaders, body);
  const html = String(response.body ?? '');
  const status = Number(response.status ?? response.statusCode ?? 0);
  if (/cf-chl-|<title>\s*Just a moment|id=["']challenge-(?:running|form)/i.test(html)) {
    throw new ProviderError('CLOUDFLARE_BLOCKED', 'Сайт або відеохост показує перевірку Cloudflare. Повторіть спробу пізніше; плагін не може пройти інтерактивну перевірку.');
  }
  if (status < 200 || status >= 300) throw new ProviderError('HTTP_ERROR', `Сервер ${origin(url)} повернув HTTP ${status}.`);
  return html;
}
async function select(html, css, attr) { return await parse_html(html, css, attr) || []; }
async function text(html, css) { return clean((await select(html, css)).map(n => n.text).join(' ')); }
async function attribute(html, css, attr) { return (await select(html, css, attr))[0]?.attr || ''; }
async function poster(html, css = 'img', parent) {
  return absolute(await attribute(html, css, 'data-src') || await attribute(html, css, 'src'), parent);
}

function episodeUrl(page, target) { return page.split('#')[0] + '#uk=' + encodeURIComponent(JSON.stringify({v:1,...target})); }
function episodeTarget(input) {
  const hash = input.split('#uk=')[1];
  if (hash === undefined) return undefined;
  try {
    const value = JSON.parse(decodeURIComponent(hash));
    if (value.v !== 1 || typeof value !== 'object') throw Error('format');
    return value;
  } catch { throw new ProviderError('INVALID_EPISODE', 'Некоректне посилання серії. Відкрийте сезон повторно.'); }
}
export { UA, base, clean, inner, origin, unique, absolute, headers, ProviderError,
  answer, request, select, text, attribute, poster, episodeUrl, episodeTarget };
