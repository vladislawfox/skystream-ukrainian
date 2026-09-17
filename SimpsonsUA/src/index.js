// SPDX-License-Identifier: GPL-3.0-only
// Port of SimpsonsUATvProvider at upstream dea43efe. See NOTICE.
import {base,clean,inner,origin,unique,absolute,headers,ProviderError,answer,request,select,text,attribute} from '../../shared/core.js';
import {loadPlayer,streamsFromPlayers} from '../../shared/playerjs.js';

const titles={simpsony:'Сімпсони',allfuturama:'Футурама','family-guy':'Гріфіни','pivdennyi-park':'Південний Парк',riksanchez:'Рік та Морті','solar-opposites':'Сонячні протилежності',rozcharuvannya:'Розчарування',duncanville:'Дунканвілл',nevkolupnyi:'Невразливий','central-park':'Центральний Парк',sponge:'Губка Боб Квадратні Штани','american-dad':'Американський тато',clevelandshow:'Шоу Клівленда',brickleberry:'Бріклбері','pd-paradise':'Поліція Парадайз',polus:'Полюс',bojack:'Кінь BoДжек','tuca-and-bertie':'Тука і Bertie','big-mouth':'Великий рот','gravity-falls':'Ґравіті Фолз',amfibiya:'Амфібія','owl-house':'Совиний Дім','hotel-hazbin':'Готель Хазбін','pekelniy-bos':'Пекельний бос',gilda:'Гільда','final-space':'Космічний рубіж','adventure-time':'Час пригод','star-proty-syl-zla':'Зоряна принцеса проти сил зла','opivnichne-evangelie':'Опівнічне Євангеліє','infinity-train':'Нескінченний поїзд','my-little-pony':'My Little Pony','maylo-merfi':'Закон Майла Мерфі','fineas-ferb':'Фінеас і Ферб','rockos-modern-life':'Сучасне рок-життя Рокко','invader-zim':'Загарвник Зім'};
const sectionNames={inshe:'Цікавинки',dobirky:'Добірки',halloween:'Гелловін',rizdvo:'Різдво',majbutnye:'Майбутнє','main-simpsons-episodes':'Головні серії',lito:'Літо',pereyizd:'Переїзд',podoroz:'Подорожі',shkola:'Школа',love:'Кохання',lgbt:'ЛГБТ',patrik:'Патрік','simpsony-u-kino':'У кіно','tracey-ullman-show':'Tracey Ullman Show'};
const ignored=/\/multserialy-ukrainskoyu\/?(?:[?#]|$)|\/terms\.html|\/subscribe\.html|\/index\.php|do=login|t\.me\/|youtube\.com|youtu\.be|tiktok\.com|x\.com\/|\/blog\/|franecki\.net|franeski\.net|javascript:/i;
const slug=url=>url.split(/[?#]/)[0].replace(/\/+$/,'').split('/').pop()||'';
const capitalize=value=>value.split(' ').map(s=>s?s[0].toUpperCase()+s.slice(1):'').join(' ');
const fallback=url=>{const name=slug(url).replace(/\.[^.]*$/,'').replace(/^\d+[-_]/,'');return titles[name]||capitalize(name.replace(/-/g,' '));};
const titleClean=value=>clean(value).replace(/дивитися онлайн.*|українською.*/i,'').trim();
const seasonNumber=url=>Number(url.match(/sezon-(\d+)/)?.[1]||0);
const episodeNumber=(url,fallbackNumber)=>Number(url.match(/(\d+)-seriya/)?.[1]||fallbackNumber);
function contentUrl(raw,parent=base()+'/'){
  if(!raw||!(/^(https?:|\/)/i.test(raw))||ignored.test(raw))return '';
  const url=absolute(raw,parent);
  // Catalog traversal stays on the configured source and cannot follow ads.
  return origin(url)===origin(base())?url:'';
}
async function image(html,parent){return absolute(await attribute(html,'img','data-src')||await attribute(html,'img','data-lazy-src')||await attribute(html,'img','src'),parent);}
async function legacyCards(html,css,parent=base()+'/'){
  const items=[];
  // parse_html exposes selected inner HTML, but not previousSibling. Preserve
  // the upstream's immediately preceding title comment as an inert text span.
  html=html.replace(/<!--((?:(?!-->)[\s\S])*)-->\s*(<div\b[^>]*\bclass=["'][^"']*\bmovie_item\b[^"']*["'][^>]*>)/gi,(_,comment,opening)=>opening+'<span data-simpsons-title="true">'+comment.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</span>');
  for(const node of await select(html,css)){
    const body=inner(node),url=contentUrl(await attribute(body,'a','href'),parent);
    if(url)items.push({title:await text(body,'[data-simpsons-title]')||fallback(url),url,posterUrl:await image(body,parent),type:'series',headers:headers()});
  }return unique(items,i=>i.url);
}
export async function getHome(cb){return answer(cb,async()=>{
  const results=await Promise.allSettled([
    (async()=>{
      const html=await request(base()+'/'),items=[];
      for(const node of (await select(html,'div.su-updates-grid a.su-card','href')).slice(0,15)){
        const body=inner(node),url=contentUrl(node.attr);if(!url)continue;
        const title=[await text(body,'.su-card-show'),await text(body,'.su-card-name')].filter(Boolean).join(' — ')||fallback(url);
        items.push({title,url,posterUrl:await image(body,base()+'/'),type:'series',headers:headers()});
      }
      if(!items.length)items.push(...(await legacyCards(html,'div.ep_slider div.movie_item')).slice(0,15));
      if(!items.length)throw new ProviderError('PARSE_ERROR','Не знайдено оновлень SimpsonsUA.');
      return ['Останні оновлення серій',unique(items,i=>i.url)];
    })(),
    (async()=>{
      const items=(await legacyCards(await request(base()+'/multserialy-ukrainskoyu/'),'#dle-content div.movie_item')).slice(0,20);
      if(!items.length)throw new ProviderError('PARSE_ERROR','Не знайдено каталогу SimpsonsUA.');return ['Список мультсеріалів',items];
    })(),
  ]);
  const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);if(!good.length)throw results[0].reason;return Object.fromEntries(good);
});}
export async function search(query,cb){return answer(cb,async()=>{
  if(!clean(query))return [];
  const html=await request(base()+'/?s='+encodeURIComponent(query.trim())),items=await legacyCards(html,'#dle-content div.movie_item');
  if(!items.length&&!/search|пошук|результат|не знайдено/i.test(html))throw new ProviderError('PARSE_ERROR','Не вдалося розпізнати пошук SimpsonsUA.');return items;
});}
async function episodeCards(html,pageUrl,season,section=''){
  const episodes=[];
  for(const node of await select(html,'#dle-content .movie_item')){
    const body=inner(node),url=contentUrl(await attribute(body,'a','href'),pageUrl);
    if(!url||(seasonNumber(url)>0&&!url.includes('-seriya')))continue;
    const episode=episodeNumber(url,episodes.length+1),name=titleClean(await text(body,'.descr.nazva')||await text(body,'.title, h2'))||`Серія ${episode}`;
    episodes.push({name:(section?'['+section+'] ':'')+name,url,season,episode,description:await text(body,'.descr:not(.nazva)'),posterUrl:await image(body,pageUrl),dubStatus:'dubbed'});
  }return episodes;
}
async function subItems(html,pageUrl){
  const items=[];
  for(const node of await select(html,'#dle-content .movie_item')){
    const body=inner(node),url=contentUrl(await attribute(body,'a','href'),pageUrl);
    if(url)items.push({url,posterUrl:await image(body,pageUrl)});
  }return unique(items,i=>i.url);
}
async function pageTitle(html){return titleClean(clean((await select(html,'.poster h2, .cat-nazva h1, h1'))[0]?.text)||await text(html,'title'));}
async function singleEpisode(url,html,season,episode,section='',cardPoster=''){
  const name=await pageTitle(html)||fallback(url);
  return {name:(section?'['+section+'] ':'')+name,url,season,episode,description:await text(html,'.fullstory, .sez-opys'),posterUrl:cardPoster||await image(inner((await select(html,'.poster, div.story'))[0]),url),dubStatus:'dubbed'};
}
export async function load(input,cb){return answer(cb,async()=>{
  const url=absolute(input.split('#')[0]),html=await request(url),title=await pageTitle(html);
  if(!title)throw new ProviderError('PARSE_ERROR','Не знайдено назву SimpsonsUA.');
  const item={title,url,type:'series',posterUrl:await image(inner((await select(html,'.movie_item, div.story, .poster'))[0]),url),description:await text(html,'.sez-opys, .fullstory, div.story'),tags:[],cast:[],trailers:[],recommendations:[],episodes:[],headers:headers()};
  const initial=await subItems(html,url),episodes=item.episodes;
  if(seasonNumber(url)&&initial.some(i=>i.url.includes('-seriya'))){episodes.push(...await episodeCards(html,url,seasonNumber(url)));return item;}
  // A visited set and finite catalog budget guard circular collections while
  // retaining all ordinary seasons (including the full Simpsons catalog).
  const visited=new Set([url]);let remaining=120,firstFailure;
  const fetchPage=async(href)=>{
    if(visited.has(href))return null;
    if(remaining--<=0)throw new ProviderError('CATALOG_LIMIT','Каталог завеликий. Відкрийте окремий сезон SimpsonsUA.');
    visited.add(href);
    try{return await request(href);}catch(error){firstFailure=firstFailure||error;return null;}
  };
  let specialSeason=101;
  for(const sub of initial.filter(i=>seasonNumber(i.url)>0&&!i.url.includes('-seriya')).sort((a,b)=>seasonNumber(a.url)-seasonNumber(b.url))){
    const child=await fetchPage(sub.url);if(child!==null)episodes.push(...await episodeCards(child,sub.url,seasonNumber(sub.url)));
  }
  // Direct episode pages are valid entries even when a collection lacks a
  // dedicated season page; preserve their real season and episode numbers.
  for(const sub of initial.filter(i=>i.url.includes('-seriya'))){
    const episode=episodeNumber(sub.url,episodes.length+1),season=seasonNumber(sub.url)||1;
    const card=(await episodeCards(html,url,season)).find(e=>e.url===sub.url);
    if(card)episodes.push({...card,episode});
  }
  const movies=initial.filter(i=>/\.html(?:[?#]|$)/.test(i.url)&&!seasonNumber(i.url)&&!i.url.includes('-seriya'));
  if(movies.length){const season=specialSeason++;for(const sub of movies){const child=await fetchPage(sub.url);if(child!==null)episodes.push(await singleEpisode(sub.url,child,season,episodes.filter(e=>e.season===season).length+1,'',sub.posterUrl));}}
  const collectSpecial=async(sectionUrl,sectionLabel,season,depth=0)=>{
    if(depth>8)throw new ProviderError('CATALOG_LIMIT','Забагато вкладених добірок SimpsonsUA.');
    const child=await fetchPage(sectionUrl);if(child===null)return;
    const subs=await subItems(child,sectionUrl);
    if(subs.some(i=>i.url.includes('-seriya'))){episodes.push(...await episodeCards(child,sectionUrl,season,sectionLabel));return;}
    for(const sub of subs){
      if(/\.html(?:[?#]|$)/.test(sub.url)){
        const detail=await fetchPage(sub.url);if(detail!==null)episodes.push(await singleEpisode(sub.url,detail,season,episodes.filter(e=>e.season===season).length+1,sectionLabel,sub.posterUrl));
      }else await collectSpecial(sub.url,sectionNames[slug(sub.url)]||fallback(sub.url),season,depth+1);
    }
  };
  for(const sub of initial.filter(i=>!seasonNumber(i.url)&&!/\.html(?:[?#]|$)/.test(i.url)))await collectSpecial(sub.url,sectionNames[slug(sub.url)]||fallback(sub.url),specialSeason++);
  item.episodes=unique(episodes,e=>e.url);
  if(!item.episodes.length){
    if(firstFailure)throw firstFailure;
    if(initial.length)throw new ProviderError('NO_EPISODES','Каталог SimpsonsUA не повернув доступних серій.');
    const frames=await framesFromPage(html,url);
    if(!frames.length)throw new ProviderError('NO_EPISODES','SimpsonsUA не повернув серій або основного плеєра.');
    item.episodes.push(await singleEpisode(url,html,seasonNumber(url)||1,episodeNumber(url,1)));
  }
  return item;
});}
async function framesFromPage(html,url){
  const sources=await select(html,'iframe','src'),labels=await select(html,'iframe','data-player'),lazy=await select(html,'iframe','data-src');
  return unique(sources.map((n,i)=>({url:absolute(n.attr||lazy[i]?.attr,url),voice:clean(labels[i]?.attr)})).filter(p=>p.url&&!/youtube\.com|youtu\.be/i.test(p.url)&&(p.voice||/tortuga\.(tw|wtf)/i.test(p.url))),p=>p.url+'|'+p.voice);
}
export async function loadStreams(input,cb){return answer(cb,async()=>{
  const url=absolute(input.split('#')[0]),frames=await framesFromPage(await request(url),url);
  if(!frames.length)throw new ProviderError('NO_STREAMS','SimpsonsUA не повернув підтримуваний основний плеєр.');
  const results=await Promise.allSettled(frames.map(async frame=>{
    const player=await loadPlayer(frame.url,url);
    for(const entry of player.entries)entry.voice=frame.voice||entry.voice;
    return player;
  }));
  const players=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
  if(!players.length)throw results[0].reason;
  return streamsFromPlayers(players);
});}
