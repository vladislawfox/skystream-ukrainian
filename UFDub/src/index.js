// SPDX-License-Identifier: GPL-3.0-only
// Port of UFDubProvider at cloudstream-extensions-uk dea43efe. See NOTICE.
import {base,clean,inner,unique,absolute,headers,ProviderError,answer,request,select,text,attribute,poster,episodeUrl,episodeTarget} from '../../shared/core.js';
const sections=[['Фільми','/film/'],['Серіали','/serial/'],['Дорами','/dorama/'],['Мультфільми','/cartoon/'],['Мультсеріали','/cartoon-serial/']];
async function cards(html,home=false){
  const items=[],nodes=await select(html,home?'.section, .short':'.short','class');
  for(let index=0;index<nodes.length;index++){
    const node=nodes[index];
    // Skip the section's descendant nodes in document order, exactly as the
    // upstream removes .section, without hiding matching cards in the catalog.
    if(home&&/(?:^|\s)section(?:\s|$)/.test(node.attr)){
      index+=(await select(inner(node),'.section, .short')).length;continue;
    }
    const body=inner(node),title=await text(body,'.short-t'),url=absolute(await attribute(body,'.short-t','href'));
    if(title&&url)items.push({title,url,posterUrl:await poster(body,'.img-box img'),type:/\/(film|cartoon)\//.test(url)?'movie':'series',headers:headers()});
  }return unique(items,i=>i.url);
}
export async function getHome(cb){return answer(cb,async()=>{
  const results=await Promise.allSettled(sections.map(async([name,path])=>{
    const items=await cards(await request(base()+path+'page/1'),true);
    if(!items.length)throw new ProviderError('PARSE_ERROR',`Не знайдено каталогу «${name}».`);return [name,items];
  }));
  const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw results[0].reason;return Object.fromEntries(good);
});}
export async function search(query,cb){return answer(cb,async()=>{
  if(!clean(query))return [];
  const html=await request(base()+'/index.php?do=search',{...headers(),'Content-Type':'application/x-www-form-urlencoded'},'do=search&subaction=search&story='+encodeURIComponent(query.trim()));
  const items=await cards(html);if(!items.length&&!/search|пошук|результат|не знайдено/i.test(html))throw new ProviderError('PARSE_ERROR','Не вдалося розпізнати пошук UFDub.');return items;
});}
async function page(url){
  const html=await request(url),title=await text(html,'h1.top-title');
  if(!title)throw new ProviderError('PARSE_ERROR','Не знайдено назву матеріалу UFDub.');
  const player=absolute(await attribute(html,'input[value*="video.ufdub.com"]','value'),url);
  if(!player)throw new ProviderError('NO_STREAMS','UFDub не повернув основний плеєр.');
  return {html,title,player};
}
async function videos(player,pageUrl){
  const html=await request(player,headers(pageUrl)),script=(await select(html,'script')).map(n=>inner(n)||n.text).join('\n').replace(/\\\//g,'/'),entries=[];
  for(const match of script.matchAll(/https?:\/\/ufdub\.com\/video\/VIDEOS\.php\?[^'"<>]+/gi)){
    const url=absolute(match[0].replace(/\s/g,c=>encodeURIComponent(c))),raw=url.match(/[?&]Seriya=([^&]*)/i)?.[1]||'';
    let name;try{name=decodeURIComponent(raw.replace(/\+/g,' '));}catch{name=raw;}
    if(/трейлер|trailer/i.test(name))continue;
    const season=Number(name.match(/(?:сезон\s*(\d+)|(\d+)\s*сезон)/i)?.slice(1).find(Boolean)||1);
    const episode=Number(name.match(/(?:серія\s*(\d+)|(\d+)\s*серія)/i)?.slice(1).find(Boolean)||name.match(/\d+/)?.[0]||entries.length+1);
    if(url)entries.push({url,name:name||'Відео',key:raw||'main',season,episode});
  }
  if(!entries.length)throw new ProviderError('NO_EPISODES','UFDub не повернув список відео.');
  return unique(entries,e=>e.key);
}
export async function load(input,cb){return answer(cb,async()=>{
  const url=absolute(input.split('#')[0]),{html,title,player}=await page(url),entries=await videos(player,url),tags=[];
  for(const node of await select(html,'.full-desc .full-info .fi-col-item'))if((await text(inner(node),'span'))==='Жанр:')tags.push(...(await select(inner(node),'a')).map(n=>clean(n.text)));
  const type=tags.some(t=>t==='Фільми'||t==='Мультфільми')?'movie':'series';
  const item={title,url,type,posterUrl:await poster(html,'.f-poster img',url),description:await text(html,'.full-text p'),tags,cast:[],trailers:[],recommendations:[],headers:headers()};
  const year=Number((await text(html,'.full-desc')).match(/Рік(?: випуску(?: аніме)?)?:?\s*((?:19|20)\d{2})/i)?.[1]);if(year)item.year=year;
  for(const node of await select(html,'.rel','href')){
    const body=inner(node),href=absolute(node.attr,url),name=await attribute(body,'.img-box img','alt');
    if(href&&name)item.recommendations.push({title:name,url:href,posterUrl:await poster(body,'.img-box img',url),type:'series',headers:headers()});
  }
  if(type==='series')item.episodes=entries.map(e=>({name:e.name,season:e.season,episode:e.episode,url:episodeUrl(url,{key:e.key}),dubStatus:'dubbed'})).sort((a,b)=>a.season-b.season||a.episode-b.episode);
  return item;
});}
export async function loadStreams(input,cb){return answer(cb,async()=>{
  const url=absolute(input.split('#')[0]),target=episodeTarget(input),{player}=await page(url),entries=await videos(player,url);
  if(target&&typeof target.key!=='string')throw new ProviderError('INVALID_EPISODE','Некоректне посилання серії UFDub.');
  const selected=target?entries.filter(e=>e.key===target.key):entries;
  if(!selected.length)throw new ProviderError('NO_STREAMS','Вибране відео UFDub більше не доступне.');
  // Let the native media player follow the public redirect. Fetching it through
  // http_get would buffer the complete video merely to learn the final URL.
  return selected.map(e=>({url:e.url,source:'UFDub · '+e.name,providerName:manifest.name,headers:headers(player),subtitles:[]}));
});}
