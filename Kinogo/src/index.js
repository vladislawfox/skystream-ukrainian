// SPDX-License-Identifier: GPL-3.0-only
// Original SkyStream adapter for Kinogo's public pages and Cinemar protocol.
import {base, clean, inner, origin, unique, absolute, headers, ProviderError,
  answer, request, select, text, attribute, poster, episodeUrl, episodeTarget} from '../../shared/core.js';
import {base64Bytes, jsonValueAt, streamResults, parseSubtitles} from '../../shared/playerjs.js';

const sections = [['Фільми','/filmy/','movie'],['Серіали','/serialy/','series'],['Мультфільми','/multfilmy/','movie']];
const label = value => clean(String(value ?? '').replace(/<[^>]*>/g, ''));
const titleOnly = value => clean(value.replace(/\s*\((?:\d{4}|\d+(?:\s*[-–]\s*\d+)?\s*сезон[^)]*)\)\s*$/i,''));
const seriesLabel = value => /\b\d+(?:\s*[-–]\s*\d+)?\s*сезон/i.test(value);
const parseError = () => new ProviderError('PARSE_ERROR','Не вдалося розпізнати сторінку або плейлист Kinogo. Структура сайту могла змінитися.');
const noStreams = () => new ProviderError('NO_STREAMS','Для цього матеріалу або озвучення немає доступного відео.');

async function cards(html, type) {
  const items = [];
  for (const node of await select(html,'.article--short, .shortstory')) {
    const body = inner(node);
    const rawTitle = await text(body,'.article__title, .shortstory__title');
    const url = absolute(await attribute(body,'.article__title a, .shortstory__title a','href'));
    if (!url || !rawTitle) continue;
    const isSeries = seriesLabel(rawTitle) || (await select(body,'a[href*="/serialy/"], a[href*="/multserialy/"]')).length > 0;
    const year = (await text(body,'a[href*="year-teg-xfsearch"]')).match(/\b(?:19|20)\d{2}\b/)?.[0];
    items.push({title:titleOnly(rawTitle),url,type:type || (isSeries?'series':'movie'),
      posterUrl:await poster(body,'.article__poster img, .shortstory__poster img'),headers:headers(),...(year?{year:Number(year)}:{})});
  }
  return unique(items,item=>item.url);
}

export async function getHome(cb) {
  return answer(cb,async()=>{
    const results = await Promise.allSettled(sections.map(async([name,path,type])=>{
      const items = await cards(await request(base()+path),type);
      if (!items.length) throw parseError();
      return [name,items];
    }));
    const good = results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    if (!good.length) throw results[0].reason;
    return Object.fromEntries(good);
  });
}
export async function search(query,cb) {
  return answer(cb,async()=>{
    if (!clean(query)) return [];
    const html = await request(base()+'/search/'+encodeURIComponent(query.trim()));
    const items = await cards(html);
    if (!items.length && !(await select(html,'.js-ls-form, .js-lightsearch-form')).length) throw parseError();
    return items;
  });
}

async function detail(url) {
  const html = await request(url);
  const rawTitle = await text(html,'article h1');
  if (!rawTitle) throw parseError();
  const genreHtml = (await select(html,'.article__info-genre, .m_info .nd-flex')).map(inner).join('');
  const isSeries = seriesLabel(rawTitle) || (await select(genreHtml,'a[href*="/serialy/"], a[href*="/multserialy/"]')).length > 0;
  const yearText = await text(html,'.article__info-year, .m_info a[href*="year-teg-xfsearch"]');
  const scoreText = await text(html,'.article__info-imdb, .movie_poster .imdb');
  const year = Number(yearText.match(/\b(?:19|20)\d{2}\b/)?.[0]);
  const score = Number(scoreText.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',','.'));
  const trailer = absolute(await attribute(html,'.js-player-trailer, .kg-video-trailer','data-src'),url);
  // JSON-LD is available on the desktop layout; the mobile layout uses article__text.
  let ld = {};
  for (const script of await select(html,'script[type="application/ld+json"]')) {
    try { const data=JSON.parse(script.text); if (['Movie','TVSeries'].includes(data['@type'])) {ld=data;break;} } catch {}
  }
  const item = {title:titleOnly(rawTitle),url,type:isSeries?'series':'movie',
    posterUrl:await poster(html,'.article__poster img, .movie_poster img',url),
    description:await text(html,'.article--full .article__text, article > .article__text') || clean(ld.description),
    tags:(await select(genreHtml,'a')).map(n=>clean(n.text)).filter(Boolean),
    cast:[],trailers:trailer?[{url:trailer}]:[],recommendations:[],headers:headers(),
    ...(year?{year}:{}),...(score>0&&score<=10?{score}:{})};
  return {html,item};
}

