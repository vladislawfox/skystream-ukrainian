import test from 'node:test';
import assert from 'node:assert/strict';
import {bundle, runtime} from './runtime.mjs';

const root = 'https://mirror.test';
const movie = root + '/42-film.html';
const series = root + '/43-series.html';
const frame = 'https://cinema.test/embed/42/public-signature';
const card = `<article class="article--short"><h2 class="article__title"><a href="/43-series.html">Тест (1-2 сезон)</a></h2><a class="article__poster"><img data-src="/poster.jpg" src="/dot.gif"></a><a href="/serialy/">Сериалы</a></article>`;
const desktopCard = `<div class="shortstory"><div class="shortstory__title"><a href="/42-film.html"><h2>Фільм (2008)</h2></a></div><div class="shortstory__poster"><img data-src="//img.test/film.jpg"></div></div>`;
function detail(isSeries = false) {
  return `<article><h1 class="article__title">Тест &amp; друзі (${isSeries?'1-2 сезон':'2008'})</h1><div class="article__poster"><img src="/poster.jpg"></div><div class="article__info-year"><a>2008</a></div><div class="article__info-imdb"><b>ИМДб:</b>7.8</div><div class="article__text">Опис.</div><div class="article__info-genre"><a href="/${isSeries?'serialy':'filmy'}/">Драма</a></div><div class="js-player-container"><iframe data-src="${frame}"></iframe><button class="js-player-trailer" data-src="https://www.youtube.com/embed/trailer"></button></div></article>`;
}
const voice = (id, title = 'Дубляж') => ({id,title,data:'opaque-' + id,file:'#'});
const playlist = () => [
  {id:'s02',title:'Сезон 2',folder:[{id:'s02e01',title:'Серия 1',folder:[voice('2-1')]}]},
  {id:'s01',title:'Сезон 1',folder:[
    {id:'s01e10',title:'Серия 10',folder:[voice('1-10')]},
    {id:'s01e01',title:'Серия 1',folder:[voice('1-1-a'),voice('1-1-b','<img src="/flags/us.png"> English')]},
  ]},
];
// Inverse of the public Cinemar #2 rotation, with two independently padded chunks.
function encoded(data) {
  const raw = Buffer.from(JSON.stringify(data)).toString('base64').replace(/=+$/,'');
  return '#235' + [raw.slice(0,48),raw.slice(48)].map((chunk,i)=>{
    const n=i+2;
    return chunk.slice(-n)+'x'.repeat(n)+chunk.slice(0,-n)+'y'.repeat(n)+n;
  }).join('#');
}
const player = data => `<script>Cinemar(${JSON.stringify({file:encoded(data)})})</script>`;
const hls = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080\n1080/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720/index.m3u8';
async function provider(request) { return runtime(await bundle('Kinogo'),request,root,{name:'Kinogo',baseUrl:root}); }
function network(data, overrides = {}) {
  return ({url,method,body}) => {
    if (overrides[url]) return overrides[url];
    if(url===movie) return detail();
    if(url===series) return detail(true);
    if(url===frame) return player(data);
    if(method==='POST') return JSON.stringify({file:`https://cdn.test/${JSON.parse(body)}/master.m3u8`,subtitle:'[English]/sub/en.vtt'});
    if(url.startsWith('https://cdn.test/')) return hls;
    return card+desktopCard;
  };
}

