// SPDX-License-Identifier: GPL-3.0-only
// Port of CloudStream Ukrainian UAFlixProvider at dea43efe. See NOTICE.
import {base,clean,inner,origin,unique,absolute,headers,ProviderError,answer,request,select,text,attribute,poster,episodeUrl,episodeTarget} from '../../shared/core.js';
import {loadPlayer,episodesFromPlayers,streamsFromPlayers} from '../../shared/playerjs.js';
const sections=[['Фільми','/film/'],['Серіали','/serials/'],['Дорами','/dorama/'],['Мультфільми','/cartoons/'],['Мультсеріали','/serials/multseial/']];
const contentType=url=>/\/(serials|dorama|anime)\//i.test(url)?'series':'movie';
async function cards(html,css='.video-item',parent=base()+'/'){
  const items=[];
  for(const node of await select(html,css,'href')){
    const body=inner(node),url=absolute(node.attr||await attribute(body,'.vi-img, .sres-wrap','href'),parent);
    const title=clean(await attribute(body,'.vi-img, .sres-img img','alt')||await text(body,'.vi-title, .sres-title'));
    if(url&&title)items.push({title,url,posterUrl:await poster(body,'.img-resp-h img, .sres-img img',parent),type:contentType(url),headers:headers()});
  }
  return unique(items,item=>item.url);
}
export async function getHome(cb){return answer(cb,async()=>{
  // Direct category pages are independent of PHPSESSID/xfsort and safe in parallel.
  const results=await Promise.allSettled(sections.map(async([name,path])=>{
    let items=await cards(await request(base()+path));
    if(name==='Мультфільми')items=items.filter(item=>item.type==='movie');
    if(!items.length)throw new ProviderError('PARSE_ERROR',`Не знайдено каталогу «${name}».`);
    return [name,items];
  }));
  const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  if(!good.length)throw results[0].reason;
  return Object.fromEntries(good);
});}
export async function search(query,cb){return answer(cb,async()=>{
  if(!clean(query))return [];
  const html=await request(`${base()}/index.php?do=search&subaction=search&search_start=0&story=${encodeURIComponent(query.trim())}`);
  const items=await cards(html,'.sres-wrap');
  if(!items.length&&!/search|пошук|результат|не знайдено/i.test(html))throw new ProviderError('PARSE_ERROR','Не вдалося розпізнати пошук UAFlix.');
  return items;
});}
async function playerUrls(html,page){
  const names=(await select(html,'.fplayer .tabs-sel .tabs-link')).map(n=>clean(n.text));
  return unique((await select(html,'.video-box iframe','src')).map((n,i)=>({url:absolute(n.attr,page),name:names[i]||''})).filter(p=>p.url&&!/youtube\.com|youtu\.be/i.test(p.url)&&!/трейлер|trailer/i.test(p.name)),p=>p.url);
}
async function players(html,page){
  const urls=await playerUrls(html,page);
  if(!urls.length)throw new ProviderError('NO_STREAMS','UAFlix не повернув основний плеєр.');
  const result=await Promise.allSettled(urls.map(async source=>{
    const player=await loadPlayer(source.url,page);
    if(source.name&&!/дивитись онлайн/i.test(source.name))player.entries=player.entries.map(e=>({...e,voice:e.voice===manifest.name?source.name:e.voice}));
    return player;
  }));
  const good=result.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw result[0].reason;return good;
}
async function episodeCards(html,page){
  const episodes=[];
  for(const node of await select(html,'.video-item')){
    const body=inner(node),episodePage=absolute(await attribute(body,'.vi-img','href'),page);
    const label=await text(body,'.vi-title'),numbers=label.match(/\d+/g)||[];
    const season=Number(numbers[0]),episode=Number(numbers[1]);
    if(!episodePage||!season||!episode)continue;
    episodes.push({name:await text(body,'.vi-rate')||label,season,episode,url:episodeUrl(page,{season,episode,episodePage}),posterUrl:await poster(body,'.img-resp-h img',page),dubStatus:'dubbed'});
  }return episodes;
}
async function episodePages(html,page){
  const episodes=await episodeCards(html,page);const pages=[];
  for(const node of await select(html,'.pagination a','href')){
    const url=absolute(node.attr,page),n=Number(url.match(/[?&]page=(\d+)/)?.[1]||clean(node.text));
    if(n>1&&n<=100&&origin(url)===origin(page))pages.push({n,url});
  }
  const count=Math.min(100,Math.max(1,...pages.map(p=>p.n)));
  for(let n=2;n<=count;n++){
    const url=pages.find(p=>p.n===n)?.url||page.split('?')[0]+'?page='+n;
    episodes.push(...await episodeCards(await request(url),page));
  }
  return unique(episodes,e=>e.season+'|'+e.episode).sort((a,b)=>a.season-b.season||a.episode-b.episode);
}
export async function load(input,cb){return answer(cb,async()=>{
  const url=input.split('#')[0],html=await request(url),title=clean((await text(html,'.fright h1')).replace(/дивитись онлайн/gi,''));
  if(!title)throw new ProviderError('PARSE_ERROR','Сторінка UAFlix не містить назви.');
  const item={title,url,posterUrl:await poster(html,'.img-box img',url),type:contentType(url),description:await text(html,'#fdesc'),tags:[],actors:[],recommendations:[],trailers:[],headers:headers()};
  const score=Number((await text(html,'.mediablock .rat-imdb')).match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',','.'));if(score>0&&score<=10)item.score=score;
  for(const node of await select(html,'.fcols4 .finfo li')){
    const body=inner(node),label=clean(node.text);
    if(label.startsWith('Жанр:'))item.tags=(await select(body,'span[itemprop="genre"], a')).map(n=>clean(n.text));
    else if(label.startsWith('В ролях:'))item.actors=(await select(body,'span[itemprop="actor"]')).map(n=>({name:clean(n.text)}));
    else if(label.startsWith('Рік виходу:')){const year=Number(await text(body,'.year'));if(year)item.year=year;}
    else if(label.startsWith('Країна:'))item.description=label+'\n'+item.description;
    if(/^(Рік виходу:|Ориг. назва:)/.test(label)&&label.includes(' / '))item.contentRating=label.split(' / ').pop();
  }
  const trailer=absolute(await attribute(html,'.to-trailer','data-src')||await attribute(html,'.to-trailer [data-src]','data-src')||await attribute(html,'.to-trailer iframe','src')||await attribute(html,'.to-trailer a','href'),url);
  if(trailer)item.trailers.push({url:trailer});
  if(item.type==='series'){
    item.episodes=(await playerUrls(html,url)).length?episodesFromPlayers(await players(html,url),url):await episodePages(html,url);
    if(!item.episodes.length)throw new ProviderError('NO_EPISODES','UAFlix не повернув серії для цього сезону.');
  }
  return item;
});}
export async function loadStreams(input,cb){return answer(cb,async()=>{
  const page=input.split('#')[0],target=episodeTarget(input);
  const episodePage=target?.episodePage?absolute(target.episodePage,page):page;
  if(origin(episodePage)!==origin(page))throw new ProviderError('INVALID_EPISODE','Некоректна сторінка серії.');
  const sources=await players(await request(episodePage),episodePage);
  if(target?.episodePage){
    // The selected episode page can mix direct voice tracks and full playlists.
    // Keep truly unscoped tracks and exact episode matches independently; never
    // fall back to unrelated numbered entries when this episode is unavailable.
    const numberMatches=(value,key,wanted)=>wanted!==undefined&&(key!==undefined?key===`n:${Number(wanted)}`:Number(value)===Number(wanted));
    const selected=sources.map(player=>({...player,entries:player.entries.filter(entry=>{
      const unscoped=entry.season===undefined&&entry.episode===undefined&&entry.seasonKey===undefined&&entry.episodeKey===undefined;
      const exact=target.episodeKey!==undefined
        ? entry.seasonKey===target.seasonKey&&entry.episodeKey===target.episodeKey
        : numberMatches(entry.season,entry.seasonKey,target.season)&&numberMatches(entry.episode,entry.episodeKey,target.episode);
      return unscoped||exact;
    })}));
    return streamsFromPlayers(selected);
  }
  return streamsFromPlayers(sources,target);
});}
