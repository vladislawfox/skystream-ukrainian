// SPDX-License-Identifier: GPL-3.0-only
// Port of CikavaIdeyaProvider/CikavaParsing at upstream dea43efe. See NOTICE.
import {base,clean,inner,unique,absolute,headers,ProviderError,answer,request,select,text,attribute,poster,episodeUrl,episodeTarget} from '../../shared/core.js';
import {jsonValueAt,loadPlayer,streamsFromPlayers} from '../../shared/playerjs.js';
const sections=[['Фільми','/filmy/'],['Серіали','/serialy/'],['Мультсеріали','/cartoon/'],['Артхаус','/arthaus/']];
const removedText=value=>/Озвучення ставимо на пауз|Видалено на прохання правовласника/i.test(value);
async function deleted(html,wholePage=false){return /ВИДАЛЕНО/i.test(await text(html,'.fquality'))||removedText(wholePage?await text(html,'.fquality, .fmessage'):await text(html,'*'));}
async function cards(html,css='.th-item'){
  const items=[];
  for(const node of await select(html,css)){
    const body=inner(node);if(await deleted(body))continue;
    const title=await text(body,'.th-title'),url=absolute(await attribute(body,'.th-in','href'));
    if(title&&url)items.push({title,url,posterUrl:await poster(body,'.img-fit img'),type:/\/(serialy|cartoon)\//.test(url)?'series':'movie',headers:headers()});
  }return unique(items,i=>i.url);
}
export async function getHome(cb){return answer(cb,async()=>{
  const results=await Promise.allSettled(sections.map(async([name,path])=>{
    const items=await cards(await request(base()+path+'page/1'));
    if(!items.length)throw new ProviderError('PARSE_ERROR',`Не знайдено каталогу «${name}».`);
    return [name,items];
  }));
  const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw results[0].reason;return Object.fromEntries(good);
});}
export async function search(query,cb){return answer(cb,async()=>{
  if(!clean(query))return [];
  const html=await request(base(),{...headers(),'Content-Type':'application/x-www-form-urlencoded'},'do=search&subaction=search&story='+encodeURIComponent(query.trim()));
  const items=await cards(html);
  if(!items.length&&!(await select(html,'.th-item')).length&&!/search|пошук|результат|не знайдено/i.test(html))throw new ProviderError('PARSE_ERROR','Не вдалося розпізнати пошук Цікава Ідея.');
  return items;
});}
async function page(url){
  const html=await request(url);
  if(await deleted(html,true))throw new ProviderError('CONTENT_UNAVAILABLE','Матеріал видалено або озвучення призупинено.');
  const title=await text(html,'.full h1');if(!title)throw new ProviderError('PARSE_ERROR','Не знайдено назву матеріалу Цікава Ідея.');
  let players={};
  for(const node of await select(html,'script')){
    const script=inner(node)||node.text,match=/switches\s*=\s*Object\s*\(\s*/.exec(script);
    if(match){try{players=JSON.parse(jsonValueAt(script,match.index+match[0].length));}catch{}break;}
  }
  const main=players.Player1,entries=[];
  if(typeof main==='string' && absolute(main,url))entries.push({url:absolute(main,url)});
  else if(main&&typeof main==='object')for(const seasonKey of Object.keys(main)){
    const season=main[seasonKey];if(!season||typeof season!=='object')continue;
    for(const episodeKey of Object.keys(season))if(typeof season[episodeKey]==='string'&&absolute(season[episodeKey],url))entries.push({url:absolute(season[episodeKey],url),seasonKey,episodeKey,season:Number(seasonKey.match(/\d+/)?.[0]||1),episode:Number(episodeKey.match(/\d+/)?.[0]||entries.length+1)});
  }
  if(!entries.length)throw new ProviderError('NO_STREAMS','Цікава Ідея не повернула основний Player1.');
  return {html,title,entries};
}
export async function load(input,cb){return answer(cb,async()=>{
  const url=absolute(input.split('#')[0]),{html,title,entries}=await page(url),info=await select(html,'.flist li');
  const tags=(await select(inner(info[2]),'a')).map(n=>clean(n.text));
  const item={title,url,type:tags.some(t=>t==='Фільми'||t==='Артхаус')?'movie':'series',posterUrl:await poster(html,'.img-fit img',url),description:await text(html,'.fdesc'),tags,cast:[],trailers:[],recommendations:await cards(html,'.th-rel'),headers:headers()};
  const year=Number(clean(info[0]?.text).match(/\b(18|19|20|21)\d{2}\b/)?.[0]);if(year)item.year=year;
  const banner=absolute(await attribute(html,'.fx-row','data-img'),url);if(banner)item.backgroundPosterUrl=banner;
  const rating=Number((await text(html,'.likes')).replace(/[^\d.,]/g,'').replace(',','.'));if(rating>0&&rating<=10)item.score=rating;
  const tabs=await select(html,'.tabs-sel span'),boxes=await select(html,'.tabs-b.video-box');
  const idx=tabs.findIndex(n=>/трейлер/i.test(n.text));
  if(idx>=0&&boxes[idx]){
    const body=inner(boxes[idx]),raw=await attribute(body,'iframe, video, source','src')||await attribute(body,'iframe, video, source','data-src');
    const trailer=absolute(raw,url);if(trailer)item.trailers.push({url:trailer});
  }
  if(item.type==='series'){
    item.episodes=entries.filter(e=>e.episodeKey).map(e=>({name:e.episodeKey,season:e.season,episode:e.episode,url:episodeUrl(url,{seasonKey:e.seasonKey,episodeKey:e.episodeKey}),dubStatus:'dubbed'})).sort((a,b)=>a.season-b.season||a.episode-b.episode);
    if(!item.episodes.length)throw new ProviderError('NO_EPISODES','Цікава Ідея не повернула список серій.');
  }
  return item;
});}
export async function loadStreams(input,cb){return answer(cb,async()=>{
  const url=absolute(input.split('#')[0]),target=episodeTarget(input),{entries}=await page(url);
  if(target&&(typeof target.seasonKey!=='string'||typeof target.episodeKey!=='string'))throw new ProviderError('INVALID_EPISODE','Некоректне посилання серії Цікава Ідея.');
  const selected=target?entries.filter(e=>e.seasonKey===target.seasonKey&&e.episodeKey===target.episodeKey):entries.filter(e=>!e.episodeKey);
  if(!selected.length)throw new ProviderError('NO_STREAMS','Для вибраного матеріалу немає основного плеєра.');
  return streamsFromPlayers(await Promise.all(selected.map(e=>loadPlayer(e.url,url))));
});}
