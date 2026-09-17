# Verification — 2026-09-17

The repository now contains 14 independent packages: existing UAKino v2 and
13 new beta ports. UAKino's installed iPhone app was confirmed working by the user
following the app URLSession fix. The other providers have live extraction and
native-worker checks, not physical-device playback confirmation.

## Checks

- All 79 fixture tests passed. They exercise all providers, the native bridge contract, dynamic
  base URLs, encoded search, selectors, metadata, exact season/episode identity,
  multiple voices, subtitle scoping, public PlayerJS/Tortuga serialization,
  UASerials AES serialization, Nuxt indexed payloads, HLS variants, and failures.
- Each `.sky` archive is built from source and contains exactly plugin.json and
  plugin.js. CI compares every archive's unpacked files with the rebuilt files.
- Live checks use normal HTTP, without stored credentials, solver automation or
  executing website JavaScript. HLS responses and HEAD requests verify URLs;
  video segments are not downloaded.
- All 13 native provider tests passed. The native check replays recorded live responses through the actual SkyStream
  JsWorkerRunner, JavaScriptCore, Dart HTML parser and model deserializers. It
  checks 74 callback operations across all 13 new providers. Replay establishes
  runtime/parser compatibility; it does not reproduce the device's network path.

## Live results

All sites returned catalog pages; search and player availability varied as below.
Results combine the full-package run and focused provider checks.

| Provider | Observed playable sample | Limitations observed |
| --- | --- | --- |
| UAKino | Movies, six-episode series, Rick and Morty details; HLS/subtitles/posters 200; user-confirmed iPhone operation | Other titles and external-player handoffs not exhaustively checked |
| UAFlix | Movie and series, including a 32-episode title; HLS 200 | Session-backed sort filters are replaced with explicit category navigation |
| UASerialsPro | Movie and series through decoded player tabs; HLS 200 | Only recognized public player formats supported |
| KinoVezha | Movie and series; HLS 200 | Site metadata order differs from older upstream selectors |
| Eneyida | Movie and 12-episode series, multiple voices, episode-scoped subtitles; HLS 200 | Passive Cloudflare JS must not be mistaken for a challenge page |
| KinoTron | Movie and 32-episode series; HLS 200 | A sampled trailer-only title correctly returned NO_STREAMS |
| KlonTV | Movie and series with multiple voices; HLS 200 | POST search returned 403 in the test client |
| Serialno | Series with 24 episodes; HLS 200 | No physical playback test |
| SimpsonsUA | Current episode and extracted HLS 200 | Tested search term returned no matches; catalog traversal is bounded |
| Цікава Ідея | Movie HLS and Ukrainian subtitles 200 | One 35-episode series had a host response “Файл не знайдено” for the first episode |
| UFDub | Movie and six-episode series; public redirect → MP4 HEAD 200 with ranges | Player follows the public redirect; plugin avoids buffering the whole MP4 |
| BambooUA | Completed four-episode series and another title; HLS 200 | Several newest titles contain only the sponsor placeholder, which is excluded |
| DoramyWorld | Movie and six episodes of season 3; HLS 200 | Current data-player per-episode format is supported in addition to upstream's serial iframe |
| Kinostrain | Movie and 30-episode series through Ashdi; HLS 200 | A vsembed.su-only movie uses an unsupported dynamic player and returns NO_STREAMS |

## App transport and scope

Original production Dio returned 403 for UAKino with the same headers that
returned 200 through Apple URLSession. The maintained app fork supplies native
HTTP and image fetching on Apple platforms, preserves final URLs/cookies and
retains the original socket adapter when custom DNS is explicitly enabled.
App network tests: 55 passed, targeted analysis clean, signed profile build
installed and launched on the physical iPhone. The user then confirmed it works.
The fork and update instructions are at:
https://github.com/vladislawfox/skystream/blob/ios-local-build/FORK.md

No claim is made that CloudStream or this port never encounters network errors.
Site availability, stream expiry and IP/client-specific responses can change.
New-provider playback, subtitle rendering, history persistence and external
players must still be checked on the actual iPhone.

## Reproduction

See README.md for npm checks, opt-in live checks and native replay commands.
Private raw evidence remains in `.local/`: all-live-report.json, native-cases.json,
group-a/group-b/group-c reports and drama-live.json. These are deliberately not
committed because they contain raw site responses and transient URLs.
