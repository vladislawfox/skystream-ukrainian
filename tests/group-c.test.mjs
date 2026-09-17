import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {pbkdf2Sync,createCipheriv} from 'node:crypto';
import {bundle,runtime} from './runtime.mjs';
const root='https://fixture.example';
const manifests={};
const harness=async (name,respond)=>{
  const code=await bundle(name);
  const m=manifests[name] ||= JSON.parse(await readFile(new URL(`../${name}/plugin.json`,import.meta.url)));
  return runtime(code,respond,root,m);
};
const missing=({url})=>{throw Error('Unexpected URL: '+url);};
const esc=s=>s.replaceAll('&','&amp;').replaceAll("'",'&#39;');
const playlist=(token='old')=>[{title:'Студія A',folder:[{title:'Сезон 10',folder:[{title:'Серія 12',file:`https://media.example/${token}.m3u8`,subtitle:'[Українська]https://media.example/a.vtt'},{title:'Серія 13',file:'https://media.example/wrong.m3u8'}]}]}];
const player=p=>`<script>new Playerjs({file:${JSON.stringify(JSON.stringify(p))}});</script>`;
const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720\n720/index.m3u8';
const flixDetail='<div class="fright"><h1>Фікстура дивитись онлайн</h1></div><div id="fdesc">Опис</div><div class="img-box"><img data-src="/poster.jpg"></div><div class="video-box"><iframe src="//player.example/serial/1"></iframe></div><div class="to-trailer" data-src="https://youtube.com/embed/trailer"></div>';
test('UAFlix native playlist selects full multi-digit season/episode and refreshes tokens',async()=>{
  let fresh=false;const rt=await harness('UAFlix',({url})=>url===root+'/serials/test.html'?flixDetail:url==='https://player.example/serial/1'?player(playlist(fresh?'new':'old')):url.endsWith('.m3u8')?master:missing({url}));
  const detail=await rt.call('load',root+'/serials/test.html');assert.equal(detail.success,true,JSON.stringify(detail));
  assert.equal(detail.data.title,'Фікстура');assert.equal(detail.data.episodes.length,2);
  assert.equal(detail.data.episodes[0].season,10);assert.equal(detail.data.episodes[0].episode,12);
  assert.equal(detail.data.trailers[0].url,'https://youtube.com/embed/trailer');
  assert.ok(!detail.data.episodes[0].url.includes('old'));fresh=true;
  const links=await rt.call('loadStreams',detail.data.episodes[0].url);assert.equal(links.success,true,JSON.stringify(links));
  assert.ok(links.data.some(x=>x.url==='https://media.example/new.m3u8'));assert.ok(!links.data.some(x=>/wrong|old/.test(x.url)));
  assert.equal(links.data[0].subtitles[0].lang,'uk');
});
test('UAFlix list seasons paginates episode pages and uses stable page targets',async()=>{
  const card=(s,e)=>`<div class="video-item"><a class="vi-img" href="/serials/show/${s}-${e}.html" alt="Серіал"><div class="img-resp-h"><img data-src="/still.jpg"></div></a><div class="vi-title">${s} сезон ${e} серія</div><div class="vi-rate">Назва ${e}</div></div>`;
  const page=root+'/serials/show/';const rt=await harness('UAFlix',({url})=>url===page?'<div class="fright"><h1>Серіал</h1></div>'+card(12,11)+'<ul class="pagination"><li><a href="?page=1">1</a></li><li><a href="?page=2">2</a></li></ul>':url===page+'?page=2'?card(12,12):url===root+'/serials/show/12-12.html'?flixDetail: url==='https://player.example/serial/1'?player([{title:'Озвучка',file:'https://media.example/exact.m3u8'}]):url.endsWith('.m3u8')?master:missing({url}));
  const detail=await rt.call('load',page);assert.equal(detail.success,true,JSON.stringify(detail));assert.deepEqual(detail.data.episodes.map(e=>[e.season,e.episode]),[[12,11],[12,12]]);
  const links=await rt.call('loadStreams',detail.data.episodes[1].url);assert.equal(links.success,true,JSON.stringify(links));assert.ok(links.data.some(x=>x.url.includes('/exact.')));
});
test('UAFlix direct category requests do not need implicit cookie sessions',async()=>{
  const card='<div class="video-item"><a class="vi-img" href="/film/test.html" alt="Назва"></a><div class="img-resp-h"><img src="/p.jpg"></div></div>';
  const rt=await harness('UAFlix',({url})=>url.includes('do=search')?'<a class="sres-wrap" href="/film/test.html"><div class="sres-img"><img alt="Назва" src="/p.jpg"></div></a>':card);const home=await rt.call('getHome');assert.equal(home.success,true);assert.ok(!Object.keys(home.data).some(x=>/аніме/i.test(x)));assert.equal(home.data['Фільми'][0].title,'Назва');assert.ok(rt.calls.every(x=>x.method==='GET'&&!x.headers.Cookie));
  const search=await rt.call('search','тест & ще');assert.equal(search.success,true);assert.ok(rt.calls.at(-1).url.includes(encodeURIComponent('тест & ще')));
});
function encryptedTabs(tabs){
  const salt=Buffer.from('0123456789abcdef','hex'),iv=Buffer.from('0123456789abcdef0123456789abcdef','hex');
  const cipher=createCipheriv('aes-256-cbc',pbkdf2Sync('297796CCB81D255125',salt,999,32,'sha512'),iv);
  return {ciphertext:Buffer.concat([cipher.update(JSON.stringify(tabs)),cipher.final()]).toString('base64'),salt:salt.toString('hex'),iv:iv.toString('hex'),iterations:999};
}
const uasDetail=tabs=>`<h1 class="short-title">Назва</h1><div class="short-list"><li>Жанр: <a>Серіал</a><a>Драма</a></li><li>Актори: <a>Актор</a></li><li>Рік: <a href="/year/2024/">2024</a></li><li>Переклад: <span data-popup>Студія</span></li></div><div class="fimg img-wide"><img src="/p.jpg"></div><div class="full-text">Опис</div><div class="fplayer"><player-control data-tag1='${esc(JSON.stringify(encryptedTabs(tabs)))}'></player-control></div>`;
test('UASerialsPro decrypts public AES tabs and refreshes selected episodes with separate voice tracks',async()=>{
  let fresh=false;const tabs=[{tabName:'Трейлер',url:'https://youtube.com/embed/trailer'},{tabName:'Плеєр',url:'https://player.example/serial/2'}];
  const episodes=()=>[{title:'Сезон 12',season:'12',folder:[{title:'Дванадцята',number:'12',file:`{Студія A}https://media.example/${fresh?'new':'old'}-a.m3u8(subtitle:[Українська]https://media.example/ua.vtt);{Студія B}https://media.example/${fresh?'new':'old'}-b.m3u8`},{title:'Інша',number:'13',file:'https://media.example/wrong.m3u8'}]}];
  const rt=await harness('UASerialsPro',({url})=>url===root+'/series/test.html'?uasDetail(tabs):url==='https://player.example/serial/2'?player(episodes()):url.endsWith('.m3u8')?master:missing({url}));
  const detail=await rt.call('load',root+'/series/test.html');assert.equal(detail.success,true,JSON.stringify(detail));assert.equal(detail.data.year,2024);assert.equal(detail.data.episodes[0].season,12);assert.equal(detail.data.episodes[0].episode,12);assert.equal(detail.data.trailers[0].url,tabs[0].url);fresh=true;
  const links=await rt.call('loadStreams',detail.data.episodes[0].url);assert.equal(links.success,true,JSON.stringify(links));assert.ok(links.data.some(x=>x.url.includes('new-a')));assert.ok(links.data.some(x=>x.url.includes('new-b')));assert.ok(links.data.every(x=>!x.url.includes('wrong')&&!x.url.includes('old')));assert.equal(links.data.find(x=>x.url.includes('new-a')).subtitles[0].lang,'uk');
});
test('UASerialsPro uses current search cards and encoded query',async()=>{
  const rt=await harness('UASerialsPro',()=>'<a class="uas-card" href="/films/one.html"><div class="uas-card__title">Назва</div><div class="uas-card__orig">Name</div><img class="uas-card__img" data-src="/p.jpg"></a>');const result=await rt.call('search','мій & тест');assert.equal(result.success,true);assert.equal(result.data[0].url,root+'/films/one.html');assert.equal(result.data[0].posterUrl,root+'/p.jpg');assert.equal(rt.calls[0].url,root+'/search/'+encodeURIComponent('мій & тест')+'/');
});
// Real Nuxt payloads store child values by index, including numeric values.
function nuxt(content){const values=[];function add(value){const index=values.length;values.push(null);values[index]=Array.isArray(value)?value.map(add):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,add(v)])):value;return index;}add({'content-fixture':{data:content}});return `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(values)}</script>`;}
const kinPage=(season,token='old')=>`<script type="application/ld+json">${JSON.stringify({name:'Серіал',alternateName:'Show',image:'/poster.jpg',description:'Опис',datePublished:'2024-01-01',genre:['Драма'],actor:[{actor:{name:'Актор'}}],aggregateRating:{ratingValue:'8.4'},trailer:{embedUrl:'https://youtube.com/embed/trailer'}})}</script>${nuxt({seasons:[{number:season,episodes:[{number:12,name:'Серія 12'}],frames:[{episodeNumber:12,url:'/frame.jpg'}],playerData:{12:{ashdi:[{name:'Студія A',link:`https://player.example/${season}/${token}`}],direct:[{name:'Студія B',link:`https://media.example/${season}-${token}.m3u8`}]}}}]})}`;
test('Kinostrain resolves indexed Nuxt payloads across seasons and refreshes exact selected source',async()=>{
  let fresh=false;const rt=await harness('Kinostrain',({url})=>url===root+'/show/season-10'?kinPage(10,fresh?'new':'old')+'<div class="seasons-grid"><a class="season-item" href="/show/season-10">10</a><a class="season-item" href="/show/season-12">12</a></div>':url===root+'/show/season-12'?kinPage(12,fresh?'new':'old'):url.startsWith('https://player.example/')?player([{file:`https://media.example/iframe-${url.split('/').slice(-2).join('-')}.m3u8`} ]):url.endsWith('.m3u8')?master:missing({url}));
  const detail=await rt.call('load',root+'/show/season-10');assert.equal(detail.success,true,JSON.stringify(detail));assert.deepEqual(detail.data.episodes.map(e=>e.season),[10,12]);assert.equal(detail.data.score,8.4);assert.equal(detail.data.episodes[1].posterUrl,root+'/frame.jpg');fresh=true;
  const links=await rt.call('loadStreams',detail.data.episodes[1].url);assert.equal(links.success,true,JSON.stringify(links));assert.ok(links.data.some(x=>x.url==='https://media.example/12-new.m3u8'));assert.ok(links.data.some(x=>x.url==='https://media.example/iframe-12-new.m3u8'));assert.ok(links.data.every(x=>!x.url.includes('old')&&!x.url.includes('10-')));
});
test('Kinostrain movie providers allow nested episode one and direct source groups',async()=>{
 for(const nested of [true,false]){const sources={direct:[{name:'Озвучка',link:'https://media.example/movie.m3u8'}]};const html='<script type="application/ld+json">{"name":"Фільм"}</script>'+nuxt({seasons:[{playerData:nested?{1:sources}:sources}]});const rt=await harness('Kinostrain',({url})=>url===root+'/movie-test'?html:master);const detail=await rt.call('load',root+'/movie-test');assert.equal(detail.success,true);assert.equal(detail.data.type,'movie');const links=await rt.call('loadStreams',root+'/movie-test');assert.equal(links.success,true);assert.ok(links.data.some(x=>x.url==='https://media.example/movie.m3u8'));}
});
test('Kinostrain search uses base-derived API origin and first ready season',async()=>{
 const rt=await harness('Kinostrain',()=>JSON.stringify({data:[{name:'Фільм',slug:'movie',type:'movie',posterUrl:'/p.jpg'},{name:'Серіал',slug:'show',type:'series',firstReadySeason:{number:12},posterUrl:'/p.jpg'}]}));const result=await rt.call('search','тест & ще');assert.equal(result.success,true);assert.deepEqual(result.data.map(x=>x.url),[root+'/movie-movie',root+'/show/season-12']);assert.equal(rt.calls[0].url,'https://api.fixture.example/api/search?q='+encodeURIComponent('тест & ще')+'&limit=10');
});
for(const name of ['UAFlix','UASerialsPro','Kinostrain'])test(`${name} reports challenge pages explicitly`,async()=>{const rt=await harness(name,()=>({status:403,body:'<title>Just a moment...</title><div id="cf-chl-test"></div>'}));const result=await rt.call('load',root+'/film/test');assert.equal(result.success,false);assert.equal(result.errorCode,'CLOUDFLARE_BLOCKED');});
test('UAFlix season-prefix labels preserve every episode rather than matching the adjacent season number',async()=>{
 const cards=[8,7,6].map(e=>`<div class="video-item"><a class="vi-img" href="/serials/show/season-04-episode-0${e}/"></a><div class="vi-title">Сезон 4 Серія ${e}</div></div>`).join('');const rt=await harness('UAFlix',()=>'<div class="fright"><h1>Серіал</h1></div>'+cards);const detail=await rt.call('load',root+'/serials/show/');assert.equal(detail.success,true);assert.deepEqual(detail.data.episodes.map(e=>[e.season,e.episode]),[[4,6],[4,7],[4,8]]);
});
test('UASerialsPro home category preserves series type on flat DLE detail URLs',async()=>{
 const html='<div class="short-item"><a class="short-img img-fit" href="/12722-nigli.html"><img data-src="/p.jpg"></a><div class="th-title">Серіал</div></div>';const rt=await harness('UASerialsPro',()=>html);const home=await rt.call('getHome');assert.equal(home.success,true);assert.equal(home.data['Серіали'][0].type,'series');assert.equal(home.data['Мультсеріали'][0].type,'series');assert.equal(home.data['Фільми'][0].type,'movie');
});
test('UAFlix player tabs name alternate sources and exclude non-YouTube trailers',async()=>{
 const html='<div class="fplayer"><div class="tabs-sel"><span class="tabs-link">Дивитись онлайн</span><span class="tabs-link">Плеєр #2 (субтитри)</span><span class="tabs-link">Трейлер</span></div>'+['main','alternate','trailer'].map(p=>`<div class="video-box"><iframe src="https://player.example/${p}"></iframe></div>`).join('')+'</div>';
 const rt=await harness('UAFlix',({url})=>url===root+'/films/test'?html:url.startsWith('https://player.example/')?player({file:'https://media.example/'+url.split('/').pop()+'.m3u8'}):master);
 const result=await rt.call('loadStreams',root+'/films/test');assert.equal(result.success,true);assert.ok(result.data.some(s=>s.source.includes('Плеєр #2')));assert.ok(!rt.calls.some(c=>c.url.includes('trailer')));
});
test('Kinostrain direct HLS sources retain the site referer',async()=>{
 const html=nuxt({seasons:[{playerData:{direct:[{name:'Озвучка',link:'https://media.example/movie.m3u8'}]}}]});const rt=await harness('Kinostrain',({url})=>url===root+'/movie-test'?html:master);const result=await rt.call('loadStreams',root+'/movie-test');assert.equal(result.success,true);assert.equal(result.data[0].headers.Referer,root+'/');
});
function separateEpisodeFixture({direct,episodes}){
 const page=root+'/serials/show/',episodePage=page+'season-12-episode-12/';
 const list='<div class="fright"><h1>Серіал</h1></div><div class="video-item"><a class="vi-img" href="'+episodePage+'"></a><div class="vi-title">Сезон 12 Серія 12</div></div>';
 const embedded=(direct?'<div class="video-box"><iframe src="https://player.example/direct"></iframe></div>':'')+'<div class="video-box"><iframe src="https://player.example/serial/numbered"></iframe></div>';
 return {page,request:({url})=>url===page?list:url===episodePage?embedded:url==='https://player.example/direct'?player({title:'Пряма озвучка',file:'https://media.example/direct.m3u8'}):url==='https://player.example/serial/numbered'?player([{title:'Інша озвучка',folder:[{title:'Сезон 12',folder:episodes.map(episode=>({title:`Серія ${episode}`,file:`https://media.example/episode-${episode}.m3u8`}))}]}]):url.endsWith('.m3u8')?master:missing({url})};
}
test('UAFlix separate episode page keeps direct voice beside the exact numbered episode only',async()=>{
 const fixture=separateEpisodeFixture({direct:true,episodes:[11,12,13]}),rt=await harness('UAFlix',fixture.request);
 const detail=await rt.call('load',fixture.page);assert.equal(detail.success,true);
 const result=await rt.call('loadStreams',detail.data.episodes[0].url);assert.equal(result.success,true);
 assert.ok(result.data.some(s=>s.url==='https://media.example/direct.m3u8'));
 assert.ok(result.data.some(s=>s.url==='https://media.example/episode-12.m3u8'));
 assert.ok(!result.data.some(s=>/episode-(11|13)/.test(s.url)));
});
test('UAFlix separate episode page never returns mismatching numbered episodes as fallback',async()=>{
 const fixture=separateEpisodeFixture({direct:false,episodes:[11,13]}),rt=await harness('UAFlix',fixture.request);
 const detail=await rt.call('load',fixture.page);assert.equal(detail.success,true);
 const result=await rt.call('loadStreams',detail.data.episodes[0].url);assert.equal(result.success,false);assert.equal(result.errorCode,'NO_STREAMS');
 assert.ok(!rt.calls.some(c=>/episode-(11|13)\.m3u8/.test(c.url)));
});
test('UAFlix separate episode page rejects ordinal placeholders that collide with episode numbers',async()=>{
 const fixture=separateEpisodeFixture({direct:false,episodes:[]});
 const rt=await harness('UAFlix',request=>request.url==='https://player.example/serial/numbered'?player([{title:'Сезон 12',folder:Array.from({length:12},(_,i)=>({title:'Назва '+String.fromCharCode(65+i),file:`https://media.example/unnumbered-${i}.m3u8`}))}]):fixture.request(request));
 const detail=await rt.call('load',fixture.page);assert.equal(detail.success,true);
 const result=await rt.call('loadStreams',detail.data.episodes[0].url);assert.equal(result.success,false);assert.equal(result.errorCode,'NO_STREAMS');
});
