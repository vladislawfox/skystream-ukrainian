import test from 'node:test';
import assert from 'node:assert/strict';
import { bundle, runtime } from './runtime.mjs';

const base = 'https://mirror.test';
const page = `${base}/42-test.html`;
const player = 'https://player.test/serial/42';
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n1080/index.m3u8\n';
const card = {
  KinoVezha: '<div class="movie-item"><a class="movie-item__link" href="/42-test.html"><div class="movie-item__title">Тест &amp; друзі</div><div class="img-fit-cover"><img data-src="//images.test/poster.jpg"></div></a></div>',
  Eneyida: '<article class="short"><a class="short_title" href="/42-test.html">Тест &amp; друзі</a><a class="short_img"><img data-src="//images.test/poster.jpg"></a></article>',
  KinoTron: '<div class="th-item"><a class="th-in" href="/42-test.html"><div class="th-title">Тест &amp; друзі</div><div class="img-fit"><img data-src="//images.test/poster.jpg"></div></a></div>',
  Serialno: '<div class="th-item"><a class="th-in" href="/42-test.html"><div class="th-title">Тест &amp; друзі</div><div class="img-fit"><img data-src="//images.test/poster.jpg"></div></a></div>',
};
const detail = {
  KinoVezha: (url = player, trailer = 'https://www.youtube.com/embed/trailer') => `<h1 class="inner-page__title">Тест</h1><div class="img-fit-cover"><img src="/poster.jpg"></div><ul class="inner-page__list"><li>Рік: <a>2024</a></li><li>Жанр: <a>Міні-серіал</a><a>Драма</a></li></ul><div class="inner-page__text">Опис.</div><span class="dd-imdb-colours">7.8</span><div class="tabs-block__select--player"><span>Плеєр</span><span>Трейлер</span></div><div class="tabs-block__content video-inside"><div class="video-responsive"><iframe src="${url}"></iframe></div></div><div class="tabs-block__content video-inside"><iframe src="${trailer}"></iframe></div>`,
  Eneyida: (url = player, trailer = 'https://www.youtube.com/embed/trailer') => `<div class="full_header-title"><h1>Тест</h1></div><div class="full_content-poster"><img src="/poster.jpg"></div><ul class="full_info"><li><a>2024</a></li><li><a>Драма</a></li><li><a>Україна</a></li><li>90 хв.</li><li><a>Анна</a><a>Богдан</a></li><li><span class="age16">16+</span></li></ul><div class="full_content-desc"><p>Опис.</p></div><div class="r_imdb"><span>7.8</span></div><div class="tabs_b visible"><iframe src="${url}"></iframe></div><div id="trailer_place"><iframe data-src="${trailer}"></iframe></div>`,
  KinoTron: (url = player, trailer = 'https://www.youtube.com/embed/trailer') => `<div class="full"><h1>Тест</h1></div><div class="img-box"><img data-src="/poster.jpg"></div><ul class="flist"><li><a>2024</a></li><li><a>Україна</a></li><li><a>Драма</a></li></ul><div class="fsubtitle">Фільм</div><div class="full-text">Опис.</div><span class="fqualityimdb">7.8</span><div class="video-box"><iframe data-src="${url}"></iframe></div><div class="trailer-box"><iframe src="${trailer}"></iframe></div>`,
  Serialno: (url = player, trailer = 'https://www.youtube.com/embed/trailer') => `<div class="full"><h1>Тест</h1></div><div class="fposter"><a href="/poster.jpg"></a></div><ul class="flist"><li>Тест</li><li><a>2024</a></li><li><a>Україна</a></li><li><a>Міні-серіал</a></li><li><a>Драма</a></li></ul><div class="full-text">Опис.</div><span class="th-voice">7.8</span><div class="tabs-sel"><span>Плеєр</span><span>Трейлер</span></div><div class="video-box"><iframe src="${url}"></iframe></div><div class="video-box"><iframe src="${trailer}"></iframe></div>`,
};
const leaf = (n, voice) => ({ title: `${n} серія`, number: String(n), file: `https://cdn.test/${voice}/${n}/index.m3u8`, subtitle: '[Українська]https://cdn.test/uk.vtt', poster: 'https://images.test/episode.jpg' });
const voices = () => ['Студія А', 'Студія Б'].map((title, i) => ({ title, folder: [{ title: '2 сезон', season: '2', folder: [leaf(1, i), leaf(10, i)] }] }));
const seasons = () => [{ title: '2 сезон', season: '2', folder: ['Студія А', 'Студія Б'].map((title, i) => ({ title, folder: [leaf(1, i), leaf(10, i)] })) }];
const tortuga = () => [{ title: '2 сезон', season: '2', folder: [1, 10].map(n => ({ ...leaf(n, 'tortuga'), subtitle: undefined, file: `{Цікава Ідея}https://cdn.test/tortuga/${n}/index.m3u8(subtitle:[Українська]https://cdn.test/uk.vtt)` })) }];
const script = file => `<script>new Playerjs({file:${JSON.stringify(typeof file === 'string' ? file : JSON.stringify(file))}})</script>`;
function encode(value) {
  const salt = 71;
  return Buffer.from([salt, ...Buffer.from(value).map((b, i) => b ^ ((salt + 7 * i + 13) % 256))]).toString('base64');
}
async function run(name, handler) {
  return runtime(await bundle(name), handler, base, { name, baseUrl: base });
}

