// SPDX-License-Identifier: GPL-3.0-only
// Port of CloudStream Ukrainian KinostrainProvider at dea43efe. See NOTICE.
import {base,clean,inner,origin,unique,absolute,headers,ProviderError,answer,request,select,text,attribute,poster,episodeUrl,episodeTarget} from '../../shared/core.js';
import {loadPlayer,streamsFromPlayers} from '../../shared/playerjs.js';
const sections=[['В тренді','/trends'],['В тренді фільми','/trends/movies'],['В тренді серіали','/trends/serials'],['В тренді мультфільми','/trends/cartoon-movies'],['В тренді мультсеріали','/trends/cartoon-series'],['Все','/?page=1'],['Фільми','/movies?page=1'],['Серіали','/serials?page=1'],['Мультфільми','/cartoon-movies?page=1'],['Мультсеріали','/cartoon-series?page=1']];
const contentType=url=>/\/movie-/.test(url)?'movie':'series';
async function cards(html,paginated){
  const items=[];
  for(const node of await select(html,paginated?'div.grid > article':'div.grid > a','href')){
    const body=inner(node),url=absolute(node.attr||await attribute(body,'a','href'));
    const title=await text(body,'h3.text-foreground')||await text(body,'a');
    const posterUrl=await poster(body,'img');
    if(url&&title&&posterUrl)items.push({title,url,posterUrl,type:contentType(url),headers:headers()});
  }return unique(items,e=>e.url);
}
export async function getHome(cb){return answer(cb,async()=>{
  const results=await Promise.allSettled(sections.map(async([name,path])=>{
    const items=await cards(await request(base()+path),path.includes('page='));
    if(!items.length)throw new ProviderError('PARSE_ERROR',`Не знайдено каталогу «${name}».`);return [name,items];
  }));const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw results[0].reason;return Object.fromEntries(good);
});}
export async function search(query,cb){return answer(cb,async()=>{
  if(!clean(query))return [];
  const api=origin(base()).replace(/^(https?:\/\/)(?:www\.)?/,'$1api.');
  let response;try{response=JSON.parse(await request(api+'/api/search?q='+encodeURIComponent(query.trim())+'&limit=10'));}catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError('PARSE_ERROR','Kinostrain повернув некоректний пошук.');}
  if(!Array.isArray(response.data))throw new ProviderError('PARSE_ERROR','Kinostrain не повернув список пошуку.');
  return response.data.filter(e=>e.name&&e.slug).map(e=>({title:clean(e.name),url:base()+(e.type==='movie'?'/movie-'+e.slug:'/'+e.slug+'/season-'+(Number(e.firstReadySeason?.number)||1)),posterUrl:absolute(e.posterUrl),type:e.type==='movie'?'movie':'series',headers:headers()}));
});}
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:undefined;
// Nuxt values are one-hop indexed references. Numeric leaf values must not be
// dereferenced again, or season/episode numbers become unrelated payload objects.
async function nuxtSeasons(html){
  const raw=(await select(html,'script#__NUXT_DATA__'))[0];
  if(!raw)throw new ProviderError('PARSE_ERROR','Kinostrain не повернув дані Nuxt.');
  let values;try{values=JSON.parse(inner(raw)||raw.text);}catch{throw new ProviderError('PARSE_ERROR','Kinostrain повернув некоректні дані Nuxt.');}
  if(!Array.isArray(values))throw new ProviderError('PARSE_ERROR','Невідомий формат Nuxt.');
  const get=value=>Number.isInteger(value)?values[value]:value;
  const resolve=(node,key)=>node?get(node[key]):undefined;
  let content;
  for(const node of values){if(!object(node))continue;const key=Object.keys(node).find(k=>k.startsWith('content-'));if(key){content=object(resolve(node,key));break;}}
  content=object(resolve(content,'data'))||content;
  const seasons=resolve(content,'seasons');if(!Array.isArray(seasons))throw new ProviderError('NO_STREAMS','Kinostrain не повернув плеєри цього матеріалу.');
  function sources(groups){
    const result=[];if(!object(groups))return result;
    for(const key of Object.keys(groups)){
      const items=resolve(groups,key);if(!Array.isArray(items))continue;
      for(const ref of items){const source=object(get(ref));if(!source)continue;const link=resolve(source,'link'),name=resolve(source,'name');if(typeof link==='string')result.push({name:typeof name==='string'?name:key,link});}
    }return result;
  }
  return seasons.map((ref,index)=>{
    const season=object(get(ref));if(!season)return null;
    const number=Number(resolve(season,'number'))||index+1;
    const playerData=object(resolve(season,'playerData'));
    const frameMap={};const frames=resolve(season,'frames');
    if(Array.isArray(frames))for(const ref of frames){const frame=object(get(ref)),ep=Number(resolve(frame,'episodeNumber')),url=resolve(frame,'url');if(ep&&typeof url==='string')frameMap[ep]=url;}
    const rawEpisodes=resolve(season,'episodes');
    const episodes=Array.isArray(rawEpisodes)?rawEpisodes.map((ref,i)=>{
      const e=object(get(ref));if(!e)return null;const episode=Number(resolve(e,'number'))||i+1;
      return {season:number,episode,name:clean(String(resolve(e,'name')||`Серія ${episode}`)),posterUrl:frameMap[episode]||'',sources:sources(object(resolve(playerData,String(episode))))};
    }).filter(e=>e&&e.sources.length):[];
    return {number,episodes,movieSources:sources(object(resolve(playerData,'1'))||playerData)};
  }).filter(Boolean);
}
async function seriesEpisodes(html,page){
  const links=unique((await select(html,'div.seasons-grid a.season-item','href')).map(n=>absolute(n.attr,page)).filter(url=>origin(url)===origin(page)),x=>x);
  const pages=links.length?links:[page];if(pages.length>100)throw new ProviderError('PARSE_ERROR','Забагато сторінок сезонів.');
  const all=[];
  for(const seasonPage of pages){
    const seasons=await nuxtSeasons(seasonPage===page?html:await request(seasonPage));
    for(const season of seasons)for(const e of season.episodes)all.push({...e,seasonPage});
  }return unique(all,e=>e.season+'|'+e.episode).sort((a,b)=>a.season-b.season||a.episode-b.episode);
}
async function metadata(html,url){
  let data;
  for(const script of await select(html,'script[type="application/ld+json"]')){
    try{const parsed=JSON.parse(inner(script)||script.text);const candidates=Array.isArray(parsed)?parsed:parsed['@graph']||[parsed];data=candidates.find(e=>e.name&&(/Movie|TVSeries|TVSeason/.test(e['@type'])||e.image||e.description))||candidates.find(e=>e.name);if(data)break;}catch{}
  }
  if(!data?.name)throw new ProviderError('PARSE_ERROR','Kinostrain не повернув назву матеріалу.');
  const item={title:clean(data.name),url,posterUrl:absolute(typeof data.image==='string'?data.image:data.image?.url,url),type:contentType(url),description:clean(data.description),tags:Array.isArray(data.genre)?data.genre:typeof data.genre==='string'?[data.genre]:[],actors:(Array.isArray(data.actor)?data.actor:[]).map(a=>({name:clean(a.actor?.name||a.name)})).filter(a=>a.name),recommendations:[],trailers:[],headers:headers()};
  const score=Number(data.aggregateRating?.ratingValue);if(score>0&&score<=10)item.score=score;
  const year=Number(String(data.datePublished||data.startDate||'').match(/\d{4}/)?.[0]);if(year)item.year=year;
  const trailer=absolute(data.trailer?.embedUrl||data.trailer?.contentUrl,url);if(trailer)item.trailers.push({url:trailer});
  return item;
}
export async function load(input,cb){return answer(cb,async()=>{
  const url=input.split('#')[0],html=await request(url),item=await metadata(html,url);
  if(item.type==='series'){
    const episodes=await seriesEpisodes(html,url);if(!episodes.length)throw new ProviderError('NO_EPISODES','Kinostrain не повернув серії.');
    item.episodes=episodes.map(e=>({name:e.name,season:e.season,episode:e.episode,url:episodeUrl(url,{season:e.season,episode:e.episode,seasonPage:e.seasonPage}),posterUrl:absolute(e.posterUrl,e.seasonPage),dubStatus:'dubbed'}));
  }else await nuxtSeasons(html);
  return item;
});}
export async function loadStreams(input,cb){return answer(cb,async()=>{
  const page=input.split('#')[0],target=episodeTarget(input),seasonPage=target?.seasonPage?absolute(target.seasonPage,page):page;
  if(origin(seasonPage)!==origin(page))throw new ProviderError('INVALID_EPISODE','Некоректна сторінка сезону.');
  const seasons=await nuxtSeasons(await request(seasonPage));
  const sources=target?seasons.flatMap(s=>s.episodes).filter(e=>e.season===Number(target.season)&&e.episode===Number(target.episode)).flatMap(e=>e.sources):seasons.flatMap(s=>s.movieSources);
  if(!sources.length)throw new ProviderError('NO_STREAMS','Kinostrain не повернув джерела для вибраного відео.');
  const results=await Promise.allSettled(unique(sources,e=>e.name+'|'+e.link).map(async source=>{
    const player=await loadPlayer(absolute(source.link,seasonPage),seasonPage);
    player.entries=player.entries.map(e=>({...e,voice:source.name||e.voice,...(/\.(m3u8|mp4|mpd)(?:[?#]|$)/i.test(source.link)?{player:seasonPage}:{})}));return player;
  }));
  const players=results.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!players.length)throw results[0].reason;
  return streamsFromPlayers(players);
});}
