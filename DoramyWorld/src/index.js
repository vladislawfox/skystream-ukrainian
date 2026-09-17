// SPDX-License-Identifier: GPL-3.0-only
// Port of CloudStream Ukrainian DoramyWorldProvider; see NOTICE.
import {base,clean,inner,absolute,headers,ProviderError,answer,request,select,text,attribute,poster,unique,episodeTarget} from '../../shared/core.js';
import {loadPlayer,episodesFromPlayers,streamsFromPlayers} from '../../shared/playerjs.js';
const cardSelector='article.type-dorama, article.type-film, article.type-show';
async function cards(html){const items=[];for(const n of await select(html,cardSelector)){const b=inner(n),url=absolute(await attribute(b,'h3.post-title a','href')),title=await text(b,'h3.post-title a span')||await text(b,'h3.post-title a');if(title&&url)items.push({title,url,posterUrl:await poster(b),type:url.includes('/film/')?'movie':'series',headers:headers()});}return unique(items,e=>e.url);}
export async function getHome(cb){return answer(cb,async()=>{const results=await Promise.allSettled([['Фільми','film'],['Дорами','dorama'],['Розважальні шоу','show']].map(async([title,path])=>{const items=await cards(await request(`${base()}/${path}/page/1/`));if(!items.length)throw new ProviderError('PARSE_ERROR','Каталог джерела порожній.');return [title,items];}));const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw results[0].reason;return Object.fromEntries(good);});}
export async function search(query,cb){return answer(cb,async()=>clean(query)?cards(await request(base()+'/?s='+encodeURIComponent(query.trim()))):[]);}
async function page(input){const url=absolute(input.split('#')[0]),html=await request(url),title=(await text(html,'h1.project-title')).split('/')[0].trim();if(!title)throw new ProviderError('PARSE_ERROR','Не знайдено назву матеріалу.');
const movie=url.includes('/film/');
let player;
const embedded=await attribute(html,'[data-player]','data-player');
if(embedded){
  let groups;try{groups=JSON.parse(embedded);}catch{throw new ProviderError('PARSE_ERROR','Некоректний список серій.');}
  const entries=[];const titleSeason=Number((title+' '+url).match(/(\d+)[ -]*(?:сезон|sezon)/i)?.[1])||1;
  for(const group of Array.isArray(groups)?groups:[]){for(const [si,season] of (group.seasons||[]).entries()){
    const number=Number(String(season.label||'').match(/\d+/)?.[0])||(group.seasons.length===1?titleSeason:si+1);
    for(const [ei,frame] of (season.episodes||[]).entries()){
      const frameUrl=absolute(typeof frame==='string'?frame:frame.url,url);if(!frameUrl)continue;
      entries.push({url:frameUrl,player:frameUrl,frame:true,voice:group.label||'DoramyWorld',...(movie?{}:{season:number,episode:ei+1,episodeName:`Серія ${ei+1}`})});
    }
  }}
  player={url,entries,isSeries:!movie};
}else{
  const raw=await attribute(html,'iframe[src*="ashdi"]','src');if(!raw)throw new ProviderError('NO_STREAMS','Сайт не повернув підтримуваного плеєра.');
  player=await loadPlayer(absolute(raw,url),base()+'/');
}
const item={title,url,type:movie?'movie':'series',posterUrl:absolute(await attribute(html,'meta[property="og:image"]','content'),url),description:await text(html,'div.about-text-holder p'),tags:(await select(html,'a[href*="/genre/"]')).map(n=>clean(n.text)),recommendations:await cards(html),headers:headers()};
const yearRow=(await select(html,'li.item')).find(n=>/Рік/.test(n.text));const year=Number(yearRow?.text?.match(/\b(19|20)\d{2}\b/)?.[0]);if(year)item.year=year;
if(!movie){item.episodes=episodesFromPlayers([player],url);if(!item.episodes.length)throw new ProviderError('NO_EPISODES','Не знайдено серій.');}return {item,player};}
export async function load(url,cb){return answer(cb,async()=>(await page(url)).item);}
export async function loadStreams(url,cb){return answer(cb,async()=>{const {player}=await page(url);const target=episodeTarget(url);
if(player.entries.some(e=>e.frame)){
  const frames=player.entries.filter(e=>!target||(e.season===target.season&&e.episode===target.episode));
  const loaded=await Promise.allSettled(frames.map(async frame=>{const loaded=await loadPlayer(frame.url,base()+'/');return {...loaded,entries:loaded.entries.map(e=>({...e,voice:frame.voice}))};}));
  const good=loaded.filter(r=>r.status==='fulfilled').map(r=>r.value);
  if(!good.length)throw loaded.find(r=>r.status==='rejected')?.reason||new ProviderError('NO_STREAMS','Серія недоступна.');
  return streamsFromPlayers(good);
}
return streamsFromPlayers([player],target);});}