for (const name of Object.keys(card)) {
  test(`${name} catalog/search honor mirror, Unicode, absolute posters and no anime home section`, async () => {
    const r = await run(name, req => {
      assert.ok(req.url.startsWith(base));
      if (req.method === 'POST') {
        assert.equal(new URLSearchParams(req.body).get('story'), 'Дюна + друзі');
        assert.equal(req.url, name === 'KinoTron' ? `${base}/index.php?do=search` : `${base}/`);
      }
      return card[name] + card[name];
    });
    const home = await r.call('getHome');
    assert.equal(home.success, true);
    assert.equal(home.data['Аніме'], undefined);
    const homeItems = Object.values(home.data).flat();
    assert.ok(homeItems.length >= 3);
    assert.equal(homeItems[0].url, page);
    const searched = await r.call('search', 'Дюна + друзі');
    assert.equal(searched.success, true);
    assert.deepEqual(searched.data.map(item => [item.title, item.url, item.posterUrl]), [['Тест & друзі', page, 'https://images.test/poster.jpg']]);
  });

  test(`${name} detail preserves numbered episodes and refreshes only selected episode streams`, async () => {
    const playlist = ['KinoVezha', 'Serialno'].includes(name) ? script(encode(JSON.stringify(tortuga()))) : script(voices());
    const r = await run(name, req => {
      if (req.url === page) return detail[name]();
      if (req.url === player) return playlist;
      assert.ok(req.url.startsWith('https://cdn.test/') && !req.url.includes('/10/'), `unexpected ${req.url}`);
      return master;
    });
    const loaded = await r.call('load', page);
    assert.equal(loaded.success, true, loaded.message);
    assert.equal(loaded.data.type, 'series');
    assert.equal(loaded.data.year, 2024);
    assert.equal(loaded.data.score, 7.8);
    assert.equal(loaded.data.posterUrl, `${base}/poster.jpg`);
    assert.equal(loaded.data.trailers[0].url, 'https://www.youtube.com/embed/trailer');
    assert.deepEqual(loaded.data.episodes.map(e => [e.season, e.episode]), [[2, 1], [2, 10]]);
    const episode = loaded.data.episodes[0].url;
    assert.ok(episode.startsWith(page + '#'));
    assert.ok(!decodeURIComponent(episode).includes('cdn.test'));
    const played = await r.call('loadStreams', episode);
    assert.equal(played.success, true, played.message);
    assert.ok(played.data.length >= 2);
    assert.ok(played.data.every(s => !s.url.includes('/10/') && !s.url.includes('(subtitle:')));
    assert.ok(played.data.every(s => s.subtitles[0].url === 'https://cdn.test/uk.vtt'));
    assert.equal(r.calls.filter(c => c.url === page).length, 2);
    assert.equal(r.calls.filter(c => c.url === player).length, 2);
    if (['Eneyida', 'KinoTron'].includes(name)) {
      assert.ok(played.data.some(s => s.source.includes('Студія А')));
      assert.ok(played.data.some(s => s.source.includes('Студія Б')));
    }
  });

  test(`${name} reports blocked and changed pages instead of empty success`, async () => {
    const blocked = await run(name, () => ({ status: 403, body: '<title>Just a moment...</title><div id="cf-chl-widget">' }));
    assert.equal((await blocked.call('load', page)).errorCode, 'CLOUDFLARE_BLOCKED');
    const changed = await run(name, () => '<html><h1>Unknown page</h1></html>');
    assert.equal((await changed.call('load', page)).errorCode, 'PARSE_ERROR');
  });
}

