# Verification — 2026-09-17

Version 1 is a **beta**. Extraction works in the live test client. Native
JavaScript/DOM compatibility is verified separately. Physical iPhone playback
and the app's complete networking/Cloudflare flow are **not yet verified**.

## Automated contract tests

`npm test`: 10 passing tests, after observing their initial failures before
implementation. Coverage: Unicode POST encoding, upstream headers, relative/lazy
posters, dynamic base URL, metadata, optional fields, explicit trailers, season
navigation, stable episode IDs, exact episode 1 versus 10, multiple voices,
movie AJAX fallback, binary Tortuga decoding without `atob`, HLS headers/relative
variants, subtitles, challenge errors and partial host failure.

## Live built-package test

`npm run test:live` executed the JavaScript extracted from the actual `.sky` ZIP
using Node 26.7.0 fetch and a SkyStream-shaped HTTP/HTML bridge. On the final run,
38 HTTP requests returned 200. No credentials, preexisting cookies, challenge
solver or video segments were used. Raw pages and expiring stream URLs are kept
only in gitignored `.local/`, never in the published package.

| Case | Result |
| --- | --- |
| Home | All six sections loaded |
| Search `Німона` | One matching title |
| [Скарб (2023)](https://uakino.best/filmy/genre_drama/36167-skarb.html) | Metadata/poster; Auto plus three HLS variants; master HTTP 200 |
| [Німона (2023)](https://uakino.best/filmy/genre-action/17444-nmona.html) | Metadata/poster; Auto, 1080p, 720p, 480p; master HTTP 200; one subtitle file returned HTTP 200 with timed cues |
| [Дива природи, season 1](https://uakino.best/seriesss/dokymentalni/23428-dyva-pryrody-bi-bi-si-naivelychnishi-podii-zhyvoi-pryrody-1-sezon.html) | Six distinct episodes; episode 1 and 2 each returned three voices × four HLS choices, masters HTTP 200 |

The HLS variant labels use the actual resolution in the playlist (for example
1078p for one film), rather than rounding and misreporting it.

## Real SkyStream worker and models

Against app revision `71a60612d32c1de2b63b7e99d20444a2c2265a76`, Flutter 3.47.1,
on macOS, `scripts/skystream_native_test.dart` passed with **recorded live HTTP
responses**. This uses the real `JsWorkerRunner`, JavaScriptCore, native Dart HTML
parser, bridge callbacks and `MultimediaItem`/`StreamResult` deserialization.
It verified six home sections, search, Nimona details/four streams/one subtitle,
and the series' six episodes/twelve stream choices for episode 1.

Reproduce the isolated native check after a successful live Node test:

```sh
cd /path/to/skystream
SKYSTREAM_PLUGIN_ROOT=/path/to/skystream-ukrainian \
SKYSTREAM_HTTP_FIXTURES=/path/to/skystream-ukrainian/.local/http-fixtures.json \
  flutter test /path/to/skystream-ukrainian/scripts/skystream_native_test.dart
```

This proves plugin/runtime/parser compatibility, **not live Dart networking**.

## Observed transport limitation

The same native test with direct Dio HTTP (without fixture replay) received
**HTTP 403 Cloudflare challenge pages for all six catalog URLs**, including a
repeat using the actual app's `Accept-Encoding: identity` setting. The plugin
returned `CLOUDFLARE_BLOCKED` instead of treating the page as content. Curl and
Node requests with the provider headers succeeded. The differing transport is
observed; the exact server-side challenge criterion is not known.

SkyStream already has app-level WebView challenge handling and a clearance-cookie
jar. The CLI/native-worker harness does not run that UI/platform flow. No custom
challenge bypass, TLS impersonation, proxy or app source change was added.
This remaining behavior must be tested in the installed app on the physical
phone. Playback, subtitle rendering, external players, history persistence and
repository installation in the phone UI remain pending. Device access was
unavailable during this verification.
