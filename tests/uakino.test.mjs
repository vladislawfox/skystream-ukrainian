import test from 'node:test';
import assert from 'node:assert/strict';
import { bundle, runtime } from './runtime.mjs';

const code = await bundle();
const base = 'https://uakino.best';
const movie = `${base}/filmy/42-test.html`;
const series = `${base}/seriesss/51-test-2-sezon.html`;
const card = (url, title = 'Тест &amp; друзі') => `<div class="movie-item short-item"><a class="movie-title" href="${url}">${title}</a><img data-src="/poster.jpg" src="/placeholder.gif"></div>`;
const field = (label, value) => `<div class="fi-item"><div class="fi-label">${label}</div><div class="fi-desc">${value}</div></div>`;
const detail = (extra = '', title = 'Тест') => `<h1><span class="solototle">${title}</span></h1><div class="film-poster"><img src="/poster.jpg"></div>${field('Рік виходу:', '2023')}${field('Жанр:', 'Драми , Пригоди')}${field('Актори:', 'Анна, Богдан')}${field('<img src="imdb.png">', '7.8/1234')}<div itemprop="description">Опис фільму.</div>${extra}`;
const li = (name, id, voice) => `<li data-file="//player.test/${id}" data-voice="${voice}">${name}</li>`;
const playlist = JSON.stringify({ success: true, response: `<div class="playlists-videos"><ul>${li('Серія 1', 'first', 'Студія А')}${li('Серія 10', 'tenth', 'Студія А')}${li('Серія 1', 'second', 'Студія Б')}</ul></div>` });
const noPlaylist = JSON.stringify({ success: false, message: 'ERR_NOT_DATA' });
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n1080/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720/index.m3u8\n';

test('search posts Unicode form once, supplies upstream headers, filters news and deduplicates', async () => {
  const r = runtime(code, req => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, `${base}/ua/`);
    assert.equal(new URLSearchParams(req.body).get('story'), 'Дюна + друзі');
    assert.match(req.headers['User-Agent'], /Chrome/);
    assert.equal(req.headers.Referer, base);
    assert.match(req.headers['Content-Type'], /application\/x-www-form-urlencoded/);
    return card('/filmy/42-test.html') + card('/news/9-news.html') + card('/filmy/42-test.html');
  });
  const result = await r.call('search', 'Дюна + друзі');
  assert.equal(result.success, true);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].title, 'Тест & друзі');
  assert.equal(result.data[0].url, movie);
  assert.equal(result.data[0].posterUrl, `${base}/poster.jpg`);
});

test('home uses category paths and dynamic manifest URL', async () => {
  const mirror = 'https://mirror.test';
  const r = runtime(code, req => {
    assert.ok(req.url.startsWith(mirror + '/'));
    assert.notEqual(req.url, mirror + '/');
    return card('/filmy/42-test.html');
  }, mirror);
  const result = await r.call('getHome');
  assert.equal(result.success, true);
  assert.ok(result.data['Фільми'].length);
  assert.equal(result.data['Фільми'][0].url, mirror + '/filmy/42-test.html');
});

test('movie metadata and only explicitly marked trailer', async () => {
  const r = runtime(code, () => detail('<iframe id="pre" src="https://player.test/movie"></iframe><link itemprop="trailer" value="https://www.youtube.com/embed/abcdef">'));
  const { data } = await r.call('load', movie);
  assert.equal(data.type, 'movie');
  assert.equal(data.year, 2023);
  assert.equal(data.score, 7.8);
  assert.deepEqual(data.tags, ['Драми', 'Пригоди']);
  assert.deepEqual(data.cast.map(a => a.name), ['Анна', 'Богдан']);
  assert.equal(data.trailers[0].url, 'https://www.youtube.com/embed/abcdef');
  assert.equal(data.description, 'Опис фільму.');
});

test('missing metadata stays absent and a player iframe is not a trailer', async () => {
  const r = runtime(code, () => '<h1><span class="solototle">Тест</span></h1><iframe id="pre" src="https://player.test/movie"></iframe>');
  const { data } = await r.call('load', movie);
  assert.equal(data.title, 'Тест');
  assert.equal(data.year, undefined);
  assert.deepEqual(data.trailers, []);
});

test('series deduplicates voices into numbered episodes and preserves season navigation', async () => {
  const r = runtime(code, req => req.url.includes('/engine/ajax/') ? playlist : detail('<div class="playlists-ajax" data-news_id="51"></div><ul class="seasons"><li><a href="/seriesss/50-test-1-sezon.html">1 сезон</a></li></ul>', 'Тест 2 сезон'));
  const { data } = await r.call('load', series);
  assert.equal(data.type, 'series');
  assert.deepEqual(data.episodes.map(e => [e.season, e.episode]), [[2, 1], [2, 10]]);
  assert.equal(data.recommendations[0].url, `${base}/seriesss/50-test-1-sezon.html`);
  assert.ok(data.episodes[0].url.startsWith(series + '#'));
  assert.equal(r.calls[1].headers['X-Requested-With'], 'XMLHttpRequest');
  const again = await r.call('load', series);
  assert.equal(again.data.episodes[0].url, data.episodes[0].url);
});