test('Kinogo parses mobile/desktop catalogs, mirror paths and encoded search',async()=>{
  const r=await provider(()=>card+desktopCard+card);
  const home=await r.call('getHome');
  assert.equal(home.success,true,home.message);
  assert.deepEqual(Object.keys(home.data),['Фільми','Серіали','Мультфільми']);
  const result=await r.call('search','Тест & друзі');
  assert.deepEqual(result.data.map(x=>[x.title,x.type]),[['Тест','series'],['Фільм','movie']]);
  assert.equal(result.data[0].posterUrl,root+'/poster.jpg');
  assert.equal(result.data[1].posterUrl,'https://img.test/film.jpg');
  assert.equal(r.calls.at(-1).url,root+'/search/'+encodeURIComponent('Тест & друзі'));
  assert.ok(r.calls.every(x=>!x.url.includes('anime')));
});
test('Kinogo movie details do not request media; metadata and trailer survive',async()=>{
  const r=await provider(network([]));
  const result=await r.call('load',movie);
  assert.equal(result.success,true,result.message);
  assert.equal(result.data.title,'Тест & друзі');
  assert.equal(result.data.type,'movie');
  assert.equal(result.data.year,2008);
  assert.equal(result.data.score,7.8);
  assert.equal(result.data.description,'Опис.');
  assert.equal(result.data.trailers[0].url,'https://www.youtube.com/embed/trailer');
  assert.equal(r.calls.length,1);
});
test('Kinogo decodes Cinemar without eval and sorts stable season/episode IDs',async()=>{
  const r=await provider(network(playlist()));
  const result=await r.call('load',series);
  assert.equal(result.success,true,result.message);
  assert.deepEqual(result.data.episodes.map(e=>[e.season,e.episode]),[[1,1],[1,10],[2,1]]);
  assert.ok(result.data.episodes.every(e=>!decodeURIComponent(e.url).includes('opaque')));
  assert.equal(r.calls.find(x=>x.url===frame).headers.Referer,series);
  assert.ok(r.calls.every(x=>x.method==='GET'));
});
test('Kinogo finds the player outside article after malformed mobile markup is repaired',async()=>{
  const html=detail(true).replace('<div class="js-player-container">','</article><div class="js-player-container">');
  const r=await provider(network(playlist(),{[series]:html}));
  const result=await r.call('load',series);
  assert.equal(result.success,true,result.message);
  assert.equal(result.data.episodes.length,3);
});
test('Kinogo refreshes the exact episode voices and preserves HLS qualities/subtitles',async()=>{
  let fresh=false;
  const r=await provider(req=>network(playlist(),{[frame]:player(fresh?playlist().map(s=>({...s,folder:s.folder.map(e=>({...e,folder:e.folder.map(v=>({...v,data:v.data+'-fresh'}))}))})):playlist())})(req));
  const episode=(await r.call('load',series)).data.episodes[0];
  fresh=true;
  const result=await r.call('loadStreams',episode.url);
  assert.equal(result.success,true,result.message);
  assert.deepEqual(r.calls.filter(x=>x.method==='POST').map(x=>JSON.parse(x.body)),['opaque-1-1-a-fresh','opaque-1-1-b-fresh']);
  assert.equal(result.data.length,6);
  assert.ok(result.data.some(x=>x.source==='English · 1080p'));
  assert.ok(result.data.every(x=>x.headers.Referer==='https://cinema.test/'));
  assert.equal(result.data[0].subtitles[0].url,'https://cinema.test/sub/en.vtt');
  assert.equal(r.calls.filter(x=>x.url===series).length,2);
});
test('Kinogo movie voices stay movies and one failed voice does not hide the others',async()=>{
  const request=network([voice('a'),voice('b','Original')]);
  const r=await provider(req=>req.body==='"opaque-a"'?JSON.stringify({success:false,error:'not available'}):request(req));
  const result=await r.call('loadStreams',movie);
  assert.equal(result.success,true,result.message);
  assert.ok(result.data.every(x=>x.url.includes('opaque-b')));
});
test('Kinogo rejects a series without an exact episode and missing episode numbers',async()=>{
  const r=await provider(network(playlist()));
  for(const url of [series,series+'#uk='+encodeURIComponent(JSON.stringify({v:1,season:1,episode:9}))]) {
    const result=await r.call('loadStreams',url);
    assert.equal(result.success,false);
    assert.match(result.errorCode,/INVALID_EPISODE|NO_STREAMS/);
  }
  assert.ok(r.calls.every(x=>x.method==='GET'));
});
test('Kinogo gives explicit failures for blocked/changed pages and broken player data',async()=>{
  for(const [html,method,url,code] of [
    ['<title>Just a moment...</title>','search','Test','CLOUDFLARE_BLOCKED'],
    ['<h1>New layout</h1>','search','Test','PARSE_ERROR'],
    [detail(true),'load',series,'PARSE_ERROR'],
  ]) {
    const r=await provider(()=>html);
    const result=await r.call(method,url);
    assert.equal(result.success,false);
    assert.equal(result.errorCode,code);
  }
});
test('Kinogo accepts genuine empty search, rejects HTML/error URLs as media',async()=>{
  const empty=await provider(()=>'<form class="js-ls-form"></form><div>Ничего не найдено</div>');
  assert.deepEqual((await empty.call('search','unknown')).data,[]);
  for(const file of ['#','https://cdn.test/error.html','javascript:alert(1)','']) {
    const req=network([voice('a')]);
    const r=await provider(x=>x.method==='POST'?JSON.stringify({file}):req(x));
    const result=await r.call('loadStreams',movie);
    assert.equal(result.success,false);
    assert.equal(result.errorCode,'NO_STREAMS');
  }
});
