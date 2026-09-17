// SPDX-License-Identifier: GPL-3.0-only
// Port of KlonTVProvider at cloudstream-extensions-uk dea43efe. See NOTICE.
import {base, clean, inner, unique, absolute, headers, ProviderError, answer, request, select, text, attribute, poster, episodeTarget} from '../../shared/core.js';
import {loadPlayer, episodesFromPlayers, streamsFromPlayers} from '../../shared/playerjs.js';

const sections = [['Фільми','/filmy/'],['Серіали','/serialy/'],['Мультфільми','/multfilmy/'],['Мультсеріали','/multserialy/']];
const typeOf = (url, tags=[]) => /\/(serialy|multserialy)\//.test(url) || tags.some(t=>/^(Серіали|Мультсеріали)$/.test(t)) ? 'series' : 'movie';
async function cards(html, css='.short-news__slide-item', section='') {
  const items=[];
  for(const node of await select(html,css)) {
    const body=inner(node), label=await text(body,'.subscribe-label-module');
    if(section==='Мультфільми' && /Мультсеріал|Аніме/i.test(label))continue;
    const title=clean((await select(body,'.card-link__style, .text-module__main'))[0]?.text);
    const url=absolute(await attribute(body,'.card-link__style, .text-module__main','href'));
    if(title && url)items.push({title,url,posterUrl:await poster(body,'.card-poster__img, .cover-image, .owl-carousel .owl-item img'),type:typeOf(url),headers:headers()});
  }
  return unique(items,i=>i.url);
}
export async function getHome(cb) {
  return answer(cb,async()=>{
    const results=await Promise.allSettled(sections.map(async([name,path])=>{
      const items=await cards(await request(base()+path+'page/1'),undefined,name);
      if(!items.length)throw new ProviderError('PARSE_ERROR',`Не знайдено каталогу «${name}».`);
      return [name,items];
    }));
    const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    if(!good.length)throw results[0].reason;
    return Object.fromEntries(good);
  });
}
export async function search(query,cb) {
  return answer(cb,async()=>{
    if(!clean(query))return [];
    const html=await request(base(),{...headers(),'Content-Type':'application/x-www-form-urlencoded'},'do=search&subaction=search&story='+encodeURIComponent(query.trim()));
    const result=await cards(html);
    if(!result.length && !/search|пошук|результат|не знайдено/i.test(html))throw new ProviderError('PARSE_ERROR','Не вдалося розпізнати пошук KlonTV.');
    return result;
  });
}
async function page(url) {
  const html=await request(url);
  let json={};
  const raw=inner((await select(html,'script[type="application/ld+json"]'))[0]);
  if(raw.trim().startsWith('{'))try {json=JSON.parse(raw);}catch{}
  const title=clean(typeof json.name==='string'?json.name:'') || await text(html,'.seo-h1__position');
  if(!title)throw new ProviderError('PARSE_ERROR','Не знайдено назву матеріалу KlonTV.');
  const player=absolute(await attribute(html,'div.film-player iframe','data-src') || await attribute(html,'div.film-player iframe','src'),url);
  if(!player)throw new ProviderError('NO_STREAMS','KlonTV не повернув основний плеєр.');
  const item={title,url,posterUrl:absolute(typeof json.image==='string'?json.image:'',url)||await poster(html,'.card-poster__img, .cover-image, .owl-carousel .owl-item img',url),description:await text(html,'.info-clamp__hid'),tags:[],cast:[],trailers:[],recommendations:await cards(html,'.related-news__small-card'),headers:headers()};
  for(const node of await select(html,'.table-info__item')) {
    const body=inner(node), label=await text(body,'.table__category');
    if(label==='Рік:') { const year=Number(await text(body,'a')); if(year>=1800&&year<=2200)item.year=year; }
    if(label==='Жанр:')item.tags=(await select(body,'a')).map(a=>clean(a.text));
    if(label==='Країна:')item.description='Країна: '+clean(node.text).replace(/^Країна:\s*/,'')+'.\n'+item.description;
  }
  item.type=/\/serial\//.test(player)?'series':typeOf(url,item.tags);
  const rating=Number(json.aggregateRating?.ratingValue);
  if(rating>0&&rating<=10)item.score=rating;
  if(Array.isArray(json.actor))item.cast=json.actor.filter(a=>a&&a.name).map(a=>({name:clean(a.name)}));
  const age=await text(html,'.info-title__age-icon');if(age)item.contentRating=age;
  return {item,player};
}
export async function load(input,cb) {
  return answer(cb,async()=>{
    const url=absolute(input.split('#')[0]), {item,player}=await page(url);
    if(item.type==='series') {
      item.episodes=episodesFromPlayers([await loadPlayer(player,url)],url);
      if(!item.episodes.length)throw new ProviderError('NO_EPISODES','Плеєр KlonTV не повернув список серій.');
    }
    return item;
  });
}
export async function loadStreams(input,cb) {
  return answer(cb,async()=>{
    const target=episodeTarget(input), url=absolute(input.split('#')[0]), {item,player}=await page(url);
    if(target && !(typeof target.seasonKey==='string'&&typeof target.episodeKey==='string') && (!Number.isInteger(target.season)||!Number.isInteger(target.episode)))throw new ProviderError('INVALID_EPISODE','Некоректне посилання серії KlonTV.');
    return streamsFromPlayers([await loadPlayer(item.type==='movie'?player.replace('?multivoice',''):player,url)],target);
  });
}