test('Eneyida handles season-first voices and keeps movie voice arrays as movies', async () => {
  let file = seasons();
  const r = await run('Eneyida', req => req.url === page ? detail.Eneyida() : req.url === player ? script(file) : master);
  const season = await r.call('load', page);
  assert.equal(season.success, true, season.message);
  assert.deepEqual(season.data.episodes.map(e => [e.season, e.episode]), [[2, 1], [2, 10]]);
  const streams = await r.call('loadStreams', season.data.episodes[0].url);
  assert.ok(streams.data.some(s => s.source.includes('Студія А')));
  assert.ok(streams.data.some(s => s.source.includes('Студія Б')));
  file = [{ title: 'Студія А', file: 'https://cdn.test/movie.m3u8' }, { title: 'Студія Б', file: 'https://cdn.test/movie-b.m3u8' }];
  const movie = await r.call('load', page);
  assert.equal(movie.data.type, 'movie');
  assert.equal(movie.data.episodes, undefined);
  assert.deepEqual(movie.data.cast.map(actor => actor.name), ['Анна', 'Богдан']);
  assert.equal(movie.data.contentRating, '16+');
  assert.match(movie.data.description, /Україна/);
  const movieStreams = await r.call('loadStreams', page);
  assert.ok(movieStreams.data.some(s => s.url === 'https://cdn.test/movie.m3u8'));
  assert.ok(movieStreams.data.some(s => s.url === 'https://cdn.test/movie-b.m3u8'));
});

test('KinoTron rejects trailer-only titles and /vod/ overrides incorrect series metadata', async () => {
  const trailer = 'https://www.youtube.com/embed/trailer';
  const unavailable = await run('KinoTron', () => detail.KinoTron(trailer));
  assert.equal((await unavailable.call('load', page)).errorCode, 'NO_STREAMS');
  const r = await run('KinoTron', req => req.url === page ? detail.KinoTron('https://player.test/vod/42').replace('Фільм', 'Серіал') : req.url.includes('/vod/') ? script('https://cdn.test/movie.m3u8') : master);
  assert.equal((await r.call('load', page)).data.type, 'movie');
  const streams = await r.call('loadStreams', page);
  assert.equal(streams.success, true, streams.message);
  assert.ok(streams.data.some(s => s.url === 'https://cdn.test/movie.m3u8'));
});

test('Serialno accepts legacy reversed base64 playlists and resolves explicit Tortuga trailers', async () => {
  const reversed = Buffer.from([...JSON.stringify(tortuga())].reverse().join('')).toString('base64');
  const r = await run('Serialno', req => {
    if (req.url === page) return detail.Serialno(player, 'https://tortuga.tw/vod/trailer');
    if (req.url === 'https://tortuga.tw/vod/trailer') return script(encode('https://cdn.test/trailer.m3u8'));
    if (req.url === player) return script(reversed);
    return master;
  });
  const loaded = await r.call('load', page);
  assert.equal(loaded.success, true, loaded.message);
  assert.equal(loaded.data.episodes.length, 2);
  assert.equal(loaded.data.trailers[0].url, 'https://cdn.test/trailer.m3u8');
});

test('KinoVezha reads the labeled year after ranking rows; KinoTron accepts an unlinked year', async () => {
  for (const name of ['KinoVezha', 'KinoTron']) {
    const html = name === 'KinoVezha'
      ? detail[name]().replace('<li>Рік:', '<li><span>Списки:</span><a>Найкращі серіали 2023</a></li><li>Рік:')
      : detail[name]().replace('<li><a>2024</a></li>', '<li><span>Рік:</span> 2024</li>');
    const r = await run(name, req => req.url === page ? html : script(voices()));
    const loaded = await r.call('load', page);
    assert.equal(loaded.success, true, loaded.message || 'detail load');
    assert.equal(loaded.data.year, 2024);
  }
});

test('Eneyida single-quoted playlist keeps other episodes subtitles out of selected streams', async () => {
  const playlist = voices();
  for (const dub of playlist) for (const episode of dub.folder[0].folder) episode.subtitle = `[Українська]https://cdn.test/uk-${episode.number}.vtt`;
  const playerHtml = `<script>new Playerjs({file:'${JSON.stringify(playlist)}'})</script>`;
  const r = await run('Eneyida', req => req.url === page ? detail.Eneyida() : req.url === player ? playerHtml : master);
  const loaded = await r.call('load', page);
  const streams = await r.call('loadStreams', loaded.data.episodes[0].url);
  assert.equal(streams.success, true, streams.message || 'stream load');
  for (const stream of streams.data) assert.deepEqual(stream.subtitles.map(sub => sub.url), ['https://cdn.test/uk-1.vtt']);
});
