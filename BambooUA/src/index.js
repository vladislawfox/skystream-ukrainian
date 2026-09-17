// SPDX-License-Identifier: GPL-3.0-only
// Port of CloudStream Ukrainian BambooUAProvider; see NOTICE.
import {base,clean,inner,absolute,headers,ProviderError,answer,request,select,text,attribute,poster,unique,episodeTarget} from '../../shared/core.js';
import {scriptValues,flattenPlaylist,episodesFromPlayers,streamsFromPlayers} from '../../shared/playerjs.js';
const sections=[['Фільми','cinema'],['Дорами','dorama'],['Лакорн','lakorn'],['Озвучення','voice'],['ТВ-шоу','tv-show'],['Завершені','done'],['Світ ЛГБТ','world-bl'],['Поточні','now']];
async function cards(html){const items=[];for(const node of await select(html,'article.swiper-slide')){const body=inner(node),url=absolute(await attribute(body,'a.link-title','href')),title=await text(body,'h2.label-3');if(title&&url&&!/\/anime\//i.test(url))items.push({title,url,posterUrl:await poster(body,'div.poster img'),type:/\/cinema\//.test(url)?'movie':'series',headers:headers()});}return unique(items,e=>e.url);}
export async function getHome(cb){return answer(cb,async()=>{const results=await Promise.allSettled(sections.map(async([title,path])=>{const items=await cards(await request(`${base()}/${path}/page/1/`));if(!items.length)throw new ProviderError('PARSE_ERROR','Каталог джерела порожній.');return [title,items];}));const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw results[0].reason;return Object.fromEntries(good);});}
export async function search(query,cb){return answer(cb,async()=>clean(query)?cards(await request(base()+'/',{...headers(),'Content-Type':'application/x-www-form-urlencoded'},'do=search&subaction=search&story='+encodeURIComponent(query.trim()))):[]);}
async function page(input){const url=absolute(input.split('#')[0]),html=await request(url);let info={};for(const n of await select(html,'script[type="application/ld+json"]')){try{const json=JSON.parse(inner(n)||n.text);const graph=json['@graph']||[json];info=graph.find(x=>x.name&&x.description)||graph.find(x=>x.name)||info;}catch{}}
const title=clean(info.name)||await text(html,'h1');if(!title)throw new ProviderError('PARSE_ERROR','Не знайдено назву матеріалу.');
const tags=(await select(html,'span.full_cat a')).map(n=>clean(n.text));let data;
const scripts=(await select(html,'script')).flatMap(n=>scriptValues(inner(n)||n.text,'playlist'));
for(const v of scripts){try{data=JSON.parse(v);break;}catch{}}
if(!data)throw new ProviderError('NO_STREAMS','Сторінка не містить плейлиста.');
const movie=tags.includes('Кіно')||/\/cinema\//.test(url);
const player={url,entries:flattenPlaylist(data,url,{forceSeries:!movie})};player.isSeries=!movie;
const item={title,url,type:movie?'movie':'series',posterUrl:absolute(await attribute(html,'meta[property="og:image"]','content'))||await poster(html,'div.poster img'),description:clean(info.description),tags,headers:headers(),recommendations:await cards(html)};
const year=Number(await text(html,'.trending-info .text-detail span.badge-danger'));if(year>1800&&year<2200)item.year=year;
if(!movie){item.episodes=episodesFromPlayers([player],url);if(!item.episodes.length)throw new ProviderError('NO_EPISODES','Не знайдено серій.');}
const tabs=await select(html,'.player-footer_tabs a[href]','href');const trailerTab=tabs.find(n=>/трейлер/i.test(n.text));
if(trailerTab?.attr?.startsWith('#')&&/^[\w-]+$/.test(trailerTab.attr.slice(1))){const section=(await select(html,trailerTab.attr))[0];if(section){const raw=await attribute(inner(section),'iframe,video,source','src')||await attribute(inner(section),'a','href');const trailer=absolute(raw,url);if(trailer)item.trailers=[{url:trailer}];}}
return {item,player};}
export async function load(url,cb){return answer(cb,async()=>(await page(url)).item);}
export async function loadStreams(url,cb){return answer(cb,async()=>{const {player}=await page(url);return streamsFromPlayers([player],episodeTarget(url));});}
