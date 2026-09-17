import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runtime } from './runtime.mjs';
const compiled = await build({stdin:{contents:`import {answer} from './shared/core.js'; import {loadPlayer,episodesFromPlayers,streamsFromPlayers} from './shared/playerjs.js'; export async function load(url, cb){return answer(cb, async()=>episodesFromPlayers([await loadPlayer(url)], 'https://site.test/title'))} export async function loadStreams(target, cb){return answer(cb, async()=>streamsFromPlayers([await loadPlayer('https://player.test/serial')],target))}`,resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'PluginModule',platform:'neutral',target:'es2020',write:false,footer:{js:'Object.assign(globalThis, PluginModule)'}});
const code=compiled.outputFiles[0].text;
const encoded = value => { const bytes=Buffer.from(value);return Buffer.from([29,...bytes.map((b,i)=>b^((29+7*i+13)%256))]).toString('base64'); };
const player=data=>`<script>new Playerjs({file:${JSON.stringify(data)},subtitle:'[Українська]https://cdn.test/ua.vtt'});</script>`;
const setup=html=>runtime(code,({url})=>url.startsWith('https://player.test')?html:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=640x360\n360/index.m3u8\n','https://site.test');
test('nested voices preserve exact episodes and all matching dubs',async()=>{
 const data=['Dub A','Dub B'].map(title=>({title,folder:[{title:'Сезон 2',folder:[{title:'Серія 1',file:'https://cdn.test/'+title+'/one.m3u8'},{title:'Серія 10',file:'https://cdn.test/ten.m3u8'}]}]}));
 // URL spaces are invalid; use slugged dub URLs.
 for(const d of data)d.folder[0].folder[0].file='https://cdn.test/'+d.title.replace(' ','')+'/one.m3u8';
 const rt=setup(player(JSON.stringify(data)));const details=await rt.call('load','https://player.test/serial');
 assert.equal(details.success,true);assert.equal(details.data.length,2);assert.equal(details.data[0].season,2);
 const streams=await rt.call('loadStreams',{season:2,episode:1});
 assert.equal(streams.success,true);assert.equal(streams.data.length,4);assert.ok(streams.data.every(s=>!s.url.includes('ten')));
 assert.ok(streams.data.every(s=>s.headers.Referer==='https://player.test/'));assert.equal(streams.data[0].subtitles[0].lang,'uk');
});
test('salted serialized playlists and reverse Base64 are decoded without eval',async()=>{
 const json=JSON.stringify([{title:'Сезон 1',folder:[{title:'Серія 1',file:'https://cdn.test/one.m3u8'}]}]);
 for(const value of [encoded(json),Buffer.from([...json].reverse().join('')).toString('base64')]){
  const r=await setup(player(value)).call('load','https://player.test/serial');assert.equal(r.success,true);assert.equal(r.data.length,1);
 }
});
test('season-first layout, explicit numbers and legacy subtitles remain playable',async()=>{
 const json=JSON.stringify([{title:'Другий сезон',season:2,folder:[{title:'Дубляж',folder:[{title:'Назва',number:3,file:'{Студія}https://cdn.test/three.m3u8(subtitle:[Українська]https://cdn.test/three.vtt)'}]}]}]);
 const r=await setup(player(json)).call('loadStreams',{season:2,episode:3});assert.equal(r.success,true);assert.ok(r.data.length);assert.ok(r.data[0].subtitles.some(s=>s.url.endsWith('three.vtt')));
});
test('challenge returns one explicit failed envelope',async()=>{
 const r=await setup('<title>Just a moment</title><script src="/challenge-platform"></script>').call('load','https://player.test/serial');assert.equal(r.success,false);assert.equal(r.errorCode,'CLOUDFLARE_BLOCKED');
});
test('top-level movie voices stay movies even on a /serial/ player URL',async()=>{
 const r=await setup(player(JSON.stringify([{title:'Голос A',file:'https://cdn.test/movie.m3u8'},{title:'Голос B',file:'https://cdn.test/movie-b.m3u8'}]))).call('load','https://player.test/serial');assert.equal(r.success,true);assert.equal(r.data.length,0);
});
test('semicolon movie voices retain per-track subtitles',async()=>{
 const r=await setup(player('{Voice A}https://cdn.test/a.m3u8(subtitle:[Українська]https://cdn.test/a.vtt);{Voice B}https://cdn.test/b.m3u8')).call('loadStreams',undefined);assert.equal(r.success,true);assert.equal(r.data.filter(s=>s.source.endsWith('Auto')).length,2);
});
test('passive Cloudflare JS detection does not reject a normal player page',async()=>{
 const r=await setup(player('https://cdn.test/a.m3u8')+'<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>').call('loadStreams',undefined);assert.equal(r.success,true);
});
test('unrelated empty strings and comments cannot hide actual PlayerJS config',async()=>{
 const html=`<script>var diagnostic=''; // player's diagnostics\n/* more 'ignored' text */ var player = new Playerjs({file:'https://cdn.test/a.m3u8'});</script>`;
 const r=await setup(html).call('loadStreams',undefined);assert.equal(r.success,true);
});
test('explicit episode and season zero remain separate from episode/season one',async()=>{
 const data=[{title:'Спецвипуски',season:0,folder:[{title:'Пілот',number:0,file:'https://cdn.test/pilot.mp4'},{title:'Перша',number:1,file:'https://cdn.test/one.mp4'}]},{title:'Сезон 1',season:1,folder:[{title:'Пілот',number:0,file:'https://cdn.test/s1pilot.mp4'},{title:'Перша',number:1,file:'https://cdn.test/s1one.mp4'}]}];
 const rt=setup(player(JSON.stringify(data)));const r=await rt.call('load','https://player.test/serial');assert.equal(r.success,true);assert.deepEqual(r.data.map(e=>[e.season,e.episode]),[[0,0],[0,1],[1,0],[1,1]]);
 const selected=await rt.call('loadStreams',{season:1,episode:1});assert.equal(selected.data.length,1);assert.equal(selected.data[0].url,'https://cdn.test/s1one.mp4');
});
test('partial dubs of named episodes do not merge different stories by ordinal',async()=>{
 const data=[{title:'Dub A',folder:[{title:'Сезон 1',folder:[{title:'Pilot',file:'https://cdn.test/pilot.mp4'},{title:'Second',file:'https://cdn.test/second-a.mp4'}]}]},{title:'Dub B',folder:[{title:'Сезон 1',folder:[{title:'Second',file:'https://cdn.test/second-b.mp4'}]}]}];
 const rt=setup(player(JSON.stringify(data))),r=await rt.call('load','https://player.test/serial');assert.deepEqual(r.data.map(e=>e.name),['Pilot','Second']);
 const target=JSON.parse(decodeURIComponent(r.data[0].url.split('#uk=')[1]));const selected=await rt.call('loadStreams',target);assert.equal(selected.data.length,1);assert.equal(selected.data[0].url,'https://cdn.test/pilot.mp4');
});
test('relative paths above the root cannot change the media hostname',async()=>{
 const {absolute}=await import('../shared/core.js');assert.equal(absolute('../../clip.m3u8','https://cdn.test/master.m3u8'),'https://cdn.test/clip.m3u8');
});
test('numbered episode does not select a named pilot with the same display ordinal',async()=>{
 const data=[{title:'Сезон 1',folder:[{title:'Pilot',file:'https://cdn.test/pilot.mp4'},{title:'Серія 1',file:'https://cdn.test/one.mp4'}]}];const rt=setup(player(JSON.stringify(data)));
 const r=await rt.call('loadStreams',{season:1,episode:1});assert.equal(r.data.length,1);assert.equal(r.data[0].url,'https://cdn.test/one.mp4');
});
