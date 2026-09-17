// SPDX-License-Identifier: GPL-3.0-only
// Port of CakesTwix/cloudstream-extensions-uk at dea43efe. See NOTICE.
import { base, clean, inner, absolute, origin, unique, headers, ProviderError, answer, request, select, text, attribute, poster, episodeTarget } from '../../shared/core.js';
import { loadPlayer, episodesFromPlayers, streamsFromPlayers } from '../../shared/playerjs.js';

async function mediaUrl(html, parent) {
  return absolute(await attribute(html, 'iframe, video, source', 'src') || await attribute(html, 'iframe, video, source', 'data-src'), parent);
}
async function tabTrailer(html, labelsCss, panesCss, parent) {
  const labels = await select(html, labelsCss);
  const index = labels.findIndex(n => /трейлер/i.test(n.text));
  const pane = (await select(html, panesCss))[index];
  return pane ? mediaUrl(inner(pane), parent) : '';
}
async function resolvedTrailer(url) {
  if (!url) return [];
  if (/tortuga\.[^/]+\/vod\/|hdvbua\.[^/]+\/vid\//i.test(url)) {
    try {
      const player = await loadPlayer(url, base() + '/');
      const video = player.entries.find(entry => /^https?:\/\//i.test(entry.url));
      return video && !player.isSeries ? [{ url: video.url, headers: headers(origin(url) + '/') }] : [];
    } catch { return []; }
  }
  return [{ url }];
}
async function playersFrom(html, selector, pageUrl, trailer) {
  const candidates = [];
  const src = await select(html, selector, 'src');
  const deferred = await select(html, selector, 'data-src');
  for (let i = 0; i < src.length; i++) {
    const url = absolute(src[i].attr || deferred[i]?.attr, pageUrl);
    if (url && url !== trailer && !/youtube\.com|youtu\.be/i.test(url)) candidates.push(url);
  }
  if (!candidates.length) throw new ProviderError('NO_STREAMS', 'На сторінці немає доступного основного плеєра.');
  const results = await Promise.allSettled([...new Set(candidates)].map(url => loadPlayer(url, base() + '/')));
  const players = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!players.length) throw results.find(result => result.status === 'rejected')?.reason || new ProviderError('NO_STREAMS', 'Не вдалося завантажити плеєр.');
  return players;
}
async function values(html, css) { return (await select(html, css)).map(node => clean(node.text)).filter(Boolean); }
function addYearAndScore(item, year, score) {
  if (/^\d{4}$/.test(year)) item.year = Number(year);
  const value = Number(String(score).match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.'));
  if (value > 0 && value <= 10) item.score = value;
}
async function home(sections) {
  const results = await Promise.allSettled(sections.map(async ([name, path, type]) => {
    const items = await cards(await request(base() + path + '1'), type);
    if (!items.length) throw new ProviderError('PARSE_ERROR', `Не знайдено каталогу «${name}». Структура сайту могла змінитися.`);
    return [name, items];
  }));
  const good = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!good.length) throw results[0].reason;
  return Object.fromEntries(good);
}
async function find(query, path = '/') {
  if (!clean(query)) return [];
  const html = await request(base() + path, { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' }, 'do=search&subaction=search&story=' + encodeURIComponent(query.trim()));
  const items = await cards(html);
  if (!items.length && !/search|пошук|результат|не знайдено/i.test(html)) throw new ProviderError('PARSE_ERROR', 'Не вдалося розпізнати сторінку пошуку.');
  return items;
}
export async function getHome(cb) { return answer(cb, () => home(sections)); }
export async function search(query, cb) { return answer(cb, () => find(query, SEARCH_PATH)); }
export async function load(input, cb) {
  return answer(cb, async () => {
    const url = absolute(input.split('#')[0]);
    const { item, players, trailer } = await detail(url);
    item.trailers = await resolvedTrailer(trailer);
    if (item.type === 'series') {
      item.episodes = episodesFromPlayers(players, url);
      if (!item.episodes.length) throw new ProviderError('NO_EPISODES', 'Плеєр не повернув список серій.');
    }
    return item;
  });
}
export async function loadStreams(input, cb) {
  return answer(cb, async () => {
    const target = episodeTarget(input);
    const { players } = await detail(absolute(input.split('#')[0]));
    return streamsFromPlayers(players, target);
  });
}

const SEARCH_PATH = '/';
const sections = [['Фільми', '/films/page/', 'movie'], ['Серіали', '/series/page/', 'series'], ['Мультфільми', '/cartoons/page/', 'movie'], ['Мультсеріали', '/s-cartoons/page/', 'series']];
async function cards(html, type) {
  const items = [];
  for (const node of await select(html, '.movie-item')) {
    const body = inner(node);
    const url = absolute(await attribute(body, '.movie-item__link', 'href'));
    const title = await text(body, '.movie-item__title');
    if (url && title) items.push({ title, url, posterUrl: await poster(body, '.img-fit-cover img'), type: type || (/\/(series|s-cartoons)\//.test(url) ? 'series' : 'movie'), headers: headers() });
  }
  return unique(items, item => item.url);
}
async function detail(url) {
  const html = await request(url);
  const title = await text(html, '.inner-page__title');
  if (!title) throw new ProviderError('PARSE_ERROR', 'Не знайдено назви KinoVezha. Структура сайту могла змінитися.');
  const info = await select(html, '.inner-page__list li');
  const tags = await values(html, '.inner-page__list li a');
  const trailer = await tabTrailer(html, '.tabs-block__select--player span', '.tabs-block__content.video-inside', url);
  const players = await playersFrom(html, '.video-responsive > iframe', url, trailer);
  const item = { title, url, posterUrl: await poster(html, '.img-fit-cover img', url), description: await text(html, 'div.inner-page__text'), tags, cast: [], trailers: [], recommendations: [], headers: headers(), type: tags.some(tag => /серіал/i.test(tag)) || players.some(p => p.isSeries) ? 'series' : 'movie' };
  const yearRow = info.find(node => /^Рік\s*:/i.test(clean(node.text))) || info[0];
  addYearAndScore(item, clean(yearRow?.text).match(/\b(?:19|20)\d{2}\b/)?.[0] || '', await text(html, '.dd-imdb-colours'));
  return { item, players, trailer };
}
