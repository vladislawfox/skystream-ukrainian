// ZIP deflate bytes can vary across Node/zlib versions. Verify both unpacked
// files byte-for-byte so CI detects stale source/metadata without comparing
// compressor output. Repository/catalog JSON is checked separately in CI.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
const manifest = JSON.parse(await readFile('UAKino/plugin.json'));
const path = `dist/${manifest.packageName}.sky`;
const committed = new AdmZip(execFileSync('git', ['show', `HEAD:${path}`]));
const rebuilt = new AdmZip(await readFile(path));
for (const zip of [committed, rebuilt]) {
  if (zip.getEntries().map(e => e.entryName).sort().join(',') !== 'plugin.js,plugin.json') throw Error('Unexpected package entries');
}
for (const name of ['plugin.js', 'plugin.json']) {
  if (!committed.readFile(name).equals(rebuilt.readFile(name))) throw Error(`Stale committed ${name}; run npm run build`);
}
console.log('Committed package contents match rebuilt source byte-for-byte.');
