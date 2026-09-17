import { build } from 'esbuild';
import AdmZip from 'adm-zip';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const raw = 'https://raw.githubusercontent.com/vladislawfox/skystream-ukrainian/main';
const manifest = JSON.parse(await readFile(new URL('UAKino/plugin.json', root)));
const result = await build({ entryPoints: [new URL('UAKino/src/index.js', root).pathname], bundle: true,
  format: 'iife', globalName: 'PluginModule', platform: 'neutral', target: 'es2020',
  minify: true, write: false, legalComments: 'inline',
  banner: { js: '/*! SPDX-License-Identifier: GPL-3.0-only | UAKino port (c) 2026 vladislawfox; adapted from CakesTwix and CloudStream Ukrainian contributors. Source & license: https://github.com/vladislawfox/skystream-ukrainian */' },
  footer: { js: 'Object.assign(globalThis, PluginModule);' } });
const zip = new AdmZip();
for (const [name, body] of [['plugin.json', JSON.stringify(manifest, null, 2) + '\n'], ['plugin.js', result.outputFiles[0].text]]) {
  zip.addFile(name, Buffer.from(body));
  zip.getEntry(name).header.time = new Date(2020, 0, 1, 0, 0, 0);
}
await mkdir(new URL('dist/', root), { recursive: true });
const filename = manifest.packageName + '.sky';
await writeFile(new URL('dist/' + filename, root), zip.toBuffer());
const catalog = [{ ...manifest, url: `${raw}/dist/${filename}` }];
const repo = { name: 'Українські джерела', packageName: 'com.vladislawfox.ukrainian',
  description: 'Українські провайдери для SkyStream. Перший провайдер — UAKino.',
  manifestVersion: 1, pluginLists: [`${raw}/dist/plugins.json`] };
await writeFile(new URL('dist/plugins.json', root), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(new URL('repo.json', root), JSON.stringify(repo, null, 2) + '\n');
const check = new AdmZip(new URL('dist/' + filename, root).pathname);
if (check.getEntries().map(e => e.entryName).sort().join(',') !== 'plugin.js,plugin.json') throw new Error('Unexpected package entries');
if (JSON.parse(check.readAsText('plugin.json')).version !== manifest.version) throw new Error('Manifest mismatch');
console.log(`Built ${filename} (${zip.toBuffer().length} bytes), catalog and repo.json`);
