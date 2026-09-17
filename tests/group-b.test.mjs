import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { runtime } from './runtime.mjs';

async function provider(name, request, baseUrl = 'https://mirror.test') {
  const source = new URL(`../${name}/src/index.js`, import.meta.url).pathname;
  const result = await build({ entryPoints: [source], bundle: true, format: 'iife', globalName: 'PluginModule', platform: 'neutral', target: 'es2020', write: false, footer: { js: 'Object.assign(globalThis, PluginModule);' } });
  const manifest = JSON.parse(await readFile(new URL(`../${name}/plugin.json`, import.meta.url)));
  return runtime(result.outputFiles[0].text, request, baseUrl, manifest);
}
const root = 'https://mirror.test';
const media = '<script>new Playerjs({file:"https://cdn.test/main.m3u8",subtitle:"[Українська]https://cdn.test/uk.vtt"})</script>';
const hls = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\n720/index.m3u8';
const klonCard = (path, label = '', title = 'Назва') => `<div class="short-news__slide-item"><a class="card-link__style" href="${path}">${title}</a><img class="card-poster__img" data-src="//images.test/poster.jpg"><div class="subscribe-label-module">${label}</div></div>`;
const klonDetail = (genre = 'Серіали', json = '{broken}') => `<script type="application/ld+json">${json}</script><h1 class="seo-h1__position">Серіал</h1><img class="cover-image" data-src="/poster.jpg"><div class="info-clamp__hid">Опис.</div><div class="table-info__item"><span class="table__category">Жанр:</span><a>${genre}</a></div><div class="table-info__item"><span class="table__category">Рік:</span><a>2024</a></div><div class="film-player"><iframe data-src="https://player.test/serial/test"></iframe></div>`;
const klonPlaylist = `<script>new Playerjs({file:'${JSON.stringify(['Студія А', 'Студія Б'].map((title, i) => ({title, folder:[{title:'Сезон 2', folder:[{title:'Серія 1',file:`https://cdn.test/${i}/one.m3u8`,subtitle:'[Українська]https://cdn.test/uk.vtt'},{title:'Серія 10',file:`https://cdn.test/${i}/ten.m3u8`}]}]})))}'})</script>`;

test('KlonTV home resolves mirror URLs, omits anime section and filters cartoon-series cards', async () => {
  const r = await provider('KlonTV', () => klonCard('/filmy/1.html') + klonCard('/multserialy/2.html', 'Мультсеріал') + klonCard('/anime/3.html', 'Аніме'));
  const result = await r.call('getHome');
  assert.equal(result.success, true);
  assert.equal(result.data['Мультфільми'].length, 1);
  assert.equal(result.data['Фільми'][0].url, root + '/filmy/1.html');
  assert.equal(result.data['Фільми'][0].posterUrl, 'https://images.test/poster.jpg');
  assert.ok(!r.calls.some(c => c.url.includes('/anime/')));
});
test('KlonTV malformed JSON-LD falls back to HTML, deduplicating voice episodes', async () => {
  const r = await provider('KlonTV', ({url}) => url.startsWith(root) ? klonDetail() : klonPlaylist);
  const result = await r.call('load', root + '/serialy/1.html');
  assert.equal(result.success, true);
  assert.equal(result.data.title, 'Серіал');
  assert.equal(result.data.year, 2024);
  assert.deepEqual(result.data.episodes.map(e => [e.season,e.episode]), [[2,1],[2,10]]);
  assert.ok(result.data.episodes.every(e => e.url.startsWith(root + '/serialy/1.html#') && !decodeURIComponent(e.url).includes('cdn.test')));
});
test('KlonTV catalog selects the first title when both upstream title selectors match',async()=>{
  const r=await provider('KlonTV',()=>'<div class="short-news__slide-item"><a class="card-link__style" href="/filmy/1.html">Друзі</a><span class="text-module__main">Друзі</span></div>');
  const result=await r.call('search','Друзі');
  assert.equal(result.data[0].title,'Друзі');
});
test('KlonTV fresh episode resolution preserves both voices and excludes episode ten', async () => {
  const r = await provider('KlonTV', ({url}) => url.startsWith(root) ? klonDetail() : url.startsWith('https://player.test') ? klonPlaylist : hls);
  const {data} = await r.call('load', root + '/serialy/1.html');
  const streams = await r.call('loadStreams', data.episodes[0].url);
  assert.equal(streams.success, true);
  assert.ok(streams.data.some(s => s.source.includes('Студія А')));
  assert.ok(streams.data.some(s => s.source.includes('Студія Б')));
  assert.ok(streams.data.every(s => !s.url.includes('/ten.')));
  assert.ok(streams.data.every(s => s.subtitles[0].lang === 'uk'));
  assert.equal(r.calls.filter(c => c.url === root + '/serialy/1.html').length, 2);
});

