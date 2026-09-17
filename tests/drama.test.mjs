import test from 'node:test';import assert from 'node:assert/strict';
import {bundle,runtime} from './runtime.mjs';
const bamboo=await bundle('BambooUA'),doramy=await bundle('DoramyWorld');
const page=(playlist,tags='Дорами')=>`<meta property="og:image" content="/poster.jpg"><script type="application/ld+json">{"@graph":[{"name":"Дорама","description":"Опис"}]}</script><span class="full_cat"><a>${tags}</a></span><script>const playlist = ${JSON.stringify(playlist)};</script>`;
test('Bamboo merges dub/sub episode choices and omits sponsor video',async()=>{
 const playlist=['Озвучення','Субтитри'].map(title=>({title,folder:[{title:'Підтримка',file:'https://cdn.test/be_sponsors.mp4'},{title:'Серія 1',file:'https://cdn.test/'+encodeURIComponent(title)+'/1.m3u8'},{title:'Серія 10',file:'https://cdn.test/10.m3u8'}]}));
 const rt=runtime(bamboo,({url})=>url.includes('site.test')?page(playlist):'#EXTM3U\n','https://site.test',{name:'BambooUA'});
 const r=await rt.call('load','https://site.test/title');assert.equal(r.success,true);assert.equal(r.data.episodes.length,2);assert.ok(!r.data.episodes[0].url.includes('cdn'));
 const s=await rt.call('loadStreams',r.data.episodes[0].url);assert.equal(s.success,true);assert.equal(s.data.length,2);assert.ok(s.data.every(x=>!x.url.includes('10.m3u8')));
});
test('Bamboo movie supports group file and no sponsor',async()=>{
 const rt=runtime(bamboo,({url})=>url.includes('site.test')?page([{title:'Дубляж',file:'https://cdn.test/movie.m3u8'},{title:'Підтримка',file:'https://cdn.test/be_sponsors.mp4'}],'Кіно'):'#EXTM3U\n','https://site.test',{name:'BambooUA'});
 const r=await rt.call('load','https://site.test/cinema/movie');assert.equal(r.success,true);assert.equal(r.data.type,'movie');
 const s=await rt.call('loadStreams',r.data.url);assert.equal(s.data.length,1);assert.match(s.data[0].url,/movie.m3u8/);
});
const dpage='<h1 class="project-title">Дорама / Drama</h1><meta property="og:image" content="/poster.jpg"><div class="about-text-holder"><p>Опис</p></div><li class="item">Рік 2025</li><iframe src="https://ashdi.test/serial/5"></iframe>';
test('Doramy preserves season labels and refetches episode streams',async()=>{
 const rt=runtime(doramy,({url})=>url.includes('site.test')?dpage:url.includes('ashdi.test')?`<script>new Playerjs({file:'[{"title":"Дубляж","folder":[{"title":"Сезон 2","folder":[{"title":"Серія 1","file":"https://cdn.test/one.m3u8"}]}]}]'});</script>`:'#EXTM3U\n','https://site.test',{name:'DoramyWorld'});
 const r=await rt.call('load','https://site.test/dorama/show');assert.equal(r.success,true);assert.equal(r.data.title,'Дорама');assert.equal(r.data.episodes[0].season,2);
 const s=await rt.call('loadStreams',r.data.episodes[0].url);assert.equal(s.success,true);assert.equal(s.data[0].headers.Referer,'https://ashdi.test/');
});
test('Doramy search encodes Ukrainian query and poster URL',async()=>{
 const rt=runtime(doramy,({url})=>{assert.ok(url.includes(encodeURIComponent('Любов + життя')));return '<article class="type-dorama"><h3 class="post-title"><a href="/dorama/life"><span>Життя</span></a></h3><img src="/poster.jpg"></article>';},'https://site.test',{name:'DoramyWorld'});
 const r=await rt.call('search','Любов + життя');assert.equal(r.success,true);assert.equal(r.data[0].posterUrl,'https://site.test/poster.jpg');
});
test('Doramy current data-player exposes each VOD episode and refreshes chosen frame only',async()=>{
 const data=JSON.stringify([{label:'Субтитри',seasons:[{label:null,episodes:['https://ashdi.test/vod/1','https://ashdi.test/vod/2']}]}]).replaceAll('"','&quot;');
 const rt=runtime(doramy,({url})=>url.includes('site.test')?dpage.replace('<iframe',`<div data-player="${data}"></div><iframe`):url.includes('ashdi.test')?`<script>new Playerjs({file:'https://cdn.test/selected.m3u8'});</script>`:'#EXTM3U\n','https://site.test',{name:'DoramyWorld'});
 const r=await rt.call('load','https://site.test/dorama/show-3-sezon/');assert.equal(r.success,true);assert.equal(r.data.episodes.length,2);assert.equal(r.data.episodes[0].season,3);
 const s=await rt.call('loadStreams',r.data.episodes[1].url);assert.equal(s.success,true);assert.ok(rt.calls.some(c=>c.url==='https://ashdi.test/vod/2'));assert.ok(!rt.calls.some(c=>c.url==='https://ashdi.test/vod/1'));
});
