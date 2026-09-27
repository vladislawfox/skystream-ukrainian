import test from 'node:test';
import assert from 'node:assert/strict';
import {bundle, runtime} from './runtime.mjs';

const root = 'https://mirror.test';
const movie = root + '/films/action/42-test.html';
const series = root + '/series/action/43-test.html';
const manifest = {name:'RezkaTV', baseUrl:root};
const card = (path, title='Тест') => `<div class="b-content__inline_item"><a href="${path}"><img src="//images.test/poster.jpg"></a><div class="b-content__inline_item-link"><a href="${path}">${title}</a></div></div>`;
const voices = '<ul id="translators-list"><li data-translator_id="1">Original</li><li data-translator_id="2" data-camrip="0" data-ads="0" data-director="1">Дубляж <img src="/ua-flag.png"></li></ul>';
const episodes = '<div id="simple-episodes-tabs"><ul><li data-season_id="2" data-episode_id="10">Серия 10</li><li data-season_id="1" data-episode_id="15">Серия 15</li><li data-season_id="1" data-episode_id="15">Серия 15</li></ul></div>';
const detail = (isSeries=false, translators=voices) => `<div class="b-post__title"><h1>Тест &amp; друзі</h1></div><div class="b-post__origtitle">Test</div><div class="b-sidecover"><img src="/poster.jpg"></div><div class="b-post__description_text">Опис.</div><table class="b-post__info"><tr><td><a href="/year/2024/">2024 року</a><span class="b-post__info_rates imdb"><span class="bold">7.8</span></span><span itemprop="genre">Драма</span></td></tr></table><input id="ctrl_favs" value="public-value">${translators}${isSeries?episodes:''}<script>sof.tv.initCDN${isSeries?'Series':'Movies'}Events(${isSeries?43:42}, 1, 0, false, {});</script>`;
const encoded = (s) => '#h' + Buffer.from(s).toString('base64').slice(0,12) + '//_//IyMjI14hISMjIUBA' + Buffer.from(s).toString('base64').slice(12);
const stream = voice => JSON.stringify({success:true,url:encoded(`[1080p]https://cdn.test/${voice}/video.m3u8 or https://cdn.test/${voice}/video.mp4,[720p]https://cdn.test/${voice}/720.m3u8`),subtitle:'[Українська]https://cdn.test/uk.vtt'});
async function provider(request) { return runtime(await bundle('RezkaTV'), request, root, manifest); }