const cikCard = (title, marker = '') => `<div class="th-item"><a class="th-in" href="/filmy/${title}.html"><span class="th-title">${title}</span><div class="img-fit"><img src="/poster.jpg"></div><span class="fquality">${marker}</span></a></div>`;
const cikDetail = (players, genre = 'Серіали') => `<div class="full"><h1>Цікавий серіал</h1></div><div class="img-fit"><img src="/p.jpg"></div><ul class="flist"><li>Рік: 2025</li><li>Україна</li><li><a>${genre}</a></li></ul><div class="fdesc">Опис.</div><div class="tabs-sel"><span>Плеєр</span><span>Трейлер</span></div><div class="tabs-b video-box"><iframe src="https://player.test/movie"></iframe></div><div class="tabs-b video-box"><iframe data-src="//www.youtube.com/embed/trailer"></iframe></div><script>var switches = Object(${JSON.stringify(players)});</script>`;
test('CikavaIdeya search drops deleted and paused material and encodes Unicode once', async () => {
  const r = await provider('CikavaIdeya', () => cikCard('Живий') + cikCard('Прибраний','ВИДАЛЕНО') + cikCard('Озвучення ставимо на паузу'));
  const result = await r.call('search','Дюна + друзі');
  assert.equal(result.success,true);
  assert.deepEqual(result.data.map(x => x.title),['Живий']);
  assert.equal(new URLSearchParams(r.calls[0].body).get('story'),'Дюна + друзі');
});
test('CikavaIdeya seasonal switches use stable names and refresh player URLs at playback', async () => {
  let suffix = 'old';
  const r = await provider('CikavaIdeya', ({url}) => url.startsWith(root) ? cikDetail({Player1:{'2 сезон':{'1 серія':`https://player.test/${suffix}`,'10 серія':'https://player.test/ten'}}}) : url.startsWith('https://player.test') ? media : hls);
  const result = await r.call('load',root + '/serialy/1.html');
  assert.equal(result.success,true);
  assert.deepEqual(result.data.episodes.map(e=>[e.season,e.episode]),[[2,1],[2,10]]);
  assert.equal(result.data.year,2025);
  assert.deepEqual(result.data.trailers,[{url:'https://www.youtube.com/embed/trailer'}]);
  suffix='fresh';
  const streams=await r.call('loadStreams',result.data.episodes[0].url);
  assert.equal(streams.success,true);
  assert.ok(r.calls.some(c=>c.url==='https://player.test/fresh'));
  assert.ok(!r.calls.some(c=>c.url==='https://player.test/old'||c.url==='https://player.test/ten'));
});
test('CikavaIdeya refuses trailer-only and removed detail pages', async () => {
  const empty=await provider('CikavaIdeya',()=>cikDetail({Trailer:'https://www.youtube.com/embed/trailer'}));
  assert.equal((await empty.call('load',root+'/1.html')).errorCode,'NO_STREAMS');
  const removed=await provider('CikavaIdeya',()=>cikDetail({Player1:'https://player.test/movie'},'Фільми')+'<div class="fmessage">Видалено на прохання правовласника</div>');
  assert.equal((await removed.call('load',root+'/1.html')).errorCode,'CONTENT_UNAVAILABLE');
});

