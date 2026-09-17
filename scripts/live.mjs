// Bounded metadata/playlist requests only. Does not download video segments.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { runtime } from '../tests/runtime.mjs';

const catalog = JSON.parse(await readFile(new URL('../dist/plugins.json', import.meta.url)));
const zip = new AdmZip(new URL('../dist/' + catalog[0].packageName + '.sky', import.meta.url).pathname);
const code = zip.readAsText('plugin.js');
const requests = [];
const fixtures = [];
const request = async ({ method, url, headers, body }) => {
  const response = await fetch(url, { method, headers, body, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  requests.push({ host: new URL(url).host, status: response.status, bytes: Buffer.byteLength(text) });
  const result = { status: response.status, body: text, headers: {} };
  fixtures.push({ method, url, body: body ?? null, response: result });
  return result;
};
const r = runtime(code, request);
const report = { checkedAt: new Date().toISOString(), transport: 'Node fetch, native-style HTTP/HTML bridge shape', results: [] };
const run = async (fn, ...args) => {
  const started = Date.now();
  const result = await r.call(fn, ...args);
  console.log(fn, result.success ? 'OK' : result.errorCode, `${Date.now() - started}ms`);
  if (!result.success) throw new Error(result.errorCode + ': ' + result.message);
  return result.data;
};
try {
  const home = await run('getHome');
  report.home = Object.fromEntries(Object.entries(home).map(([key, items]) => [key, items.length]));
  const found = await run('search', 'Німона');
  report.search = { query: 'Німона', count: found.length };
  if (!found.length) throw new Error('Expected a search result');
  const pages = [
    'https://uakino.best/filmy/genre_drama/36167-skarb.html',
    found[0].url,
    'https://uakino.best/seriesss/dokymentalni/23428-dyva-pryrody-bi-bi-si-naivelychnishi-podii-zhyvoi-pryrody-1-sezon.html',
  ];
  for (const page of pages) {
    const item = await run('load', page);
    const summary = { title: item.title, url: page, type: item.type, year: item.year,
      poster: Boolean(item.posterUrl), episodeCount: item.episodes?.length || 0, samples: [] };
    report.results.push(summary);
    for (const target of item.episodes?.slice(0, 2) || [{ url: page, name: 'Movie' }]) {
      const streams = await run('loadStreams', target.url);
      if (!streams.length) throw new Error('Expected streams');
      const master = streams.find(s => s.source.endsWith('Auto')) || streams[0];
      const hls = await request({ method: 'GET', url: master.url, headers: master.headers });
      if (hls.status !== 200 || !hls.body.trimStart().startsWith('#EXTM3U')) throw new Error(`HLS probe failed: ${hls.status}`);
      const subtitleStatuses = [];
      for (const sub of master.subtitles || []) {
        const response = await request({ method: 'GET', url: sub.url, headers: master.headers });
        if (response.status !== 200 || !response.body.includes('-->')) throw new Error(`Subtitle probe failed: ${response.status}`);
        subtitleStatuses.push(response.status);
      }
      summary.samples.push({ episode: target.name, streams: streams.length,
        sources: [...new Set(streams.map(s => s.source))], hlsStatus: hls.status,
        subtitleCount: Math.max(...streams.map(s => s.subtitles?.length || 0)), subtitleStatuses });
    }
  }
} catch (error) { report.error = error.message; process.exitCode = 1; }
report.http = requests;
await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
await writeFile(new URL('../.local/live-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
// Private recordings allow native parser/runtime replay without changing transport.
await writeFile(new URL('../.local/http-fixtures.json', import.meta.url), JSON.stringify(fixtures));
console.log(JSON.stringify({ ...report, http: { requests: requests.length, statuses: [...new Set(requests.map(r => r.status))] } }, null, 2));
