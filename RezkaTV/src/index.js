// SPDX-License-Identifier: GPL-3.0-only
// HDrezka protocol adapted from CloudStream HDrezkaProvider (a09f3b23). See NOTICE.
import {base, clean, inner, absolute, origin, unique, headers, ProviderError,
  answer, request, select, text, attribute, poster, episodeUrl, episodeTarget} from '../../shared/core.js';
import {base64Bytes, parseSubtitles} from '../../shared/playerjs.js';

async function fetchPage(url, extra = headers(), body) {
  const html = await request(url, extra, body);
  if (/id=["']anubis_challenge["']|Доступ запрещ[её]н|Access Denied/i.test(html)) {
    throw new ProviderError('SITE_BLOCKED', 'RezkaTV показує перевірку браузера. Потрібен SkyStream із підтримкою Anubis; якщо він уже оновлений, повторіть спробу пізніше.');
  }
  return html;
}
function pageUrl(input) {
  const url = absolute(String(input).split('#')[0]);
  if (!url || origin(url) !== origin(base())) throw new ProviderError('INVALID_URL', 'Відкрийте матеріал із каталогу RezkaTV.');
  return url;
}
async function cards(html) {
  const items = [];
  for (const card of await select(html, '.b-content__inline_item')) {
    const body = inner(card);
    const url = absolute(await attribute(body, '.b-content__inline_item-link a', 'href'));
    const title = await text(body, '.b-content__inline_item-link a');
    if (!url || !title || /\/animation\//.test(url)) continue;
    const series = /\/series\//.test(url) || /серіал|сериал|сезон|серия/i.test(await text(body, '.cat, .info'));
    items.push({title, url, type:series?'series':'movie', posterUrl:await poster(body), headers:headers(base()+'/')});
  }
  return unique(items, x=>x.url);
}
export async function getHome(cb) {
  return answer(cb, async()=>{
    // Sequential: the first page may need a browser session before other requests.
    const results = {};
    let error;
    for (const [name,path] of [['Фільми','films'],['Серіали','series'],['Мультфільми','cartoons']]) {
      try {
        const items = await cards(await fetchPage(`${base()}/${path}/?filter=watching`));
        if (!items.length) throw new ProviderError('PARSE_ERROR', 'Не вдалося розпізнати каталог RezkaTV.');
        results[name] = items;
      } catch (e) { error = e; }
    }
    if (!Object.keys(results).length) throw error;
    return results;
  });
}
export async function search(query, cb) {
  return answer(cb, async()=>{
    if (!clean(query)) return [];
    const html = await fetchPage(`${base()}/search/?do=search&subaction=search&q=${encodeURIComponent(query.trim())}`);
    const items = await cards(html);
    if (!items.length && !/Результаты поиска|Поиск по сайту|ничего не найдено/i.test(html)) throw new ProviderError('PARSE_ERROR', 'Не вдалося розпізнати результати пошуку RezkaTV.');
    return items;
  });
}
async function detail(input) {
  const url = pageUrl(input);
  const html = await fetchPage(url);
  const title = await text(html, '.b-post__title h1');
  if (!title) throw new ProviderError('PARSE_ERROR', 'На сторінці RezkaTV немає назви матеріалу.');
  const init = html.match(/initCDN(Series|Movies)Events\(\s*(\d+)\s*,\s*(\d+)/);
  const id = init?.[2] || url.match(/\/(\d+)-[^/]+\.html/)?.[1];
  const isSeries = init?.[1] === 'Series' || /id=["']simple-episodes-tabs["']/.test(html) || /\/series\//.test(url);
  return {url, html, title, id, isSeries, defaultVoice:init?.[3], favs:await attribute(html,'#ctrl_favs','value')};
}
async function episodeList(html, url) {
  const seasons = await select(html, '#simple-episodes-tabs li', 'data-season_id');
  const episodes = await select(html, '#simple-episodes-tabs li', 'data-episode_id');
  return unique(episodes.map((node,i)=>({season:Number(seasons[i]?.attr), episode:Number(node.attr)}))
    .filter(e=>Number.isInteger(e.season)&&e.season>=0&&Number.isInteger(e.episode)&&e.episode>0), e=>`${e.season}:${e.episode}`)
    .sort((a,b)=>a.season-b.season||a.episode-b.episode)
    .map(e=>({...e,name:`Серія ${e.episode}`,url:episodeUrl(url,e),dubStatus:'dubbed'}));
}
export async function load(input, cb) {
  return answer(cb, async()=>{
    const d = await detail(input);
    const item = {title:d.title,url:d.url,type:d.isSeries?'series':'movie',
      posterUrl:await poster(d.html,'.b-sidecover img',d.url),
      description:await text(d.html,'.b-post__description_text'),
      tags:(await select(d.html,'[itemprop="genre"]')).map(n=>clean(n.text)),
      cast:[],trailers:[],recommendations:[],headers:headers(base()+'/')};
    const year = Number((await text(d.html,'.b-post__info a[href*="/year/"]')).match(/\b(?:19|20)\d{2}\b/)?.[0]);
    const score = Number(await text(d.html,'.b-post__info_rates.imdb .bold'));
    if (year) item.year = year;
    if (score>0&&score<=10) item.score = score;
    if (d.isSeries) {
      item.episodes = await episodeList(d.html,d.url);
      if (!item.episodes.length) throw new ProviderError('NO_EPISODES','RezkaTV не повернув список серій цього матеріалу.');
    }
    return item;
  });
}
async function translators(d) {
  const nodes = await select(d.html,'#translators-list li','data-translator_id');
  const flags = await Promise.all(['data-camrip','data-ads','data-director'].map(attr=>select(d.html,'#translators-list li',attr)));
  const voices = nodes.filter(n=>/^\d+$/.test(n.attr)).map(n=>{
    const i=nodes.indexOf(n), uk=/ua-flag|ukrain|укра[їи]н/i.test(inner(n));
    return {id:n.attr,name:clean(n.text)+(uk?' · Українська':''),uk,
      is_camrip:flags[0][i]?.attr||'0',is_ads:flags[1][i]?.attr||'0',is_director:flags[2][i]?.attr||'0'};
  }).sort((a,b)=>Number(b.uk)-Number(a.uk));
  if (!voices.length && d.defaultVoice) voices.push({id:d.defaultVoice,name:'RezkaTV',is_camrip:'0',is_ads:'0',is_director:'0'});
  return unique(voices,v=>v.id);
}
function decodeStreams(raw) {
  let value=String(raw||'').trim();
  if (value.startsWith('[')) return value;
  if (!value.startsWith('#h')) return '';
  value=value.slice(2);
  // PlayerJS noise is delimited; remove exact tokens, never arbitrary slices.
  for (const salt of ['IyMjI14hISMjIUBA','QEBAQEAhIyMhXl5e','JCQhIUAkJEBeIUAjJCRA','JCQjISFAIyFAIyM=','Xl5eIUAjIyEhIyM=']) value=value.split('//_//'+salt).join('');
  try { return decodeURIComponent(base64Bytes(value).map(b=>'%'+b.toString(16).padStart(2,'0')).join('')); }
  catch { return ''; }
}
function streams(data,voice) {
  const decoded=decodeStreams(data.url);
  const subtitles=parseSubtitles(data.subtitle||'',base()+'/');
  const out=[];
  for (const [,rawQuality,urls] of decoded.matchAll(/\[([^\]]+)\]([^\[]+)/g)) {
    if (/pjs-prem-quality/i.test(rawQuality)) continue;
    const quality=clean(rawQuality.replace(/<[^>]*>/g,''));
    const formats=new Set();
    // Only media URLs returned by the public player, never login/HTML pages.
    for (const part of urls.replace(/[,\s]+$/,'').split(/\s+or\s+/)) {
      const url=absolute(part,base()+'/');
      if (!url || !/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(url)) continue;
      const format=/\.m3u8(?:[?#]|$)/i.test(url)?'hls':'mp4';
      if (formats.has(format)) continue;
      formats.add(format);
      out.push({url,source:`${voice.name} · ${quality}${/\.mp4(?:[?#]|$)/i.test(url)?' · MP4':''}`,providerName:manifest.name,
        headers:{...headers(base()+'/'),Origin:base()},subtitles});
    }
  }
  return out.sort((a,b)=>(Number(b.source.match(/(\d{3,4})p/)?.[1])||0)-(Number(a.source.match(/(\d{3,4})p/)?.[1])||0));
}
export async function loadStreams(input, cb) {
  return answer(cb, async()=>{
    const target=episodeTarget(input), d=await detail(input);
    if (d.isSeries && (!target || !Number.isInteger(target.season) || target.season<0 || !Number.isInteger(target.episode) || target.episode<1)) throw new ProviderError('INVALID_EPISODE','Оберіть сезон і серію RezkaTV.');
    if (!d.id) throw new ProviderError('NO_STREAMS','Не знайдено ідентифікатор плеєра RezkaTV.');
    const voices=await translators(d), result=[];
    let error;
    // Three independent voices at a time. Refresh URLs on every playback/download.
    for (let i=0;i<voices.length;i+=3) {
      const batch=await Promise.allSettled(voices.slice(i,i+3).map(async voice=>{
        const form={id:d.id,translator_id:voice.id,favs:d.favs,
          is_camrip:voice.is_camrip,is_ads:voice.is_ads,is_director:voice.is_director,
          ...(d.isSeries?{season:target.season,episode:target.episode}:{}),action:d.isSeries?'get_stream':'get_movie'};
        const body=Object.entries(form).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
        const raw=await fetchPage(base()+'/ajax/get_cdn_series/',{...headers(d.url),'X-Requested-With':'XMLHttpRequest','Content-Type':'application/x-www-form-urlencoded'},body);
        let data;
        try { data=JSON.parse(raw); } catch { throw new ProviderError('PARSE_ERROR','RezkaTV повернув некоректну відповідь плеєра.'); }
        if (data.success!==true || !data.url) return [];
        return streams(data,voice);
      }));
      for (const entry of batch) {
        if (entry.status==='fulfilled') result.push(...entry.value);
        else error=entry.reason;
      }
    }
    if (!result.length) throw error || new ProviderError('NO_STREAMS','Для цього матеріалу або серії немає доступних потоків RezkaTV.');
    return unique(result,s=>`${s.source}:${s.url}`);
  });
}
