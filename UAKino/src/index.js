// SPDX-License-Identifier: GPL-3.0-only
// Port of CakesTwix/cloudstream-extensions-uk's UakinoProvider. See NOTICE.
const UA = 'Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Mobile Safari/537.36';
const sections = [
  ['Фільми', '/filmy/'], ['Серіали', '/seriesss/'],
  ['Дорами', '/seriesss/doramy/'], ['Мультфільми', '/cartoon/'],
  ['Мультсеріали', '/cartoon/cartoonseries/'], ['Аніме', '/animeukr/'],
];
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
    if (part === '..') parts.pop();
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
      message: error instanceof ProviderError ? error.message : 'Не вдалося виконати запит UAKino. Перевірте з’єднання та повторіть спробу.' };
  }
  cb(response);
}
async function request(url, extraHeaders = headers(), body) {
  const response = body === undefined ? await http_get(url, extraHeaders) : await http_post(url, extraHeaders, body);
  const html = String(response.body ?? '');
  const status = Number(response.status ?? response.statusCode ?? 0);
  if (/cf-chl-|challenge-platform|<title>\s*Just a moment/i.test(html)) {
    throw new ProviderError('CLOUDFLARE_BLOCKED', 'UAKino або відеохост показує перевірку Cloudflare. Повторіть спробу пізніше; плагін не може пройти інтерактивну перевірку.');
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
function contentType(url, tags = []) {
  if (tags.includes('Повнометражне аніме')) return 'movie';
  if (/\/anime-series/.test(url) || tags.includes('Багатосерійне аніме')) return 'anime';
  return /\/(seriesss|cartoonseries)\//.test(url) || tags.some(t => /Мультсеріали|Дорами/.test(t)) ? 'series' : 'movie';
}
async function cards(html, css = 'div.owl-item, div.movie-item', parent = base() + '/') {
  const results = [];
  for (const node of await select(html, css)) {
    const body = inner(node);
    const url = absolute(await attribute(body, 'a.movie-title, a.full-movie', 'href'), parent);
    const title = await text(body, 'a.movie-title, div.full-movie-title');
    if (!url || !title || /\/(news|franchise)\//.test(url)) continue;
    results.push({ title, url, posterUrl: await poster(body, 'img', parent), type: contentType(url), headers: headers() });
  }
  return unique(results, item => item.url);
}
export async function getHome(cb) {
  return answer(cb, async () => {
    const results = await Promise.allSettled(sections.map(async ([name, path]) => {
      const items = await cards(await request(base() + path));
      if (!items.length) throw new ProviderError('PARSE_ERROR', `Не знайдено каталогу «${name}». Структура сайту могла змінитися.`);
      return [name, items.filter(item => !(name === 'Мультфільми' && item.type === 'series') && !(name === 'Серіали' && /\/doramy\//.test(item.url)))];
    }));
    const good = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!good.length) throw results[0].reason;
    if (good.length !== sections.length) console.warn('UAKino: частина розділів недоступна.');
    return Object.fromEntries(good);
  });
}
export async function search(query, cb) {
  return answer(cb, async () => {
    if (!clean(query)) return [];
    const body = 'do=search&subaction=search&story=' + encodeURIComponent(query.trim());
    const html = await request(base() + '/ua/', { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' }, body);
    const items = await cards(html, 'div.movie-item.short-item');
    if (!items.length && !/search|пошук|результат|не знайдено/i.test(html)) {
      throw new ProviderError('PARSE_ERROR', 'Не вдалося розпізнати сторінку пошуку UAKino.');
    }
    return items;
  });
}
function newsId(url) { return url.split('/').pop()?.match(/^(\d+)-/)?.[1] || ''; }
async function playlist(id) {
  if (!/^\d+$/.test(id)) return [];
  const response = await request(`${base()}/engine/ajax/playlists.php?news_id=${id}&xfield=playlist&time=${Date.now()}`,
    { Referer: base(), 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': UA });
  let data;
  try { data = JSON.parse(response); }
  catch { throw new ProviderError('PARSE_ERROR', 'UAKino повернув некоректний плейлист.'); }
  if (data.success === false && data.message === 'ERR_NOT_DATA') return [];
  if (data.success !== true || typeof data.response !== 'string') {
    throw new ProviderError('PARSE_ERROR', 'Не вдалося отримати плейлист UAKino.');
  }
  const files = await select(data.response, 'div.playlists-videos li', 'data-file');
  const voices = await select(data.response, 'div.playlists-videos li', 'data-voice');
  return files.map((node, i) => ({ name: clean(node.text), url: absolute(node.attr).replace(/^http:/, 'https:'), voice: clean(voices[i]?.attr) }))
    .filter(item => item.name && item.url);
}
async function detailPage(url) {
  const html = await request(url);
  const title = await text(html, 'h1 span.solototle');
  if (!title) throw new ProviderError('PARSE_ERROR', 'Сторінка не містить назви фільму або серіалу. Структура UAKino могла змінитися.');
  return { html, title };
}
export async function load(input, cb) {
  return answer(cb, async () => {
    const url = absolute(input.split('#')[0]);
    const { html, title } = await detailPage(url);
    const item = { title, url, posterUrl: await poster(html, 'div.film-poster img', url),
      description: await text(html, 'div[itemprop="description"]'),
      tags: [], cast: [], trailers: [], recommendations: [], headers: headers() };
    for (const node of await select(html, '.fi-item-s, .fi-item')) {
      const body = inner(node);
      const label = await text(body, '.fi-label');
      const value = await text(body, '.fi-desc');
      if (label.includes('Рік виходу:') && /^\d{4}$/.test(value)) item.year = Number(value);
      else if (label.includes('Жанр:')) item.tags = value.split(/\s*,\s*/).filter(Boolean);
      else if (label.includes('Актори:')) item.cast = value.split(/\s*,\s*/).filter(Boolean).map(name => ({ name }));
      else if (label.includes('Вік. рейтинг:')) item.contentRating = value;
      else if (label.includes('Тривалість:')) {
        const hours = Number(value.match(/(\d+)\s*год/)?.[1] || 0);
        const minutes = Number(value.match(/(\d+)\s*хв/)?.[1] || 0);
        if (hours || minutes) item.duration = hours * 60 + minutes;
      } else if (label.includes('Країна:') && value) item.description = `Країна: ${value}.\n${item.description}`;
      else if ((await select(body, '.fi-label img')).length) {
        const score = Number(value.split('/')[0].replace(',', '.'));
        if (score > 0 && score <= 10) item.score = score;
      }
    }
    item.type = contentType(url, item.tags);
    for (const attr of ['value', 'content', 'href', 'src']) {
      const trailer = absolute(await attribute(html, '[itemprop~="trailer"]', attr), url);
      if (trailer) { item.trailers.push({ url: trailer }); break; }
    }
    // Each season is a separate UAKino title, as in the CloudStream provider.
    for (const season of await select(html, '.seasons li a', 'href')) {
      const seasonUrl = absolute(season.attr, url);
      if (seasonUrl && seasonUrl !== url) item.recommendations.push({ title: `${title.replace(/\s*\d+\s*сезон.*$/i, '')} — ${clean(season.text)}`,
        url: seasonUrl, posterUrl: item.posterUrl, type: item.type, headers: headers() });
    }
    item.recommendations.push(...await cards(html, '.related-item', url));
    item.recommendations = unique(item.recommendations, entry => entry.url);
    if (item.type !== 'movie') {
      const id = await attribute(html, 'div.playlists-ajax', 'data-news_id') || newsId(url);
      const entries = await playlist(id);
      if (!entries.length) throw new ProviderError('NO_EPISODES', 'UAKino не повернув список серій для цього сезону.');
      const season = Number(title.match(/(\d+)\s*сезон/i)?.[1] || url.match(/-(\d+)-sezon/i)?.[1] || 1);
      item.episodes = unique(entries, e => e.name).map((entry, i) => ({
        name: entry.name, season, episode: Number(entry.name.match(/\d+/)?.[0] || i + 1),
        url: `${url}#uakino=${encodeURIComponent(JSON.stringify({ v: 1, id, name: entry.name }))}`,
        posterUrl: item.posterUrl, dubStatus: 'dubbed',
      })).sort((a, b) => a.episode - b.episode);
    }
    return item;
  });
}

// Public PlayerJS URL serialization used by the upstream provider; not DRM.
function decodeStream(value) {
  if (/^https?:\/\//i.test(value)) return absolute(value);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const raw = value.replace(/\s/g, '').replace(/=+$/, '');
  if (!raw || /[^A-Za-z\d+/]/.test(raw) || raw.length % 4 === 1) return '';
  const bytes = [];
  let bits = 0, buffer = 0;
  for (const char of raw) {
    buffer = (buffer << 6) | alphabet.indexOf(char); bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); }
  }
  if (bytes.length < 2) return '';
  const salt = bytes.shift();
  const decoded = bytes.map((byte, i) => byte ^ ((salt + 7 * i + 13) % 256));
  try {
    const url = decodeURIComponent(decoded.map(byte => '%' + byte.toString(16).padStart(2, '0')).join(''));
    return /^https?:\/\//i.test(url) ? absolute(url) : '';
  } catch { return ''; }
}
function properties(script, name) {
  const pattern = new RegExp(`(?:\\b${name}|["']${name}["'])\\s*:\\s*(["'])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`, 'g');
  return Array.from(script.matchAll(pattern), match => match[2]
    .replace(/\\u([a-f\d]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([a-f\d]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\([\\/'"])/g, '$1'));
}
function subtitles(raw, player) {
  const entries = Array.from(raw.matchAll(/\[([^\]]+)\]([^\[]+)/g), match => {
    const label = clean(match[1]);
    const url = absolute(match[2].replace(/,\s*$/, '').trim(), player);
    const lang = /укра|\buk\b|\bua\b/i.test(label) ? 'uk' : /english|англ|\ben\b/i.test(label) ? 'en' : undefined;
    return { url, label, ...(lang ? { lang } : {}) };
  }).filter(sub => sub.url);
  return unique(entries, sub => sub.url);
}
async function extract(player, voice) {
  const html = await request(player, headers());
  const script = (await select(html, 'script')).map(node => inner(node) || node.text).join('\n');
  const candidates = properties(script, 'file');
  // Prefer HLS over an earlier advertising MP4, matching CloudStream's choice.
  candidates.sort((a, b) => Number(b.includes('.m3u8')) - Number(a.includes('.m3u8')));
  let media = [];
  for (const value of candidates) {
    if (/^\[\d+p?\]/i.test(value)) {
      media = Array.from(value.matchAll(/\[([^\]]+)\]([^\[]+)/g), m => ({
        url: decodeStream(m[2].replace(/,\s*$/, '').trim()), quality: m[1],
      })).filter(m => m.url);
    } else {
      const url = decodeStream(value.trim());
      if (url) media = [{ url, quality: 'Auto' }];
    }
    if (media.length) break;
  }
  if (!media.length) throw new ProviderError('NO_STREAMS', 'Плеєр не містить підтримуваного посилання на відео.');
  const subs = subtitles(properties(script, 'subtitle').join(','), player);
  const streamHeaders = { Referer: origin(player) + '/', 'User-Agent': UA };
  const streams = [];
  const result = (url, quality) => ({ url, source: `${voice || 'UAKino'} · ${quality}`, providerName: 'UAKino', headers: streamHeaders, subtitles: subs });
  for (const mediaItem of media) {
    streams.push(result(mediaItem.url, mediaItem.quality));
    if (!/\.m3u8(?:[?#]|$)/i.test(mediaItem.url)) continue;
    // Master stays available even if probing is blocked or variants require
    // separate audio groups; the player's native HLS implementation handles it.
    try {
      const m3u8 = await request(mediaItem.url, streamHeaders);
      if (!m3u8.trimStart().startsWith('#EXTM3U') || /#EXT-X-MEDIA:.*TYPE=AUDIO/.test(m3u8)) continue;
      const lines = m3u8.split(/\r?\n/).map(line => line.trim());
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
        const quality = lines[i].match(/RESOLUTION=\d+x(\d+)/)?.[1];
        let next = i + 1;
        while (next < lines.length && (!lines[next] || lines[next].startsWith('#'))) next++;
        const url = absolute(lines[next], mediaItem.url);
        if (url) streams.push(result(url, quality ? `${quality}p` : 'HLS'));
      }
    } catch { console.warn('UAKino: список якостей недоступний, залишено HLS Auto.'); }
  }
  return unique(streams, s => s.url + '|' + s.source);
}
export async function loadStreams(input, cb) {
  return answer(cb, async () => {
    const pageUrl = absolute(input.split('#')[0]);
    let target;
    const encoded = input.split('#uakino=')[1];
    if (encoded) {
      try { target = JSON.parse(decodeURIComponent(encoded)); }
      catch { throw new ProviderError('INVALID_EPISODE', 'Некоректне посилання серії. Відкрийте сезон повторно.'); }
      if (target.v !== 1 || typeof target.name !== 'string' || !/^\d+$/.test(target.id)) {
        throw new ProviderError('INVALID_EPISODE', 'Невідомий формат серії. Відкрийте сезон повторно.');
      }
    }
    let entries = await playlist(target?.id || newsId(pageUrl));
    if (target) entries = entries.filter(entry => entry.name === target.name);
    if (!entries.length && !target) {
      const { html, title } = await detailPage(pageUrl);
      const frames = await select(html, 'iframe#pre', 'src');
      // The site also gives the trailer id="pre"; never return it as the film.
      entries = frames.map(frame => ({ url: absolute(frame.attr, pageUrl).replace(/^http:/, 'https:'), voice: title }))
        .filter(frame => frame.url && !/youtube\.com|youtu\.be/.test(frame.url));
      const trailerFrames = await select(html, '#overroll iframe', 'src');
      const trailers = new Set(trailerFrames.map(frame => absolute(frame.attr, pageUrl)));
      entries = entries.filter(frame => !trailers.has(frame.url));
    }
    if (!entries.length) throw new ProviderError('NO_STREAMS', 'UAKino не повернув плеєр для цього фільму або серії.');
    const results = await Promise.allSettled(unique(entries, e => e.url + '|' + e.voice).map(entry => extract(entry.url, entry.voice)));
    const streams = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
    if (!streams.length) throw results.find(r => r.status === 'rejected')?.reason || new ProviderError('NO_STREAMS', 'Доступних потоків не знайдено.');
    if (results.some(r => r.status === 'rejected')) console.warn('UAKino: частина озвучень недоступна.');
    return unique(streams, stream => stream.url + '|' + stream.source);
  });
}
