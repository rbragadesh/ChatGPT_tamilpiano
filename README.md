# Isai

**Tamil roots. Piano journeys.** A piano learning app for iPhone and desktop, with Western note names, movable Carnatic swaras, and an original guided-practice interface.

The complete app can be hosted on **GitHub Pages**. Audio transcription runs on the user's device with a WebAssembly model. The main app needs no Python server, account, API key, or paid transcription API.

## Develop and build

Use Node.js 24 and npm:

```sh
cd /workspace/ChatGPT_tamilpiano
npm ci --cache /tmp/isai-npm-cache
npm run dev -- --host 0.0.0.0
```

```sh
npm test
npm run build
npm run preview -- --host 0.0.0.0
```

`npm run dev` and `npm run build` first run `scripts/prepare-model.mjs`. It verifies the bundled model and original notices against pinned SHA-256 values, then copies the CPU ONNX Runtime assets from the locked npm installation into generated `public/onnx/`. It preserves full license notices for shipped modules in generated `public/licenses/`. Normal builds require no model download, Python, FFmpeg, or model server. Restore altered or missing committed model files from the repository rather than bypassing checksum verification.

The production build runs TypeScript, Vite, and `scripts/build-pwa.mjs`, which creates a versioned offline snapshot containing the app, model, runtime, icons, and attribution files. Same-origin paths work under GitHub Pages repository subpaths; no inference CDN is used. The CPU worker uses one WebAssembly thread, so Pages does not need custom cross-origin isolation headers.

## What is included

- Fourteen original guided melody, chord, rhythm, and note-reading exercises, with synthesized practice tones.
- A touch piano keyboard, computer-keyboard input, pitch-scored practice, and optional single-note microphone input.
- Western notes, numbered Carnatic swaras, and combined labels with a movable Sa.
- A searchable discovery catalogue of 449 Tamil song references across the requested composers and decades.
- A personal YouTube bookmark library with start/end times, official embedded playback, looping, and available playback speeds.
- On-device audio transcription, editable note drafts, and generated upper-voice, detected-note, or chord-suggestion studies.
- Browser-local progress and preferences, offline support, and an iPhone Home Screen manifest.

The catalogue contains factual metadata. It does not contain commercial recordings, lyrics, album artwork, commercial scores, or verified film-song lessons. Playable built-in exercises and their artwork are original. Isai is an independent project and does not copy Simply Piano's code, branding, or proprietary content.

## Transcribe audio on your device

1. Open **My clips**, save a YouTube link and timeframe, and open the clip. The link is a listening bookmark, not an audio source for the model.
2. Select a recording that you own or have permission to transcribe, and confirm that permission in the app. A keyboard recording of your own original exercise is a useful first test.
3. Select up to 60 seconds inside the audio file. If it is already trimmed, start at `0:00`. Files are limited to 25 MiB and ten minutes of source audio to control phone memory use. Browser codec support determines which files can be decoded; WAV, MP3, and M4A are useful starting formats on recent Safari.
4. Choose **Find notes on this device**. The browser decodes the selected recording and runs Basic Pitch in a background worker. The recording is not uploaded to a server. The first online visit downloads the model and a roughly 15 MB WebAssembly runtime from the same site.
5. Compare the draft with the original recording. Review the Western/Carnatic labels, remove unwanted events, or reset edits. Removing notes clears the original chord suggestions because those suggestions may no longer match the edited draft.
6. Save the draft to the clip, then choose **Practise saved draft**. Source timing, overlaps, repeated note attacks, and rests are retained. Guided scoring checks pitch; timing and expression are not graded.

The model estimates pitches and onsets. Clear solo piano works better than a full film mix. Vocals, percussion, layered instruments, effects, and gamakas can produce missed notes, extra harmonics, octave errors, or incorrect timing. The upper-voice study follows detected high pitches and may follow accompaniment rather than the main melody. Chord suggestions are conservative major/minor triads. Activation strengths are model signals, not probabilities of correctness. Review each draft before learning it; the app does not promise an exact transcription of every song.

Source recordings are not added to the saved library. Saved note events, clip metadata, and progress remain in the current browser's local storage and are removed if that website data is cleared. There is no cloud account or cross-device sync. A copied app URL does not share your imported recordings or local drafts.

## YouTube links and manual notation

The app uses YouTube's official embedded player or an external YouTube link, respecting available playback speeds and embedding restrictions. It does not download, extract, record, or bundle YouTube audio. Playback needs Internet access and can be restricted by the video's owner, region, or sign-in requirements. Pasting a YouTube URL alone does not produce a transcription; supply your own authorised audio file for local analysis.

You can also enter a manual melody in Western or Carnatic notation. For example, `C4 D4 E4 G4` and `S R2 G3 P` / `Sa Ri2 Ga3 Pa` identify the same reference pitches. An apostrophe raises the octave: `S'` is C5 and `S''` is C6. Changing input format converts valid notes. Shared chromatic swara positions use a canonical spelling when converting. Each manual token lasts one beat; the current text editor supports C4 through C6. The practice room can transpose the reference pitches with the selected tonic.

