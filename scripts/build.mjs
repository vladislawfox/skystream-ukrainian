import { build } from 'esbuild';
import AdmZip from 'adm-zip';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const raw = 'https://raw.githubusercontent.com/vladislawfox/skystream-ukrainian/main';
const folders = [];
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
  try { await readFile(new URL(`${entry.name}/plugin.json`, root)); folders.push(entry.name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const catalog = [];
const packages = new Set();
await mkdir(new URL('dist/', root), { recursive: true });
for (const folder of folders.sort()) {
  const manifest = JSON.parse(await readFile(new URL(`${folder}/plugin.json`, root)));
  if (!/^com\.vladislawfox\.ukrainian\.[a-z0-9]+$/.test(manifest.packageName) || packages.has(manifest.packageName)) throw Error(`Invalid/duplicate package ${folder}`);
  if (!Number.isInteger(manifest.version) || manifest.version < 1) throw Error(`Invalid version ${folder}`);
  packages.add(manifest.packageName);
  let banner = `/*! SPDX-License-Identifier: GPL-3.0-only | ${folder} port (c) 2026 vladislawfox; adapted from CakesTwix and CloudStream Ukrainian contributors. Source & license: https://github.com/vladislawfox/skystream-ukrainian */`;
  if (folder === 'UASerialsPro') banner += '\n/*! Bundled crypto-js 4.2.0:\n' + (await readFile(new URL('licenses/crypto-js.txt', root), 'utf8')).replace(/\*\//g, '* /') + '\n*/';
  const result = await build({ entryPoints: [new URL(`${folder}/src/index.js`, root).pathname], bundle: true,
    format: 'iife', globalName: 'PluginModule', platform: 'neutral', target: 'es2020', alias: {crypto: new URL('shared/no-native-crypto.js', root).pathname},
    minify: true, write: false, legalComments: 'inline', banner: { js: banner },
    footer: { js: 'Object.assign(globalThis, PluginModule);' } });
  const zip = new AdmZip();
  for (const [name, body] of [['plugin.json', JSON.stringify(manifest, null, 2) + '\n'], ['plugin.js', result.outputFiles[0].text]]) {
    zip.addFile(name, Buffer.from(body)); zip.getEntry(name).header.time = new Date(2020, 0, 1, 0, 0, 0);
  }
  const filename = manifest.packageName + '.sky';
  await writeFile(new URL('dist/' + filename, root), zip.toBuffer());
  catalog.push({ ...manifest, url: `${raw}/dist/${filename}` });
  const check = new AdmZip(new URL('dist/' + filename, root).pathname);
  if (check.getEntries().map(e => e.entryName).sort().join(',') !== 'plugin.js,plugin.json') throw Error('Unexpected package entries');
  if (JSON.parse(check.readAsText('plugin.json')).version !== manifest.version) throw Error('Manifest mismatch');
  console.log(`Built ${filename} (${zip.toBuffer().length} bytes)`);
}
if (!catalog.length) throw Error('No provider manifests found');
const repo = { name: 'Українські джерела', packageName: 'com.vladislawfox.ukrainian',
  description: 'Українські фільми, серіали, мультфільми та дорами. Порти провайдерів CloudStream.',
  manifestVersion: 1, pluginLists: [`${raw}/dist/plugins.json`] };
await writeFile(new URL('dist/plugins.json', root), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(new URL('repo.json', root), JSON.stringify(repo, null, 2) + '\n');
console.log(`Built ${catalog.length} providers, catalog and repo.json`);
