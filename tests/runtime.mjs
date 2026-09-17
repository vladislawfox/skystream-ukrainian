import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

export const manifest = JSON.parse(await readFile(new URL('../UAKino/plugin.json', import.meta.url)));
export async function bundle(provider = 'UAKino') {
  const result = await build({
    entryPoints: [new URL(`../${provider}/src/index.js`, import.meta.url).pathname],
    bundle: true, format: 'iife', globalName: 'PluginModule', platform: 'neutral',
    target: 'es2020', alias: {crypto: new URL('../shared/no-native-crypto.js', import.meta.url).pathname}, write: false, footer: { js: 'Object.assign(globalThis, PluginModule);' },
  });
  return result.outputFiles[0].text;
}
export function runtime(code, request, baseUrl = manifest.baseUrl, providerManifest = manifest) {
  const calls = [];
  const http = async (method, url, headers, body) => {
    calls.push({ method, url, headers, body });
    const response = await request({ method, url, headers, body });
    return typeof response === 'string' ? { status: 200, body: response, headers: {} } : response;
  };
  const context = vm.createContext({
    manifest: { ...providerManifest, baseUrl }, URL, console,
    http_get: (url, headers) => http('GET', url, headers),
    http_post: (url, headers, body) => http('POST', url, headers, body),
    parse_html: async (html, selector, attr) => {
      const dom = new JSDOM(html, {virtualConsole: new VirtualConsole()});
      try {
        return Array.from(dom.window.document.querySelectorAll(selector), el => ({
          text: el.textContent, html: el.innerHTML, attr: attr ? el.getAttribute(attr) || '' : '',
        }));
      } finally { dom.window.close(); }
    },
  });
  vm.runInContext(code, context);
  return {
    calls,
    async call(name, ...args) {
      let count = 0;
      let envelope;
      await context[name](...args, value => { count++; envelope = JSON.parse(JSON.stringify(value)); });
      if (count !== 1) throw new Error(`Expected one callback, received ${count}`);
      return envelope;
    },
  };
}