Western/Carnatic conversion is an equal-tempered keyboard aid. It does not determine a raga, reproduce gamakas, or replace a Carnatic teacher's guidance on intonation and phrasing.

## Publish on GitHub Pages

1. Commit the project, including `public/models/`, and push to the repository's `main` branch. Generated `public/onnx/`, `public/licenses/`, `node_modules/`, and `dist/` are not source files to commit.
2. In **GitHub → Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. The included **Deploy Isai to GitHub Pages** workflow installs the locked npm dependencies, verifies the model, runs tests, builds the complete static app, and deploys `dist`.
4. Use the HTTPS address from the successful deployment. Preparing these files alone does not publish a site.

There is no transcription service address to configure. GitHub Pages serves the application, worker, model, runtime, and notices. For a private repository, Pages availability depends on the GitHub plan.

## Install on iPhone

Open the published HTTPS site in recent Safari, tap **Share → Add to Home Screen → Add**, and keep **Open as Web App** enabled if offered. Open it online once and allow the initial offline snapshot to finish. Portrait supports short sessions; landscape gives the piano keyboard more space.

After the production snapshot is cached, built-in practice, saved drafts, and local transcription can work offline. YouTube playback and external links need Internet access. Runtime support and audio formats depend on the browser; actual Safari-device checks remain useful even when responsive Chromium tests pass.

## Content and open-source attribution

- Included music exercises, practice tones, and abstract artwork are original. Song/composer names are factual references, not evidence that a recording or arrangement is licensed for redistribution.
- Import only audio you own or have permission to transcribe. The permission confirmation does not itself grant rights to another person's work. Do not add commercial recordings, lyrics, scores, or user-imported audio to this repository.
- Basic Pitch's ONNX model is copyright Spotify AB, Apache License 2.0. Its complete original license and notice are preserved in `public/models/LICENSE` and `public/models/NOTICE`. Its training and test recordings are not included.
- ONNX Runtime Web 1.31.1 is copyright Microsoft Corporation, MIT licensed. The exact release's MIT license and full third-party notices are bundled. The runtime is used through its CPU-only WASM entry; the separate ONNX.js/WebGL implementation is not shipped.
- React, React DOM, and Scheduler use MIT licenses; Lucide uses ISC. Generated `public/licenses/index.json` lists shipped dependency versions and the full notice files.

The deployed [credits and content page](public/credits.html) exposes these terms and notices to users. Full film-song lessons or publicly shared transcriptions should be added only with the necessary rights and musical verification.

## Validation and environment notes

`npm test` runs portable unit and packaging checks. Browser tests use the cloud image's Python Playwright and `/usr/bin/chromium`; they are development checks, not app runtime dependencies. `tests/browser-learning.py` checks guided lessons, notation, catalogue filtering, and progress. `tests/browser-clips-pwa.py` checks personal clips, manual notation, official-player controls through a test double, and actual offline operation at a Pages subpath. Local-model browser checks use generated original audio and the real WebAssembly runtime, without distributing commercial song samples.

Each Codex cloud task is isolated. Use the existing checkout and do not create a Git worktree unless explicitly requested. In this cloud environment, use `/tmp/isai-npm-cache` because the default home npm cache is not writable. GitHub Actions can use ordinary `npm ci`. Restart development servers in a new task; installed files do not retain processes.

`service/` retains an earlier optional Python transcription implementation for development comparison. It is not used by the main browser app and is not deployed by the Pages workflow. It can be tested separately using its own README. No service hosting or credentials are required for the GitHub Pages workflow described here.

## Learning levels and Tamil song studies

The catalogue has **449 song references** across the six requested composers, spanning1976–2017. The300 researched additions use a CC0 factual metadata dataset with source links;131 existing references and18 additional curated favourites are retained. See [content-source research](docs/content-sources.md). These entries do not include commercial audio, lyrics, or movie-song scores. Online note repositories examined did not establish the rights needed to redistribute their film music, so their notes were not copied.

Five learning stages require at least80% pitch accuracy in every exercise before the next stage opens. The Practice room contains the learning path and song catalogue. At Level2, choose a song and create a private study with your own authorised notation or local audio. A YouTube link is optional. Chord, rhythm, range, and combined-note complexity can require later levels; the estimate uses the study's actual notes, not the song title or composer. These milestones grade exercise pitches, not musical proficiency or expression.

Both manual notation and local audio analysis require permission confirmation. Notes stay on the device. Full film scores can only be bundled after the necessary composition and arrangement permissions are verified.

## Top100 and MuseScore

The library includes a **Top100 picks** filter:25 songs each for Ilaiyaraaja, A.R.Rahman, Yuvan Shankar Raja and Vidyasagar. This is an editorial listening selection, not a chart ranking. [The full list](docs/top100-tamil-songs.md) includes MuseScore search links. Song details provide the same external search. These are not verified score matches; no MuseScore notes have been copied. [The source-check report](docs/musescore-research.md) records the current proxy denial. Any publicly bundled score needs permission covering the underlying composition and the arrangement, while private imported notes require the user’s rights confirmation.