const ufCard = (name) => `<div class="short"><a class="short-t" href="/serial/${name}.html">${name}</a><div class="img-box"><img src="/p.jpg"></div></div>`;
const ufDetail = '<h1 class="top-title">Серіал UF</h1><div class="f-poster"><img src="/p.jpg"></div><div class="full-desc"><div class="full-info"><div class="fi-col-item"><span>Жанр:</span><a>Серіали</a></div></div></div><div class="full-text"><p>Опис.</p></div><input value="https://video.ufdub.com/player">';
const ufPlayer = `<script>var videos=['https://ufdub.com/video/VIDEOS.php?id=7&Seriya=1%20серія','https://ufdub.com/video/VIDEOS.php?id=7&Seriya=10%20серія','https://ufdub.com/video/VIDEOS.php?id=7&Seriya=%D0%A2%D1%80%D0%B5%D0%B9%D0%BB%D0%B5%D1%80'];</script>`;
test('UFDub excludes sidebar section cards and omits anime home while retaining dramas', async () => {
  const r=await provider('UFDub',()=>'<div class="section">'+ufCard('Sidebar')+'</div>'+ufCard('Основний'));
  const result=await r.call('getHome');
  assert.equal(result.success,true);
  assert.deepEqual(result.data['Фільми'].map(x=>x.title),['Основний']);
  assert.ok(result.data['Дорами']);
  assert.ok(!r.calls.some(c=>c.url.includes('/anime/')));
});
test('UFDub keeps a main catalog card even when the same title also appears in a sidebar',async()=>{
  const r=await provider('UFDub',()=>'<div class="section">'+ufCard('Повтор')+'</div>'+ufCard('Повтор'));
  const result=await r.call('getHome');
  assert.equal(result.success,true);
  assert.equal(result.data['Серіали'][0].title,'Повтор');
});
test('UFDub retains redirect endpoints for playback and never returns trailer episodes', async () => {
  const r=await provider('UFDub',({url})=>url.startsWith(root)?ufDetail:ufPlayer);
  const result=await r.call('load',root+'/serial/7.html');
  assert.equal(result.success,true);
  assert.deepEqual(result.data.episodes.map(e=>e.episode),[1,10]);
  assert.ok(result.data.episodes.every(e=>e.url.startsWith(root+'/serial/7.html#')));
  const streams=await r.call('loadStreams',result.data.episodes[0].url);
  assert.equal(streams.success,true);
  assert.equal(streams.data[0].url,'https://ufdub.com/video/VIDEOS.php?id=7&Seriya=1%20серія');
  assert.equal(streams.data[0].providerName,'UFDub');
});
test('UFDub literal spaces and punctuation remain in complete redirect query and distinct episodes',async()=>{
  const player=`<script>var a=[['Серія 1 — Готуємо книги!','mp4','https://ufdub.com/video/VIDEOS.php?ID=423&TAB=Основа&Seriya=Серія 1 — Готуємо книги!&POS=2'],['Серія 2','mp4','https://ufdub.com/video/VIDEOS.php?ID=423&TAB=Основа&Seriya=Серія 2&POS=3']];</script>`;
  const r=await provider('UFDub',({url})=>url.startsWith(root)?ufDetail:player);
  const result=await r.call('load',root+'/serial/423.html');
  assert.deepEqual(result.data.episodes.map(e=>[e.name,e.episode]),[['Серія 1 — Готуємо книги!',1],['Серія 2',2]]);
  const streams=await r.call('loadStreams',result.data.episodes[0].url);
  assert.equal(streams.data[0].url,'https://ufdub.com/video/VIDEOS.php?ID=423&TAB=Основа&Seriya=Серія%201%20—%20Готуємо%20книги!&POS=2');
});

