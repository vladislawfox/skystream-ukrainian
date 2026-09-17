# Non-anime Ukrainian providers and maintained SkyStream fork

User scope: port every CloudStream Ukrainian source except dedicated anime sites;
retain existing UAKino and publish under the existing repository URL. Separate
app fork is maintained in vladislawfox/skystream with an upstream remote.

Provider inventory at upstream dea43efe3746545f515344b1985ab8fb4dc8d36c:
UAKino (existing), UAFlix, UASerialsPro, KinoVezha, Eneyida, KinoTron,
KlonTV, Serialno, SimpsonsUA, CikavaIdeya, UFDub, BambooUA, DoramyWorld,
Kinostrain. Exclude AnimeON, AnimeUA, Anitubeinua, Unimay, Coaninet (its
actual catalog is anime despite TvSeries declaration), HentaiUkr, and SyncPlugin
(not a content source). Mixed film/drama sources remain; dedicated anime home
sections are omitted in new ports. Existing UAKino behavior remains compatible.

Architecture: independent manifests and callback entry points per provider;
shared native HTTP/HTML helpers and public PlayerJS/HLS handling. No eval of
remote scripts, no private credentials, DRM or interactive-check bypass. Stable
page URL plus episode keys instead of caching expiring video URLs. Public
serialization decoders from upstream are allowed and documented.

- [x] App fork: split verified transport and personal signing commits; document
      merge-based upstream updates, create fork and push maintained branch.
- [x] Core: shared bridge/URL/PlayerJS helpers; test exact season/episode/voices,
      serialized URLs, subtitles, errors, absolute URLs and native compatibility.
- [x] Group A: KinoVezha, Eneyida, KinoTron, Serialno; fixture tests and live probes.
- [x] Group B: KlonTV, CikavaIdeya, UFDub, SimpsonsUA; fixture tests and live probes.
- [x] Group C: UAFlix, UASerialsPro, BambooUA, DoramyWorld, Kinostrain;
      source-specific tests and live probes.
- [x] Build all manifests into .sky archives, verify every archive and catalog.
- [x] Run fixture suite, bounded live tests and real SkyStream native worker;
      report unavailable sites honestly without claiming physical playback.
- [ ] Review, update attribution/verification/install docs, publish, verify public
      URLs and CI. Existing installed repo URL must discover the new providers.
