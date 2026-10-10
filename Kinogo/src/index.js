// SPDX-License-Identifier: GPL-3.0-only
// Original SkyStream adapter for Kinogo's public Cinemar and HDVB players.
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
function entriesFrom(data, field='data') {
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
      else if (typeof node[field]==='string'&&node[field]) entries.push({...next,voice:name||'Kinogo',data:node[field]});
    }
  };
  walk(data);
  if (!entries.length) throw noStreams();
  return entries;
}
// HDVB's public player posts both the show playlist and individual media tokens
// to vid11.<href>, with the key issued by the freshly fetched iframe. Never cache it.
function backupContext(config,url) {
  const host=origin(url).replace(/^https?:\/\//,'').toLowerCase();
  const domain=typeof config.href==='string'?config.href.toLowerCase():'';
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(domain) ||
      !(host===domain || host.endsWith('.'+domain)) ||
      typeof config.key!=='string' || !config.key || /[\r\n]/.test(config.key)) throw parseError();
  return {kind:'hdvb',url,api:'https://vid11.'+domain,key:config.key};
}
async function backupRequest(player,path) {
  if (!/^\/playlist\/[A-Za-z0-9+_!$=-]+\.txt$/.test(path)) throw parseError();
  return request(player.api+path,{...headers(player.url),Origin:origin(player.url),
    'Content-Type':'application/x-www-form-urlencoded','X-CSRF-TOKEN':player.key},'');
}
async function readPlayer(url,page) {
  const body=await request(url,headers(page));
  for (const script of await select(body,'script')) {
    // Mobile Kinogo uses NextEmbed. Its seasons are JSON even though the outer
    // makePlayer options are JavaScript; parse only the serialized array.
    const seasons=/\bseasons\s*:\s*(?=\[)/.exec(script.text);
    if (seasons && /\bmakePlayer\s*\(/.test(script.text)) {
      let data;
      try {data=JSON.parse(jsonValueAt(script.text,seasons.index+seasons[0].length));} catch {throw parseError();}
      const entries=[];
      for (const season of data) {
        if (season?.blocked || !Number.isInteger(season?.season) || !Array.isArray(season.episodes)) continue;
        for (const episode of season.episodes) {
          if (episode?.blocked || !/^\d+$/.test(String(episode?.episode)) || typeof episode.hls!=='string') continue;
          entries.push({season:season.season,episode:Number(episode.episode),title:`Серія ${episode.episode}`,
            voice:'NextEmbed',data:episode.hls,subtitles:Array.isArray(episode.cc)
              ?episode.cc.filter(s=>s&&typeof s.url==='string').map(s=>({url:s.url,label:label(s.name)||'Субтитри'})):[]});
        }
      }
      if (!entries.length) throw noStreams();
      return {kind:'nextembed',url,entries};
    }
    const match=/\bCinemar\s*\(\s*(?=\{)/.exec(script.text);
    if (match) {
      let config;
      try {config=JSON.parse(jsonValueAt(script.text,match.index+match[0].length));} catch {throw parseError();}
      return {kind:'cinemar',url,entries:entriesFrom(decodePlaylist(config.file))};
    }
    const backup=/\b(?:var|let|const)\s+playerConfigs\s*=\s*(?=\{)/.exec(script.text);
    if (!backup || !/\bHDVBPlayer\s*\(\s*playerConfigs\s*\)/.test(script.text)) continue;
    let config;
    try {config=JSON.parse(jsonValueAt(script.text,backup.index+backup[0].length));} catch {throw parseError();}
    const player=backupContext(config,url);
    if (typeof config.file!=='string') throw parseError();
    if (config.file.startsWith('/playlist/')) {
      const response=await backupRequest(player,config.file);
      let data;
      try {data=JSON.parse(response);} catch {throw parseError();}
      if (!Array.isArray(data)) throw noStreams();
      return {...player,entries:entriesFrom(data,'file')};
    }
    return {...player,entries:[{voice:label(config.translator)||'Kinogo',data:config.file}]};
  }
  throw parseError();
}
async function playerFrom(html,page,accept=async player=>player) {
  const candidates=[];
  for (const attr of ['data-src','src']) {
    for (const frame of await select(html,'.js-player-container iframe, .player-container iframe, article iframe',attr)) {
      const url=absolute(frame.attr,page);
      if (url && /\/embed\//.test(url) && !/youtube\.com|youtu\.be/i.test(url)) candidates.push(url);
    }
  }
  for (const tab of await select(html,'.kg-video-tabs [data-provider][data-src], .video-tabs [data-provider][data-src], .js-player-tabs [data-provider][data-src]','data-src')) {
    const url=absolute(tab.attr,page);
    if (url && /\/(?:serial|movie)\/[^/]+\/iframe(?:[?#]|$)|\/embed\/(?:movie|series)\/\d+(?:[?#]|$)/.test(url)) candidates.push(url);
  }
  if (!candidates.length) throw noStreams();
  let failure;
  for (const url of new Set(candidates)) {
    try {
      return await accept(await readPlayer(url,page));
    } catch (error) {failure=error;}
  }
  throw failure || noStreams();
}
export async function load(input,cb) {
  return answer(cb,async()=>{
    const url=absolute(input.split('#')[0]);
    const {html,item}=await detail(url);
    if (item.type==='series') {
      item.episodes=await playerFrom(html,url,async player=>{
        const episodes=unique(player.entries.filter(e=>Number.isInteger(e.season)&&Number.isInteger(e.episode))
          .map(e=>({name:e.title||`Серія ${e.episode}`,season:e.season,episode:e.episode,
            url:episodeUrl(url,{season:e.season,episode:e.episode})})),e=>e.season+':'+e.episode)
          .sort((a,b)=>a.season-b.season||a.episode-b.episode);
        if (!episodes.length) throw new ProviderError('NO_EPISODES','Плеєр Kinogo не повернув список серій.');
        return episodes;
      });
    }
    return item;
  });
}
async function streamsFrom(player,item,target) {
  const entries=player.entries.filter(e=>item.type==='series'
    ?e.season===target.season&&e.episode===target.episode:e.episode===undefined);
  if (!entries.length) throw noStreams();
  const results=[];
  // A show may expose dozens of voices: cap concurrent API + playlist requests.
  for (let i=0;i<entries.length;i+=3) {
    results.push(...await Promise.allSettled(entries.slice(i,i+3).map(async entry=>{
      let media;
      if (player.kind==='nextembed') {
        media={file:entry.data,subtitle:entry.subtitles};
      } else if (player.kind==='hdvb') {
        if (!/^[~#][A-Za-z0-9+_!$=-]+$/.test(entry.data)) throw noStreams();
        media={file:(await backupRequest(player,'/playlist/'+entry.data.slice(1)+'.txt')).trim()};
      } else {
        const body=await request(origin(player.url)+'/api/playlist/load',
          {...headers(player.url),'Content-Type':'application/json'},JSON.stringify(entry.data));
        try {media=JSON.parse(body);} catch {throw parseError();}
        if (!media || media.success===false) throw noStreams();
        media=media.data || media;
      }
      if (typeof media.file!=='string') throw noStreams();
      const streams=await streamResults(media.file,{voice:entry.voice,player:player.url,requireValidHls:true,
        subtitles:parseSubtitles(media.subtitle||'',player.url)});
      return streams.filter(s=>/^https?:\/\/[^\s]+\.(?:m3u8|mp4)(?:[?#]|$)/i.test(s.url));
    })));
  }
  const streams=unique(results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value),s=>s.source+'|'+s.url);
  if (!streams.length) throw results.find(r=>r.status==='rejected')?.reason || noStreams();
  return streams;
}
export async function loadStreams(input,cb) {
  return answer(cb,async()=>{
    const target=episodeTarget(input);
    const url=absolute(input.split('#')[0]);
    const {html,item}=await detail(url);
    if (item.type==='series' && (!Number.isInteger(target?.season)||!Number.isInteger(target?.episode))) {
      throw new ProviderError('INVALID_EPISODE','Виберіть конкретну серію перед відтворенням.');
    }
    return playerFrom(html,url,player=>streamsFrom(player,item,target));
  });
}