// Cinemar #2: delimiter code, per-chunk rotation/padding, Base64 UTF-8 JSON.
// Parse this public serialization directly; never evaluate the site's JavaScript.
function decodePlaylist(file) {
  if (Array.isArray(file)) return file;
  if (typeof file !== 'string' || !/^#2\d{2}/.test(file)) throw parseError();
  const delimiter = String.fromCharCode(Number(file.slice(2,4)));
  const encoded = file.slice(4).split(delimiter).map(chunk=>{
    if (chunk.length<=32) return chunk;
    const count = Number(chunk.slice(-1));
    if (!/\d/.test(chunk.slice(-1)) || chunk.length<=3*count+1) throw parseError();
    return chunk.substr(2*count,chunk.length-3*count-1)+chunk.substr(0,count);
  }).join('');
  try {
    const bytes=base64Bytes(encoded);
    const data=JSON.parse(decodeURIComponent(bytes.map(b=>'%'+b.toString(16).padStart(2,'0')).join('')));
    if (!Array.isArray(data)) throw Error('not playlist');
    return data;
  } catch { throw parseError(); }
}
function entriesFrom(data) {
  const entries=[];
  const walk=(nodes,context={},depth=0)=>{
    if (depth>6 || !Array.isArray(nodes)) throw parseError();
    for (const node of nodes) {
      if (!node || typeof node!=='object') continue;
      const name=label(node.title);
      const id=String(node.id||'');
      const season=id.match(/^s(\d+)(?:e\d+)?$/i)?.[1] ?? name.match(/сезон\s*(\d+)|(\d+)\s*сезон/i)?.slice(1).find(x=>x!==undefined);
      const episode=id.match(/^s\d+e(\d+)$/i)?.[1] ?? name.match(/сери[яі]\s*(\d+)|(\d+)\s*сери[яі]/i)?.slice(1).find(x=>x!==undefined);
      const next={...context,...(season!==undefined?{season:Number(season)}:{}),...(episode!==undefined?{episode:Number(episode),title:name}:{})};
      if (Array.isArray(node.folder)) walk(node.folder,next,depth+1);
      else if (typeof node.data==='string'&&node.data) entries.push({...next,voice:name||'Kinogo',data:node.data});
    }
  };
  walk(data);
  if (!entries.length) throw noStreams();
  return entries;
}
async function playerFrom(html,page) {
  const candidates=[];
  for (const attr of ['data-src','src']) {
    for (const frame of await select(html,'.js-player-container iframe, .player-container iframe, article iframe',attr)) {
      const url=absolute(frame.attr,page);
      if (url && /\/embed\//.test(url) && !/youtube\.com|youtu\.be/i.test(url)) candidates.push(url);
    }
  }
  if (!candidates.length) throw noStreams();
  let failure;
  for (const url of new Set(candidates)) {
    try {
      const body=await request(url,headers(page));
      for (const script of await select(body,'script')) {
        const match=/\bCinemar\s*\(\s*(?=\{)/.exec(script.text);
        if (!match) continue;
        let config;
        try {config=JSON.parse(jsonValueAt(script.text,match.index+match[0].length));} catch {throw parseError();}
        return {url,entries:entriesFrom(decodePlaylist(config.file))};
      }
      throw parseError();
    } catch (error) {failure=error;}
  }
  throw failure || noStreams();
}
export async function load(input,cb) {
  return answer(cb,async()=>{
    const url=absolute(input.split('#')[0]);
    const {html,item}=await detail(url);
    if (item.type==='series') {
      const player=await playerFrom(html,url);
      item.episodes=unique(player.entries.filter(e=>Number.isInteger(e.season)&&Number.isInteger(e.episode))
        .map(e=>({name:e.title||`Серія ${e.episode}`,season:e.season,episode:e.episode,
          url:episodeUrl(url,{season:e.season,episode:e.episode})})),e=>e.season+':'+e.episode)
        .sort((a,b)=>a.season-b.season||a.episode-b.episode);
      if (!item.episodes.length) throw new ProviderError('NO_EPISODES','Плеєр Kinogo не повернув список серій.');
    }
    return item;
  });
}
export async function loadStreams(input,cb) {
  return answer(cb,async()=>{
    const target=episodeTarget(input);
    const url=absolute(input.split('#')[0]);
    const {html,item}=await detail(url);
    if (item.type==='series' && (!Number.isInteger(target?.season)||!Number.isInteger(target?.episode))) {
      throw new ProviderError('INVALID_EPISODE','Виберіть конкретну серію перед відтворенням.');
    }
    const player=await playerFrom(html,url);
    const entries=player.entries.filter(e=>item.type==='series'
      ?e.season===target.season&&e.episode===target.episode:e.episode===undefined);
    if (!entries.length) throw noStreams();
    const results=[];
    // A show may expose dozens of voices: cap concurrent API + playlist requests.
    for (let i=0;i<entries.length;i+=3) {
      results.push(...await Promise.allSettled(entries.slice(i,i+3).map(async entry=>{
        const body=await request(origin(player.url)+'/api/playlist/load',
          {...headers(player.url),'Content-Type':'application/json'},JSON.stringify(entry.data));
        let media;
        try {media=JSON.parse(body);} catch {throw parseError();}
        if (!media || media.success===false) throw noStreams();
        media=media.data || media;
        if (typeof media.file!=='string') throw noStreams();
        const streams=await streamResults(media.file,{voice:entry.voice,player:player.url,
          subtitles:parseSubtitles(media.subtitle||'',player.url)});
        return streams.filter(s=>/^https?:\/\/[^\s]+\.(?:m3u8|mp4)(?:[?#]|$)/i.test(s.url));
      })));
    }
    const streams=unique(results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value),s=>s.source+'|'+s.url);
    if (!streams.length) throw results.find(r=>r.status==='rejected')?.reason || noStreams();
    return streams;
  });
}
