# CloudStream → SkyStream

Inspected 2026-09-17. This is a source-level comparison, not a claim that the
four unported sites work today. Only UAKino received live endpoint tests.

## Reference revisions

- [CloudStream Ukrainian](https://github.com/CakesTwix/cloudstream-extensions-uk/tree/dea43efe3746545f515344b1985ab8fb4dc8d36c), GPL-3.0.
- [SkyStream app](https://github.com/akashdh11/skystream/tree/71a60612d32c1de2b63b7e99d20444a2c2265a76).
- [Tools and API guide](https://github.com/akashdh11/skystream-tools/blob/895766d5599d0d192ab1540f8774f1fb76acf2d9/DEVELOPER.md).
- [Official plugins](https://github.com/akashdh11/skystream-plugins/tree/fb406c438cc9efb820b1cddb796f0b2e2de89f98).
- [Sky Universe](https://github.com/akashdh11/sky-universe/tree/35950def796b0675f03dbc048a64da4b8f148d33) is a repository aggregator, not a plugin runtime.

## API mapping

| CloudStream | SkyStream port |
| --- | --- |
| Kotlin `MainAPI`, compiled extension | ES2020 IIFE, `.sky` ZIP containing JS and manifest |
| `getMainPage(page, request)` | `getHome(cb)` returns named categories; first category page only |
| `search` / `quickSearch` | `search(query, cb)` returns item array |
| `load` / Movie/Anime/TV LoadResponse | `load(url, cb)` returns `MultimediaItem`-compatible JSON |
| Jsoup `select`, `text`, `attr` | async native `parse_html`; portable CSS, no Jsoup-only `:contains` |
| `app.get/post`, NiceHttp/OkHttp | native `http_get/http_post`, explicit headers/form encoding |
| episode `data` string | stable page URL fragment with versioned JSON, exact episode name and news ID |
| `loadLinks`, multiple callbacks | `loadStreams(url, cb)` returns stream array with names/headers |
| `M3u8Helper` | master Auto + relative variant URLs; retain master for separate audio groups |
| `SubtitleFile` callback | `StreamResult.subtitles` array (`url`, `label`, optional `lang`) |
| `fixUrl` | relative/protocol-relative URL normalization; dynamic `manifest.baseUrl` |
| thrown extraction exception | `{success:false,errorCode,message}`; one callback per operation |

The package uses no Node, DOM, fetch, eval or external SDK in its deployed code.
Node/JSDOM are only development tools. iOS/macOS use JavaScriptCore; Android uses
QuickJS. `parse_html` on the app returns `html`; the CLI historically returns
`innerHTML`, so this port accepts both.

## Provider behavior in the CloudStream reference

| Provider | Catalog/search | Details, metadata and images | Movies, seasons and episodes | Streams and subtitles |
| --- | --- | --- | --- | --- |
| **UAKino** (`uakino.best`) | DLE POST `/ua/`; `movie-item`, `owl-item`; exclude news/franchises | `solototle`, `film-poster`, `fi-item`, description; year, cast, genres, IMDb, age, country; explicit trailer schema | Movie iframe `#pre` after AJAX `ERR_NOT_DATA`; serial AJAX `playlists.php` keyed by news ID; exact episode text, multiple voices; seasons are separate detail pages | PlayerJS `file`, direct HLS or Tortuga salt/XOR serialization; player-origin Referer; `subtitle` field; HLS expansion |
| **UAFlix** (`uafix.net`) | GET `/index.php?do=search&subaction=search&search_start=0&story=...`; `sres-wrap`; catalog `video-item`, session-backed xfsort filters | `fright h1`, original title, `finfo`, `#fdesc`, IMDb; lazy `data-src` posters; genres/cast/year/country/age; marked trailer | `.video-box iframe`; without iframe, paginated `.video-item` episode pages; otherwise JSON dub → season → episode; numeric labels | PlayerJS `/vod/` direct HLS or nested JSON; exact season/episode selection; all voices; subtitle parser; upstream hardcodes Tortuga Referer in some paths |
| **UASerialsPro** (`uaserials.com`) | GET `/search/{encoded query}/`, `.uas-card`; catalog `.short-item` | `.short-title`, `.oname`, `short-list`, year/actors/genres/country/age/translation, rating; wide/lazy posters and recommendations | Public page `player-control[data-tag1]` is decoded into player tabs; choose available player; direct media or decoded Tortuga season structures | Site player-tab AES serialization plus Tortuga file decoding; direct HLS/season media, subtitle field (may also be serialized); would need separately validated decoder fixtures before porting |
| **KinoVezha** (`kinovezha.tv`) | DLE POST root; `.movie-item` | `.inner-page__title/list/text`, image, IMDb; genre-based movie/series classification; explicit trailer tab | `.video-responsive > iframe`; decoded PlayerJS JSON season folders; persist player URL + season title + episode title | Decoder supports direct/serialized player data; exact season/episode selection; HLS helper; subtitle field or legacy `(subtitle:...)` appended to file |
| **Eneyida** (`eneyida.tv`) | DLE POST root; `article.short` | `full_header-title`, `full_info`, description, cast/age/country/genres/year/ratings; lazy poster and CSS banner; related titles | `.tabs_b.visible iframe`; type inferred from actual JSON: direct movie, movie voices, season→dub→episode or dub→season→episode; deduplicate per season | PlayerJS direct HLS or nested JSON, all matching voices; subtitles on movie/dub/episode, plus direct `subtitle` property |

## Transport, cookies, redirects and protection

| Provider | Explicit transport behavior in reference | Port implication |
| --- | --- | --- |
| UAKino | Browser UA, Accept, Ukrainian language and Referer; AJAX X-Requested-With; no explicit cookie jar or challenge solver in provider | Preserve those headers and use `/ua/` for search. `/` returned 404 in live probes. Normal requests succeeded with curl/Node. Client-dependent challenge responses require app-level testing. |
| UAFlix | Explicit NiceHttp `Session(app.baseClient)` preserves xfsort filter cookies across pagination; player requests set site Referer | Requires actual session-cookie parity; do not assume SkyStream's clearance-cookie jar preserves arbitrary filter cookies. |
| UASerialsPro | Explicit Firefox UA for detail/player and site Referer; shared app for ordinary requests | Keep request context. Public player serialization is separate from network challenges or DRM. No DRM implementation proposed. |
| KinoVezha | Shared `app` transport, site Referer on player requests | Reuse native redirects, validate host headers and serialization with fixtures/live checks before implementation. |
| Eneyida | Mostly shared `app` requests; per-stream settings in HLS helper | Validate redirect behavior and required playback headers against current host; no guessed cookie or bypass layer. |

CloudStream's shared transport follows redirects and can use application-level
session/challenge handling. None of these provider files proves that requests
can never fail. The currently inspected SkyStream engine also follows redirects,
sets `Accept-Encoding: identity`, and has an app-level WebView challenge flow.
Its `CfOnlyCookieInterceptor` reinjects Cloudflare cookies, not a general site
session. The plugin does not create a second cookie jar or add a challenge solver.
A host CLI or bare Dio test omits that app UI/platform flow.

## First-port choices

Keep upstream UAKino's extraction paths, with these adaptations:

- Stable episode fragments avoid expiring timestamps in history identifiers.
- Decode URL bytes internally to avoid a binary/UTF-8 difference in CLI `atob`.
- Do not fabricate years when missing; do not treat trailer `iframe#pre` as film.
- One failed dubbing host does not hide other working voices.
- Preserve Auto HLS alongside quality variants; separate-audio masters stay whole.
- Return explicit challenge/HTTP/parse/no-stream errors; do not fake an empty success.
- Existing separate season pages remain navigation entries in recommendations,
  rather than fetching every season on each details request.

Future providers should each get independent manifests and fixture suites, while
reusing only helpers whose behavior has been verified for that provider.
