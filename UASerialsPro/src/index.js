// SPDX-License-Identifier: GPL-3.0-only
// Port of CloudStream Ukrainian UASerialsProProvider at dea43efe. See NOTICE.
import CryptoJS from 'crypto-js/core.js';
import AES from 'crypto-js/aes.js';
import PBKDF2 from 'crypto-js/pbkdf2.js';
import 'crypto-js/sha512.js';
import NoPadding from 'crypto-js/pad-nopadding.js';
import {base,clean,inner,unique,absolute,headers,ProviderError,answer,request,select,text,attribute,poster,episodeTarget} from '../../shared/core.js';
import {loadPlayer,episodesFromPlayers,streamsFromPlayers} from '../../shared/playerjs.js';
const sections=[['Фільми','/films/'],['Серіали','/series/'],['Мультфільми','/fcartoon/'],['Мультсеріали','/cartoons/'],['Ексклюзив','/exclusive/']];
const contentType=(url,tags=[])=>tags.some(t=>/^Фільм$|^Мультфільм$/i.test(t))?'movie':/\/(series|cartoons)\//i.test(url)||tags.some(t=>/Серіал|Мультсеріал/.test(t))?'series':'movie';
async function cards(html,search=false){
  const items=[];
  for(const node of await select(html,search?'.uas-card':'.short-item','href')){
    const body=inner(node),url=absolute(node.attr||await attribute(body,'.short-img','href'));
    const title=await text(body,search?'.uas-card__title':'.th-title');
    if(url&&title)items.push({title,url,posterUrl:await poster(body,search?'.uas-card__img':'.img-fit img'),type:contentType(url),headers:headers()});
  }return unique(items,e=>e.url);
}
export async function getHome(cb){return answer(cb,async()=>{
  const results=await Promise.allSettled(sections.map(async([name,path])=>{
    const items=(await cards(await request(base()+path))).map(item=>({...item,...(path==='/series/'||path==='/cartoons/'?{type:'series'}:{})}));if(!items.length)throw new ProviderError('PARSE_ERROR',`Не знайдено каталогу «${name}».`);return [name,items];
  }));const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw results[0].reason;return Object.fromEntries(good);
});}
export async function search(query,cb){return answer(cb,async()=>{
  if(!clean(query))return [];
  const html=await request(base()+'/search/'+encodeURIComponent(query.trim())+'/'),items=await cards(html,true);
  if(!items.length&&!/search|пошук|результат|не знайдено/i.test(html))throw new ProviderError('PARSE_ERROR','Не вдалося розпізнати пошук UASerialsPro.');return items;
});}
async function tabs(html,page){
  const raw=await attribute(html,'div.fplayer player-control','data-tag1');
  if(!raw)throw new ProviderError('NO_STREAMS','UASerialsPro не повернув дані основного плеєра.');
  try{
    // Public player-tab serialization, matching the upstream site's published JS.
    // Fixed supplied salt and IV avoid the library's native/random APIs entirely.
    const data=JSON.parse(raw);
    if(!/^[a-f\d]+$/i.test(data.salt)||data.salt.length%2||!/^[a-f\d]{32}$/i.test(data.iv)||typeof data.ciphertext!=='string')throw Error('cipher data');
    const key=PBKDF2('297796CCB81D255125',CryptoJS.enc.Hex.parse(data.salt),{keySize:8,iterations:999,hasher:CryptoJS.algo.SHA512});
    let decoded=AES.decrypt({ciphertext:CryptoJS.enc.Base64.parse(data.ciphertext)},key,{iv:CryptoJS.enc.Hex.parse(data.iv),padding:NoPadding}).toString(CryptoJS.enc.Utf8).replace(/[\x00-\x20]+$/,'');
    let parsed;
    try{parsed=JSON.parse(decoded);}catch{decoded=decoded.slice(0,decoded.lastIndexOf(']')+1);try{parsed=JSON.parse(decoded);}catch{parsed=JSON.parse(decoded.replace(/\\"/g,'"'));}}
    if(typeof parsed==='string')parsed=JSON.parse(parsed);if(!Array.isArray(parsed))throw Error('tabs');
    return parsed.map(t=>({name:clean(t.tabName),url:absolute(t.url,page)})).filter(t=>t.url);
  }catch{throw new ProviderError('PARSE_ERROR','Не вдалося декодувати вкладки UASerialsPro. Формат плеєра міг змінитися.');}
}
async function players(playerTabs,page,translation=''){
  const candidates=playerTabs.filter(t=>!/трейлер|trailer/i.test(t.name)&&!/youtube\.com|youtu\.be/i.test(t.url));
  candidates.sort((a,b)=>Number(b.name==='Плеєр')-Number(a.name==='Плеєр'));
  let failure;
  for(const tab of candidates){try{
    const player=await loadPlayer(tab.url,page);
    if(translation)player.entries=player.entries.map(e=>({...e,voice:e.voice===manifest.name?translation:e.voice}));
    return [player];
  }catch(error){failure=error;}}
  throw failure||new ProviderError('NO_STREAMS','UASerialsPro не повернув доступного основного плеєра.');
}
async function metadata(html,url){
  const title=await text(html,'.short-title');if(!title)throw new ProviderError('PARSE_ERROR','Сторінка UASerialsPro не містить назви.');
  const item={title,url,posterUrl:await poster(html,'div.fimg.img-wide img',url),description:await text(html,'.full-text'),tags:[],actors:[],recommendations:await cards(html),trailers:[],headers:headers()};
  let translation='';
  for(const node of await select(html,'.short-list li')){
    const body=inner(node),label=clean(node.text),links=(await select(body,'a')).map(n=>clean(n.text));
    if(label.startsWith('Жанр'))item.tags=links;
    else if(label.startsWith('Актори'))item.actors=links.map(name=>({name}));
    else if(label.startsWith('Країна'))item.description=label+'\n'+item.description;
    else if(label.startsWith('Переклад'))translation=await text(body,'span[data-popup]');
  }
  const year=Number(await text(html,'.short-list a[href*="/year/"]'));if(year)item.year=year;
  const score=Number((await text(html,'.short-rate-in')).match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',','.'));if(score>0&&score<=10)item.score=score;
  const rating=await text(html,'.short-agerating span');if(rating)item.contentRating=rating;
  item.type=contentType(url,item.tags);return {item,translation};
}
async function trailers(html,playerTabs,page){
  let urls=playerTabs.filter(t=>/трейлер|trailer/i.test(t.name)).map(t=>t.url);
  if(!urls.length){
    for(const attr of ['src','data-src','href'])for(const node of await select(html,'[id*="trailer"] iframe, [class*="trailer"] iframe, [id*="trailer"] a, [class*="trailer"] a',attr)){
      const url=absolute(node.attr,page);if(url)urls.push(url);
    }
  }
  const result=[];
  for(const url of unique(urls,x=>x)){
    if(/tortuga\.(tw|wtf)\/vod/i.test(url)){try{const player=await loadPlayer(url,page);if(player.entries[0])result.push({url:player.entries[0].url});}catch{}}
    else result.push({url});
  }return result;
}
export async function load(input,cb){return answer(cb,async()=>{
  const url=input.split('#')[0],html=await request(url),{item,translation}=await metadata(html,url),playerTabs=await tabs(html,url);
  item.trailers=await trailers(html,playerTabs,url);
  const sources=await players(playerTabs,url,translation),episodes=episodesFromPlayers(sources,url);
  if(episodes.length){item.type='series';item.episodes=episodes;}
  else if(item.type==='series')throw new ProviderError('NO_EPISODES','UASerialsPro не повернув список серій.');
  return item;
});}
export async function loadStreams(input,cb){return answer(cb,async()=>{
  const page=input.split('#')[0],target=episodeTarget(input),html=await request(page),{translation}=await metadata(html,page);
  return streamsFromPlayers(await players(await tabs(html,page),page,translation),target);
});}
