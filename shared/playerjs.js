// SPDX-License-Identifier: GPL-3.0-only
// Public PlayerJS/Tortuga serialization, adapted from CloudStream Ukrainian.
import {base,clean,inner,origin,unique,absolute,headers,ProviderError,request,select,episodeUrl} from './core.js';
const label = value => clean(String(value ?? '').replace(/<[^>]*>/g, ''));
export function base64Bytes(value) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const raw=String(value).replace(/\s/g,'').replace(/=+$/,'');
  if(!raw || /[^A-Za-z\d+/]/.test(raw) || raw.length%4===1)return [];
  let bits=0,buffer=0;const out=[];
  for(const c of raw){buffer=(buffer<<6)|alphabet.indexOf(c);bits+=6;if(bits>=8){bits-=8;out.push((buffer>>bits)&255);}}
  return out;
}
function utf8(bytes){try{return decodeURIComponent(bytes.map(b=>'%'+b.toString(16).padStart(2,'0')).join(''));}catch{return '';}}
export function decodeFile(value){
  const raw=String(value??'').trim();
  if(/^(https?:\/\/|\/\/|\[|\{)/i.test(raw))return raw;
  const bytes=base64Bytes(raw);if(bytes.length<2)return '';
  const xor=utf8(bytes.slice(1).map((b,i)=>b^((bytes[0]+7*i+13)%256)));
  if(/^(https?:\/\/|\[|\{)/i.test(xor))return xor;
  const reverse=[...utf8(bytes)].reverse().join('');
  return /^(https?:\/\/|\[|\{)/i.test(reverse)?reverse:'';
}
function quotedValue(script,start){
  const quote=script[start];let value='';
  for(let i=start+1;i<script.length;i++){
    const c=script[i];if(c===quote)return value;
    if(c==='\\'){
      const n=script[++i];
      if(n==='u' && /^[a-f\d]{4}$/i.test(script.slice(i+1,i+5))){value+=String.fromCharCode(parseInt(script.slice(i+1,i+5),16));i+=4;}
      else if(n==='x' && /^[a-f\d]{2}$/i.test(script.slice(i+1,i+3))){value+=String.fromCharCode(parseInt(script.slice(i+1,i+3),16));i+=2;}
      else value+=({n:'\n',r:'\r',t:'\t'}[n]??n);
    }else value+=c;
  }return '';
}
export function jsonValueAt(script,start){
  const opening=script[start];if(opening!=='['&&opening!=='{')return '';
  let depth=0,quote='',escape=false;
  for(let i=start;i<script.length;i++){
    const c=script[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='['||c==='{')depth++;if(c===']'||c==='}')depth--;
    if(!depth)return script.slice(start,i+1);
  }return '';
}
function literalAt(script,start){
  const c=script[start];
  if(c==='"'||c==="'"){
    let end=start+1;for(;end<script.length;end++){if(script[end]==='\\')end++;else if(script[end]===c)break;}
    return {value:quotedValue(script,start),end:end+1};
  }
  if(c==='['||c==='{'){const value=jsonValueAt(script,start);return {value,end:start+value.length};}
  return null;
}
export function scriptValues(script,name){
  const values=[];let i=0;
  while(i<script.length){
    if(script.slice(i,i+2)==='//'){const end=script.indexOf('\n',i+2);i=end<0?script.length:end+1;continue;}
    if(script.slice(i,i+2)==='/*'){const end=script.indexOf('*/',i+2);i=end<0?script.length:end+2;continue;}
    let token='',end=i;
    if(script[i]==='"'||script[i]==="'"){const part=literalAt(script,i);token=part.value;end=part.end;}
    else {const match=script.slice(i).match(/^[A-Za-z_$][\w$]*/);if(match){token=match[0];end=i+token.length;}}
    if(!token){i=end>i?end:i+1;continue;}
    let cursor=end;while(/\s/.test(script[cursor]||'')&&cursor<script.length)cursor++;
    if((script[cursor]===':'||script[cursor]==='=')&&[name,'file','subtitle','playlist'].includes(token)){
      cursor++;while(/\s/.test(script[cursor]||'')&&cursor<script.length)cursor++;
      const part=literalAt(script,cursor);
      if(part){if(token===name&&part.value)values.push(part.value);i=part.end;continue;}
    }
    i=end;
  }
  return values;
}
export function parseSubtitles(raw,player){
  if(Array.isArray(raw))return raw.map(s=>typeof s==='string'?{url:absolute(s,player),label:'Субтитри'}:{...s,url:absolute(s.url||s.file,player),label:s.label||s.title||'Субтитри'}).filter(s=>s.url);
  const value=decodeFile(raw)||String(raw??'');const matches=[...value.matchAll(/\[([^\]]+)\]([^\[]+)/g)];
  if(!matches.length){const url=absolute(value,player);return url?[{url,label:'Субтитри'}]:[];}
  return unique(matches.map(m=>{const name=label(m[1]),url=absolute(m[2].replace(/[,\s]+$/,''),player);return {url,label:name,...(/укра|\buk\b|\bua\b/i.test(name)?{lang:'uk'}:{})};}).filter(s=>s.url),s=>s.url);
}
function mediaParts(raw,player){
  let value=decodeFile(raw)||String(raw??'').trim();
  const tracks=value.split(/;(?=\s*\{[^}]+\}https?:\/\/)/i);
  if(tracks.length>1)return tracks.flatMap(track=>mediaParts(track,player));
  const marker=value.indexOf('(subtitle:');const subs=marker>=0?parseSubtitles(value.slice(marker+10).replace(/\)\s*$/,''),player):[];
  if(marker>=0)value=value.slice(0,marker);
  const voice=value.match(/^\{([^}]+)\}/)?.[1];if(voice)value=value.slice(voice.length+2);
  if(/^\[(?:\d+p?|Auto|HD|FHD|UHD)\]/i.test(value))return [...value.matchAll(/\[([^\]]+)\]([^\[]+)/g)].map(m=>({url:absolute(decodeFile(m[2].replace(/[,\s]+$/,''))||m[2].replace(/[,\s]+$/,''),player),quality:m[1],voice,subtitles:subs})).filter(m=>m.url);
  const url=absolute(value,player);return url?[{url,quality:'Auto',voice,subtitles:subs}]:[];
}
function nonnegativeNumber(value){
  if(value===undefined||value===null||value==='')return undefined;
  const n=Number(value);return Number.isInteger(n)&&n>=0?n:undefined;
}
export function flattenPlaylist(data,player,{subtitles=[],forceSeries=false}={}){
  const entries=[];const walk=(nodes,context={})=>{
    const list=Array.isArray(nodes)?nodes:[nodes];
    list.forEach((node,index)=>{
      if(typeof node==='string')node={file:node};if(!node||typeof node!=='object')return;
      const title=label(node.title||node.name),folder=node.folder;
      const seasonNumber=nonnegativeNumber(node.season)??nonnegativeNumber(title.match(/(?:сезон|season)\s*(\d+)|(\d+)\s*(?:сезон|season)/i)?.slice(1).find(v=>v!==undefined));
      const subs=unique([...subtitles,...(context.subtitles||[]),...parseSubtitles(node.subtitle||'',player)],s=>s.url);
      if(Array.isArray(folder)){
        const season=seasonNumber??(/^\d+$/.test(title)?Number(title):/(?:сезон|season)/i.test(title)?index+1:undefined);
        const seasonKey=seasonNumber!==undefined||/^\d+$/.test(title)?`n:${season}`:`t:${title}`;
        walk(folder,{...context,subtitles:subs,...(season!==undefined?{season,seasonKey,seasonName:title}:{voice:title||context.voice})});
      }
      if(typeof node.file!=='string'||!node.file.trim()||/be_sponsors\.mp4/i.test(node.file))return;
      const ep=nonnegativeNumber(node.episode??node.number)??nonnegativeNumber(title.match(/(?:серія|серiя|серия|episode|ep\.?|серію)\s*(\d+)|(\d+)\s*(?:серія|серiя|серия|episode)/i)?.slice(1).find(v=>v!==undefined))??(/^\d+$/.test(title)?Number(title):undefined);
      const series=context.season!==undefined||ep!==undefined||forceSeries;
      for(const media of mediaParts(node.file,player))entries.push({...media,player,subtitles:unique([...subs,...media.subtitles],s=>s.url),voice:media.voice||context.voice||(!series?title:'')||manifest.name,...(series?{season:context.season??1,episode:ep??index+1,seasonKey:context.seasonKey||'n:1',episodeKey:ep!==undefined?`n:${ep}`:title?`t:${title}`:`i:${context.voice||''}:${index}`, seasonName:context.seasonName||'Сезон 1',episodeName:title||`Серія ${ep??index+1}`}:{}) ,posterUrl:absolute(node.poster||node.image,player)});
    });
  };walk(data);return entries;
}
export async function loadPlayer(url,referer=base(),depth=0){
  url=absolute(url,referer);if(!url||/youtube\.com|youtu\.be/i.test(url))throw new ProviderError('NO_STREAMS','Плеєр не містить основного відео.');
  if(depth>3)throw new ProviderError('NO_STREAMS','Забагато вкладених плеєрів.');
  if(/\.(m3u8|mp4|mpd)(?:[?#]|$)/i.test(url))return {url,entries:flattenPlaylist({file:url},url),isSeries:false};
  const html=await request(url,headers(referer));
  const scripts=(await select(html,'script')).map(n=>inner(n)||n.text).join('\n');
  const source=scripts||html;const subs=parseSubtitles(scriptValues(source,'subtitle').join(','),url);
  const candidates=scriptValues(source,'file');
  if(/^\s*[\[{]/.test(html))candidates.unshift(html.trim());
  // A serialized playlist is preferred over nested file properties and ads.
  const decoded=candidates.map(decodeFile).filter(Boolean);
  let entries=[];
  for(const value of decoded){try{const data=JSON.parse(value);entries=flattenPlaylist(data,url,{subtitles:subs,forceSeries:/\/serial\//i.test(url)&&(Array.isArray(data)?data:[data]).some(n=>Array.isArray(n?.folder))});if(entries.length)break;}catch{}}
  if(!entries.length){
    const direct=decoded.filter(v=>!/^\s*[\[{]/.test(v)||/^\[\d+p?\]|^\{[^}]+\}https?:/.test(v));
    direct.sort((a,b)=>Number(b.includes('.m3u8'))-Number(a.includes('.m3u8')));
    for(const value of direct){
      if(/\.json(?:[?#]|$)/i.test(value)){try{const data=JSON.parse(await request(value,headers(url)));entries=flattenPlaylist(data,url,{subtitles:subs});}catch{} }
      else entries=flattenPlaylist({file:value},url,{subtitles:subs});
      if(entries.length)break;
    }
  }
  if(!entries.length){
    const frames=await select(html,'iframe[src]','src');
    for(const frame of frames){const child=absolute(frame.attr,url);if(!child||child===url||/youtube\.com|youtu\.be/i.test(child))continue;try{return await loadPlayer(child,url,depth+1);}catch{}}
  }
  if(!entries.length)throw new ProviderError('NO_STREAMS','Плеєр не повернув підтримуваного відео.');
  return {url,entries,isSeries:entries.some(e=>e.episode!==undefined)};
}
export function episodesFromPlayers(players,pageUrl){
  const entries=players.flatMap(p=>p.entries).filter(e=>e.episode!==undefined);
  const seen=new Map();
  for(const e of entries){const key=`${e.seasonKey||e.season}|${e.episodeKey||e.episode}`;if(!seen.has(key))seen.set(key,e);}
  return [...seen.values()].map(e=>{
    const named=(e.episodeKey&&!e.episodeKey.startsWith('n:'))||(e.seasonKey&&!e.seasonKey.startsWith('n:'));
    const target=named?{seasonKey:e.seasonKey,episodeKey:e.episodeKey}:{season:e.season,episode:e.episode};
    return {name:e.episodeName,season:e.season,episode:e.episode,url:episodeUrl(pageUrl,target),posterUrl:e.posterUrl,dubStatus:'dubbed'};
  }).sort((a,b)=>a.season-b.season||a.episode-b.episode);
}
export async function streamResults(file,{voice=manifest.name,player=base(),subtitles=[]}={}){
  const streams=[];const streamHeaders=headers(origin(player)+'/');
  for(const media of mediaParts(file,player)){
    const subs=unique([...parseSubtitles(subtitles,player),...media.subtitles],s=>s.url);
    const result=(url,quality)=>({url,source:`${media.voice||voice} · ${quality}`,providerName:manifest.name,headers:streamHeaders,subtitles:subs});
    streams.push(result(media.url,media.quality));
    if(!/\.m3u8(?:[?#]|$)/i.test(media.url))continue;
    try{
      const hls=await request(media.url,streamHeaders);
      if(!hls.trimStart().startsWith('#EXTM3U')||/#EXT-X-MEDIA:.*TYPE=AUDIO/.test(hls))continue;
      const lines=hls.split(/\r?\n/).map(l=>l.trim());
      for(let i=0;i<lines.length;i++){if(!lines[i].startsWith('#EXT-X-STREAM-INF:'))continue;const quality=lines[i].match(/RESOLUTION=\d+x(\d+)/)?.[1];let j=i+1;while(j<lines.length&&(!lines[j]||lines[j].startsWith('#')))j++;const url=absolute(lines[j],media.url);if(url)streams.push(result(url,quality?`${quality}p`:'HLS'));}
    }catch{}
  }return unique(streams,s=>s.url+'|'+s.source);
}
function matchesNumber(value,key,wanted){return wanted===undefined||(key!==undefined?key===`n:${Number(wanted)}`:Number(value)===Number(wanted));}
export async function streamsFromPlayers(players,target){
  let entries=players.flatMap(p=>p.entries);
  if(target)entries=entries.filter(e=>target.episodeKey!==undefined
    ? e.episodeKey===target.episodeKey&&e.seasonKey===target.seasonKey
    : matchesNumber(e.season,e.seasonKey,target.season)&&matchesNumber(e.episode,e.episodeKey,target.episode));
  if(!entries.length)throw new ProviderError('NO_STREAMS','Для вибраної серії немає доступного відео.');
  const results=await Promise.allSettled(entries.map(e=>streamResults(e.url,{voice:e.voice,player:e.player,subtitles:e.subtitles})));
  const streams=results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);
  if(!streams.length)throw new ProviderError('NO_STREAMS','Доступних потоків не знайдено.');
  return unique(streams,s=>s.url+'|'+s.source);
}