const simCard=(href,name='Серія',extra='')=>`<div class="movie_item"><a href="${href}"><img data-lazy-src="/p.jpg"><span class="descr nazva">${name}</span><span class="descr">Опис серії.</span>${extra}</a></div>`;
test('SimpsonsUA modern updates keep Ukrainian labels and legacy catalog title mapping',async()=>{
  const r=await provider('SimpsonsUA',({url})=>url===root+'/'?'<div class="su-updates-grid"><a class="su-card" href="/simpsony/sezon-2/1-seriya.html"><span class="su-card-show">Сімпсони</span><span class="su-card-name">Друзі</span><img src="/ep.jpg"></a></div>':'<div id="dle-content">'+simCard('/allfuturama/')+simCard('/terms.html')+'</div>');
  const result=await r.call('getHome');
  assert.equal(result.success,true);
  assert.equal(result.data['Останні оновлення серій'][0].title,'Сімпсони — Друзі');
  assert.deepEqual(result.data['Список мультсеріалів'].map(x=>x.title),['Футурама']);
});
test('SimpsonsUA season pages preserve exact episode numbers and own descriptive names',async()=>{
  const r=await provider('SimpsonsUA',()=>'<h1>Сімпсони українською онлайн</h1><div id="dle-content">'+simCard('/simpsony/sezon-2/1-seriya.html','Початок')+simCard('/simpsony/sezon-2/10-seriya.html','Продовження')+'</div>');
  const result=await r.call('load',root+'/simpsony/sezon-2/');
  assert.equal(result.success,true);
  assert.equal(result.data.title,'Сімпсони');
  assert.deepEqual(result.data.episodes.map(e=>[e.season,e.episode,e.name]),[[2,1,'Початок'],[2,10,'Продовження']]);
  assert.equal(result.data.episodes[0].posterUrl,root+'/p.jpg');
});
test('SimpsonsUA legacy search uses immediately preceding Ukrainian title comments',async()=>{
  const r=await provider('SimpsonsUA',()=>'<div id="dle-content"><!-- Українська назва -->\n'+simCard('/some-show/')+'<!-- unrelated --> <h2>Розділ</h2>'+simCard('/allfuturama/')+'</div>');
  const result=await r.call('search','Українська');
  assert.deepEqual(result.data.map(i=>i.title),['Українська назва','Футурама']);
});
test('SimpsonsUA show loads ordered seasons, grouped specials, and bounds catalog cycles',async()=>{
  const r=await provider('SimpsonsUA',({url})=>{
    if(url===root+'/simpsony/')return '<h1>Сімпсони</h1><div id="dle-content">'+simCard('/simpsony/sezon-2/')+simCard('/simpsony/sezon-1/')+simCard('/simpsony/halloween/')+'</div>';
    if(url.endsWith('/halloween/'))return '<div id="dle-content">'+simCard('/simpsony/halloween/')+simCard('/special.html','Свято')+'</div>';
    if(url.endsWith('/special.html'))return '<h1>Свято</h1><iframe data-player="ashdi" src="https://player.test/movie"></iframe>';
    return '<div id="dle-content">'+simCard(url+'1-seriya.html','Серія 1')+'</div>';
  });
  const result=await r.call('load',root+'/simpsony/');
  assert.equal(result.success,true);
  assert.deepEqual(result.data.episodes.map(e=>e.season),[1,2,101]);
  assert.match(result.data.episodes[2].name,/Гелловін/);
  assert.ok(r.calls.length<=5);
});
test('SimpsonsUA retains voice names with either iframe attribute order and excludes trailers',async()=>{
  const r=await provider('SimpsonsUA',({url})=>url.startsWith(root)?'<h1>Епізод</h1><iframe src="//player.test/a" data-player="Студія А"></iframe><iframe data-player="Студія Б" src="https://player.test/b"></iframe><iframe src="https://www.youtube.com/embed/trailer"></iframe>':url.startsWith('https://player.test')?media.replace('/main.m3u8',url.endsWith('/a')?'/a.m3u8':'/b.m3u8'):hls);
  const result=await r.call('loadStreams',root+'/simpsony/sezon-2/1-seriya.html');
  assert.equal(result.success,true);
  assert.ok(result.data.some(s=>s.source.includes('Студія А')));
  assert.ok(result.data.some(s=>s.source.includes('Студія Б')));
  assert.ok(!r.calls.some(c=>c.url.includes('youtube')));
});
test('all Group B providers expose challenge failures instead of empty success',async()=>{
  for(const name of ['KlonTV','CikavaIdeya','UFDub','SimpsonsUA']){
    const r=await provider(name,()=>({status:403,body:'<title>Just a moment...</title><div id="cf-chl-widget">'}));
    const result=await r.call('load',root+'/detail.html');
    assert.equal(result.success,false,name);
    assert.equal(result.errorCode,'CLOUDFLARE_BLOCKED',name);
  }
});
