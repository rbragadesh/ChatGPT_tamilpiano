# MuseScore source check

Checked on 8 November 2026 for the requested Tamil piano song collection.

## Result

The current cloud network policy prevented access to MuseScore. This is an access blocker, not a finding about whether suitable scores exist.

| Requested page | Observed result | What was verified |
| --- | --- | --- |
| `https://musescore.com/sheetmusic?text=Ilaya%20Nila%20piano` | `curl: (56) CONNECT tunnel failed, response 403`; proxy response `HTTP/1.1 403 Forbidden`, `server: envoy` | The proxy denied the HTTPS connection before a MuseScore page was received. |

No HTML, score notation, audio, MusicXML, MIDI, PDF, or SVG score pages were retrieved. No MuseScore score matches or licences were verified. In particular, a generated MuseScore search URL must not be labelled as a found score or an available piano arrangement.

The repository's environment draft includes `musescore.com` and `www.musescore.com`. Saved draft settings are distinct from the running environment's enforced policy. After the settings are applied, retry with a fresh connection and inspect the actual score page.

## Copyright requirements for importing notation

The song shortlist is editorial metadata. A song title and a search link do not establish that a score exists or that it may be copied into this app.

For every actual match, record the score URL, title, arranger/uploader, instrumentation, applicable access conditions, licence or permission evidence, and verification date. Distinguish:

- A publicly visible score page or search result.
- Permission to view or use a downloaded score personally.
- Permission to redistribute its arrangement and underlying composition in a public app.

Only the last category can support bundling the notation into the published app. An uploader's software licence or a general website subscription must not be treated as permission from the underlying composition's rights holder. Do not bypass login, payment controls, or download restrictions.

Until those checks are possible, the app can show clearly labelled MuseScore search links and let a user add their own authorised private notation. It must not claim that MuseScore notes were imported, that a score was verified, or that modern film-song notation is freely redistributable.
