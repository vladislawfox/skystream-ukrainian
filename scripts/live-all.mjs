// Bounded opt-in live verification. Responses/volatile URLs stay in ignored .local.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import AdmZip from 'adm-zip';
import {runtime} from '../tests/runtime.mjs';
const catalog=JSON.parse(await readFile('dist/plugins.json'));
const fixtures=[],cases=[],reports=[];
const wanted=new Set(process.argv.slice(2));
await mkdir('.local',{recursive:true});
for(const manifest of catalog){
 if(manifest.name==='UAKino'||(wanted.size&&!wanted.has(manifest.name)))continue;
 const report={provider:manifest.name,checkedAt:new Date().toISOString(),physicalPlaybackTested:false};
 const rt=runtime(new AdmZip(await readFile(`dist/${manifest.packageName}.sky`)).readAsText('plugin.js'),async({method,url,headers,body})=>{
  const res=await fetch(url,{method,headers,body,signal:AbortSignal.timeout(18000)});
  const type=res.headers.get('content-type')||'';
  if(/^video\/(mp4|webm)/i.test(type)){await res.body?.cancel();throw Error('Live probe refused to buffer video');}
  const response={status:res.status,body:await res.text(),finalUrl:res.url,headers:Object.fromEntries(res.headers)};
  fixtures.push({provider:manifest.name,method,url,body:body??null,response});return response;
 },manifest.baseUrl,manifest);
 async function call(method,...args){const envelope=await rt.call(method,...args);cases.push({provider:manifest.name,method,args,success:envelope.success,errorCode:envelope.errorCode,count:Array.isArray(envelope.data)?envelope.data.length:undefined});return envelope;}
 try{
  const home=await call('getHome');if(!home.success)throw Error(`${home.errorCode}: ${home.message}`);
  report.homeSections=Object.keys(home.data).length;const items=[...new Map(Object.values(home.data).flat().map(e=>[e.url,e])).values()];report.homeItems=items.length;
  const candidates=[];for(const type of ['movie','series'])candidates.push(...items.filter(e=>e.type===type).slice(0,2));if(!candidates.length)candidates.push(...items.slice(0,2));
  report.samples=[];const successful=new Set();
  for(const card of candidates){if(successful.has(card.type))continue;
   const sample={title:card.title};const detail=await call('load',card.url);if(!detail.success){sample.error=detail.errorCode;report.samples.push(sample);continue;}
   sample.title=detail.data.title;sample.type=detail.data.type;sample.episodes=detail.data.episodes?.length||0;
   const streams=await call('loadStreams',detail.data.episodes?.[0]?.url||detail.data.url);
   if(!streams.success)sample.error=streams.errorCode;
   else {sample.streams=streams.data.length;const stream=streams.data[0];if(stream){const head=await fetch(stream.url,{method:'HEAD',headers:stream.headers,signal:AbortSignal.timeout(15000)});sample.mediaHeadStatus=head.status;sample.mediaType=head.headers.get('content-type');await head.body?.cancel();successful.add(card.type);}}
   report.samples.push(sample);
  }
  const search=await call('search','любов');report.search=search.success?search.data.length:{error:search.errorCode};
 }catch(error){report.error=error.message;}
 reports.push(report);console.log(JSON.stringify(report));
 await writeFile('.local/all-live-report.json',JSON.stringify(reports,null,2));
 await writeFile('.local/native-cases.json',JSON.stringify({cases,fixtures}));
}
