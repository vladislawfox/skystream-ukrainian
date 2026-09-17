# Initial port

Implement only UAKino, as a separate standard SkyStream repository. Preserve the
CloudStream provider's HTTP headers, DLE search, AJAX episode playlists, exact
episode matching, iframe fallback, public PlayerJS URL decoding and player-origin
Referer. Translate Kotlin/Jsoup models to SkyStream's callback API and native
`http_get`, `http_post`, `parse_html` bridges. No changes to the app engine.

1. Write contract tests using small synthetic site/player responses; observe failure.
2. Implement catalog, search, metadata, season links, episodes, streams and subtitles.
3. Bundle a browser-independent ES2020 plugin; reproducibly package `.sky`, catalog
   and repository manifest. Keep GPL source and upstream attribution together.
4. Test the built callbacks, error handling, alternate voices, HLS and URL decoder.
5. Run bounded live checks on multiple movies and series. Keep volatile stream
   URLs, raw pages and cookies outside version control. Distinguish extraction,
   native JavaScriptCore compatibility and physical iPhone playback evidence.
6. Publish under vladislawfox/skystream-ukrainian (public, user approved), with a
   raw repository URL for installation and documented future-provider mappings.

Scope: seasons follow the site's separate detail pages through recommendations;
episodes carry explicit season numbers and a stable page URL fragment. Refresh
player URLs on playback instead of persisting expiring CDN links. Other providers
are investigated and documented only. Native HTTP owns redirects and cookies.