test('RezkaTV home and search resolve mirror URLs and omit anime', async()=>{
  const r=await provider(()=>card('/films/action/42-test.html')+card('/animation/44.html'));
  const home=await r.call('getHome');
  assert.equal(home.success,true,home.message);
  assert.deepEqual(Object.keys(home.data),['Фільми','Серіали','Мультфільми']);
  assert.equal(home.data['Фільми'][0].url,movie);
  assert.equal(home.data['Фільми'].length,1);
  const found=await r.call('search','Тест & друзі');
  assert.equal(found.data[0].posterUrl,'https://images.test/poster.jpg');
  assert.equal(new URL(r.calls.at(-1).url).searchParams.get('q'),'Тест & друзі');
  assert.ok(r.calls.every(c=>!c.url.includes('/animation/')));
});
test('RezkaTV movie metadata does not fetch streams just to open details', async()=>{
  const r=await provider(()=>detail());
  const result=await r.call('load',movie);
  assert.equal(result.success,true,result.message);
  assert.equal(result.data.title,'Тест & друзі');
  assert.equal(result.data.type,'movie');
  assert.equal(result.data.year,2024);
  assert.equal(result.data.score,7.8);
  assert.equal(r.calls.length,1);
});
test('RezkaTV series uses stable sorted episode IDs and requests the exact episode in every voice', async()=>{
  const r=await provider(({method,body})=>method==='GET'?detail(true):stream(new URLSearchParams(body).get('translator_id')));
  const loaded=await r.call('load',series);
  assert.equal(loaded.success,true,loaded.message);
  assert.deepEqual(loaded.data.episodes.map(e=>[e.season,e.episode]),[[1,15],[2,10]]);
  assert.ok(!decodeURIComponent(loaded.data.episodes[0].url).includes('cdn.test'));
  const played=await r.call('loadStreams',loaded.data.episodes[0].url);
  assert.equal(played.success,true,played.message);
  for(const c of r.calls.filter(c=>c.method==='POST')) {
    const body=new URLSearchParams(c.body);
    assert.equal(body.get('action'),'get_stream');
    assert.equal(body.get('season'),'1');
    assert.equal(body.get('episode'),'15');
    assert.equal(body.get('id'),'43');
  }
  assert.match(played.data[0].source,/Дубляж.*1080p/);
  assert.match(played.data[0].source,/🇺🇦|Українська/);
  assert.equal(played.data[0].url,'https://cdn.test/2/video.m3u8');
  assert.equal(played.data[0].subtitles[0].lang,'uk');
  assert.equal(played.data[0].headers.Referer,root+'/');
});
test('RezkaTV movie sends flags and keeps working voice when another is unavailable', async()=>{
  const r=await provider(({method,body})=>method==='GET'?detail():new URLSearchParams(body).get('translator_id')==='1'?JSON.stringify({success:false,message:'unavailable'}):stream(2));
  const result=await r.call('loadStreams',movie);
  assert.equal(result.success,true,result.message);
  assert.ok(result.data.every(s=>s.url.includes('/2/')));
  const body=new URLSearchParams(r.calls.find(c=>c.body?.includes('translator_id=2')).body);
  assert.equal(body.get('action'),'get_movie');
  assert.equal(body.get('is_director'),'1');
  assert.equal(body.get('favs'),'public-value');
});
test('RezkaTV handles a single implicit translator and unencoded streams', async()=>{
  const r=await provider(({method})=>method==='GET'?detail(false,''):JSON.stringify({success:true,url:'[480p]https://cdn.test/video.mp4'}));
  const result=await r.call('loadStreams',movie);
  assert.equal(result.success,true,result.message);
  assert.equal(result.data[0].url,'https://cdn.test/video.mp4');
  assert.equal(new URLSearchParams(r.calls.at(-1).body).get('translator_id'),'1');
});
test('RezkaTV offers one URL per quality and format, highest quality first', async()=>{
  const r=await provider(({method})=>method==='GET'?detail(false,''):JSON.stringify({success:true,url:'[480p]https://cdn.test/480.m3u8,[1080p]https://cdn.test/1080.m3u8 or https://mirror-cdn.test/1080.m3u8 or https://cdn.test/1080.mp4 or https://mirror-cdn.test/1080.mp4'}));
  const result=await r.call('loadStreams',movie);
  assert.equal(result.success,true,result.message);
  assert.deepEqual(result.data.map(s=>s.url),['https://cdn.test/1080.m3u8','https://cdn.test/1080.mp4','https://cdn.test/480.m3u8']);
});
test('RezkaTV omits qualities marked premium by the public player', async()=>{
  const r=await provider(({method})=>method==='GET'?detail(false,''):JSON.stringify({success:true,url:'[<span class="pjs-prem-quality">1080p Ultra</span>]https://cdn.test/premium.mp4,[720p]https://cdn.test/public.m3u8'}));
  const result=await r.call('loadStreams',movie);
  assert.equal(result.success,true,result.message);
  assert.deepEqual(result.data.map(s=>s.url),['https://cdn.test/public.m3u8']);
});
test('RezkaTV rejects a series page without an episode instead of playing episode one', async()=>{
  const r=await provider(()=>detail(true));
  const result=await r.call('loadStreams',series);
  assert.equal(result.success,false);
  assert.equal(result.errorCode,'INVALID_EPISODE');
  assert.ok(r.calls.every(c=>c.method==='GET'));
});
test('RezkaTV challenge, denied page and bad player response are explicit errors', async()=>{
  for(const html of ['<script id="anubis_challenge">{}</script>','<title>О нет!</title><p>Доступ запрещён</p>']) {
    const r=await provider(()=>html);
    const result=await r.call('search','Тест');
    assert.equal(result.success,false);
    assert.equal(result.errorCode,'SITE_BLOCKED');
  }
  const r=await provider(({method})=>method==='GET'?detail():'<html>Not a video</html>');
  assert.equal((await r.call('loadStreams',movie)).success,false);
});
test('RezkaTV does not turn premium/error pages or malformed URLs into playable streams', async()=>{
  const r=await provider(({method})=>method==='GET'?detail():JSON.stringify({success:true,url:'[1080p]javascript:alert(1),[720p]https://cdn.test/login.html'}));
  const result=await r.call('loadStreams',movie);
  assert.equal(result.success,false);
  assert.equal(result.errorCode,'NO_STREAMS');
});
