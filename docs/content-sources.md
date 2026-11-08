# Tamil catalogue and note-source audit — 2026-11-07

## Added factual metadata

- Dataset: https://github.com/rajkumar-dhanasekaran/tamil-film-songs-metadata
- Pinned revision: `52a6b87ab5d2f2beafd04f97dda65ac2583d5663`
- Dataset file: https://raw.githubusercontent.com/rajkumar-dhanasekaran/tamil-film-songs-metadata/52a6b87ab5d2f2beafd04f97dda65ac2583d5663/data/songs.csv
- Licence: CC0 1.0 Universal, read at https://raw.githubusercontent.com/rajkumar-dhanasekaran/tamil-film-songs-metadata/52a6b87ab5d2f2beafd04f97dda65ac2583d5663/LICENSE
- README says 3,033 researched metadata rows; high/medium/low confidence and per-credit sources are explicit. Metadata only: no file paths, recordings, lyrics, scores, or note events are included.
- App selection: 300 source-high-confidence titles from requested composers, familiar Tamil films and years1970–2020; exclude flagged score cues, themes, remix duplicates, non-Tamil indicators, and known ambiguous unreleased films. Some transliteration spellings are shortened or variant; source confidence is the source author's assessment, not a new independent musicological verification.
- Existing131 curated IDs retained unchanged. Total431 unique references,1976–2017. Requested composer counts: Ilaiyaraaja119, A.R.Rahman105, Harris68, Yuvan75, Bharathwaj25, Vidyasagar39.
- No2018–2020 rows for these six composers exist in this dataset, so no later hits were invented or misattributed to it.
- Each entry is explicitly `notationStatus:'reference'`. CC0 metadata is not a licence to redistribute the film's composition, arrangement, lyrics, or recording.

## Online note sources inspected, not imported

1. https://github.com/hhsudhanv/MettuKudam — main revision `e93cc956eb3126e6abc8c3927c7f6664ff8df3f2`; no LICENSE or README. `scrape_notes.py` says it scrapes/backups `https://www.newtfmpage.com/notes/`. No composition or transcription redistribution permission established.
2. https://github.com/psaktheeswaran/Tamil-Arduino-piano-Tamil-songs-in-Arduino — revision `04f1a4c828d27ee22c8c6c209532107617b5807b`; Apache2.0 repository code licence. Contains named commercial-song melody files. README provides technical Arduino references; no permission from the film-composition rights holders was verified. Code licence does not establish those musical rights.
3. https://github.com/VikneshVK/Piano-Tiles-with-Tamilsong — Apache2.0 code repository; no composition authorization verified.
4. https://github.com/Rel10Jayaraj/Advanced-Chords-Reharmonizer-Any-Song- — tool rather than licensed song corpus. README's legal/ethical notes explicitly warn against redistributing scraped content.

Direct requests to newtfmpage.com/notes/, keylessonline.com/song/tamil/keyboard.html, and keyboardnotes.in were denied by the environment proxy (CONNECT403), so their terms could not be inspected. GitHub searches found no results for Tamil piano notes license / AR Rahman piano license / Tamil MusicXML; later searches were rate-limited429 and stopped. These checks do not establish that no authorized source exists elsewhere.

## Outstanding score requirement

No modern film-song score source was verified to cover both the transcription/arrangement and the underlying composition for redistribution in a public app. Do not represent these431 metadata references as playable full song lessons. To add actual song notation, obtain documentary authorization or a verified public-domain basis, or let the user attach their own authorized private transcription/local-audio draft. Skill-gate labels are preparatory paths, not verified song difficulty analysis.

CC0 licence downloaded SHA256: `27512118299cf721a4ba6ac12d212ad7dddf96cba0a4e0425c73b62e3021b97b`. Full text retained at `/tmp/isai-source-1.txt`.

## Top100 follow-up

The Top100 editorial collection adds18 curated factual song references, bringing the current total to449. These18 are not labelled as imported CC0 records. Their film-reference links are not claims of newly verified score availability or music permissions. All100 MuseScore URLs are search links; the current network check returned proxy CONNECT403, not score content. No MuseScore notation was copied.