test('episode 1 selects both voices, never episode 10; HLS headers and subtitles survive', async () => {
  const r = runtime(code, req => {
    if (req.url.includes('/engine/ajax/')) return playlist;
    if (req.url.startsWith(base)) return detail('<div class="playlists-ajax" data-news_id="51"></div>', 'Тест 2 сезон');
    assert.ok(!req.url.includes('tenth'));
    if (req.url.startsWith('https://player.test')) return `<script>new Playerjs({file:'https://cdn.test/${req.url.split('/').pop()}/index.m3u8',subtitle:'[Українська]https://cdn.test/uk.vtt,[English]https://cdn.test/en.vtt'});</script>`;
    assert.equal(req.headers.Referer, 'https://player.test/');
    return master;
  });
  const loaded = await r.call('load', series);
  const result = await r.call('loadStreams', loaded.data.episodes[0].url);
  assert.equal(result.success, true);
  assert.ok(!r.calls.some(call => call.url.includes('tenth')), 'Episode 10 must never be requested');
  assert.ok(result.data.some(s => s.source.includes('Студія А')));
  assert.ok(result.data.some(s => s.source.includes('Студія Б')));
  assert.ok(result.data.some(s => s.source.includes('1080')));
  assert.ok(result.data.some(s => s.url.endsWith('/first/1080/index.m3u8')));
  for (const s of result.data) {
    assert.equal(s.headers.Referer, 'https://player.test/');
    assert.deepEqual(s.subtitles.map(s => s.lang), ['uk', 'en']);
  }
});

test('ERR_NOT_DATA falls back to movie detail iframe, excluding trailer iframe', async () => {
  const r = runtime(code, req => {
    if (req.url.includes('/engine/ajax/')) return noPlaylist;
    if (req.url === movie) return detail('<div id="overroll"><iframe id="pre" src="https://www.youtube.com/embed/trailer"></iframe></div><iframe id="pre" src="//player.test/movie"></iframe>');
    if (req.url === 'https://player.test/movie') return '<script>new Playerjs({file:"https://cdn.test/index.m3u8"})</script>';
    assert.equal(req.url, 'https://cdn.test/index.m3u8');
    return '#EXTM3U\n#EXTINF:6,\nsegment.ts';
  });
  const result = await r.call('loadStreams', movie);
  assert.equal(result.success, true);
  assert.equal(result.data[0].url, 'https://cdn.test/index.m3u8');
});

test('CloudStream Tortuga URL decoding works without atob or Node in plugin runtime', async () => {
  const encoded = 'tqu+pais3MLbmGNlaWdtSgJHVTM8OjE8ShwGH6/v4uaz19jQ0dOjv6f0kYaFg5ZafHJoSndNX1ojLiAGDAgAEhnx1c7t8cXYwOTz8Onugd3dxMwuYGNlMk1FVlw4aSNmKVs===';
  const expected = 'https://calypso.tortuga.wtf/hls/trailers/south_park_bigger_longer__uncut_1999_8176/hls/index.m3u8';
  const r = runtime(code, req => {
    if (req.url.includes('/engine/ajax/')) return noPlaylist;
    if (req.url === movie) return detail('<iframe id="pre" src="https://player.test/movie"></iframe>');
    if (req.url === 'https://player.test/movie') return `<script>new Playerjs({file:'${encoded}'})</script>`;
    assert.equal(req.url, expected);
    return '#EXTM3U\n#EXTINF:6,\nseg.ts';
  });
  const result = await r.call('loadStreams', movie);
  assert.equal(result.success, true);
  assert.equal(result.data[0].url, expected);
});

test('Cloudflare challenge and unexpected HTML return actionable errors', async () => {
  const blocked = runtime(code, () => ({ status: 403, body: '<title>Just a moment...</title><div id="cf-chl-widget">', headers: {} }));
  const result = await blocked.call('load', movie);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'CLOUDFLARE_BLOCKED');
  const changed = runtime(code, () => '<html><h1>Unknown page</h1></html>');
  assert.equal((await changed.call('load', movie)).errorCode, 'PARSE_ERROR');
});

test('a failed voice does not hide working alternatives; complete failure is explicit', async () => {
  const r = runtime(code, req => {
    if (req.url.includes('/engine/ajax/')) return playlist;
    if (req.url === movie) return detail();
    if (req.url.includes('first') || req.url.includes('tenth')) throw new Error('network failure');
    if (req.url.includes('second')) return '<script>new Playerjs({file:"https://cdn.test/index.m3u8"})</script>';
    return '#EXTM3U\n#EXTINF:1,\nseg.ts';
  });
  assert.equal((await r.call('loadStreams', movie)).success, true);
  const broken = runtime(code, () => ({ status: 503, body: 'Unavailable', headers: {} }));
  const result = await broken.call('loadStreams', movie);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'HTTP_ERROR');
});
