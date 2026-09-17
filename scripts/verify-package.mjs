// Verify unpacked content: Node/zlib ZIP compression can differ between hosts.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
const catalog = JSON.parse(await readFile('dist/plugins.json'));
for (const manifest of catalog) {
  const path = `dist/${manifest.packageName}.sky`;
  const committed = new AdmZip(execFileSync('git', ['show', `HEAD:${path}`]));
  const rebuilt = new AdmZip(await readFile(path));
  for (const zip of [committed, rebuilt]) {
    if (zip.getEntries().map(e => e.entryName).sort().join(',') !== 'plugin.js,plugin.json') throw Error(`Unexpected package entries in ${path}`);
  }
  for (const name of ['plugin.js', 'plugin.json']) {
    if (!committed.readFile(name).equals(rebuilt.readFile(name))) throw Error(`Stale committed ${path}/${name}; run npm run build`);
  }
}
console.log(`${catalog.length} committed package contents match rebuilt source byte-for-byte.`);
