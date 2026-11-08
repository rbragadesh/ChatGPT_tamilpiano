import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimestamp, formatTimestamp, parseYouTubeUrl, parseNoteTokens, parseSwaraTokens, formatSwaraTokens, formatWesternTokens, loadClips, saveClips, CLIPS_STORAGE_KEY } from '../src/clips.ts';

test('timestamps accept clock/YouTube forms and reject malformed or unsafe values', () => {
  for (const [input, expected] of [['75', 75], ['1:15', 75], ['01:15', 75], ['1:02:03', 3723], ['1h2m3s', 3723], ['75s', 75], ['1m15s', 75], ['0:00', 0]]) {
    assert.equal(parseTimestamp(input), expected, input);
  }
  for (const input of ['', '-1', '1.5', '1:60', '1:60:00', '1::2', '1m x', 'NaN', '1e3', '9007199254740992']) assert.equal(parseTimestamp(input), null, input);
  assert.equal(formatTimestamp(75), '1:15');
  assert.equal(formatTimestamp(3723), '1:02:03');
});

test('YouTube URL parser preserves valid IDs and start offsets across supported URL forms', () => {
  const id = 'AbCdEfG_1-2';
  for (const url of [`https://youtube.com/watch?v=${id}`, `https://www.youtube.com/watch?v=${id}`, `https://m.youtube.com/watch?v=${id}`, `https://music.youtube.com/watch?v=${id}`, `youtu.be/${id}`, `https://youtube.com/shorts/${id}`, `https://youtube.com/live/${id}`, `https://www.youtube.com/embed/${id}`]) {
    assert.deepEqual(parseYouTubeUrl(url), { videoId: id }, url);
  }
  assert.deepEqual(parseYouTubeUrl(`https://youtu.be/${id}?t=1m15s`), { videoId: id, start: 75 });
  assert.deepEqual(parseYouTubeUrl(`https://youtube.com/watch?v=${id}&start=62`), { videoId: id, start: 62 });
  assert.deepEqual(parseYouTubeUrl(`https://youtube.com/watch?v=${id}#t=01:15`), { videoId: id, start: 75 });
});

test('YouTube URL parser rejects lookalike origins, credentials, arbitrary paths, and malformed IDs', () => {
  const id = 'AbCdEfG_1-2';
  for (const url of [`https://youtube.com.evil.test/watch?v=${id}`, `https://evil.test/?v=${id}`, `https://youtube.com@evil.test/watch?v=${id}`, `https://user:pass@youtube.com/watch?v=${id}`, `javascript:alert(1)`, `https://youtube.com:8443/watch?v=${id}`, `https://youtube.com/playlist?v=${id}`, `https://youtu.be/short`, `https://youtu.be/${id}/extra`, `https://youtube.com/watch?v=${id}&t=-1`]) {
    assert.equal(parseYouTubeUrl(url), null, url);
  }
});

test('note parser preserves enharmonic pitches and rejects invalid/out-of-range notes', () => {
  assert.deepEqual(parseNoteTokens('C4 D#4, Eb4 F♯4 Gb4 a3'), [60, 63, 63, 66, 66, 57]);
  assert.deepEqual(parseNoteTokens('C3 B6'), [48, 95]);
  for (const notes of ['', 'C2', 'C7', 'H4', 'C4<script>', 'B#6', 'Cb3', Array(129).fill('C4').join(' ')]) assert.equal(parseNoteTokens(notes), null, notes);
});

test('Carnatic swaras convert to keyboard pitches with numbered variants and upper octaves', () => {
  assert.deepEqual(parseSwaraTokens("S R2 G3 M1 P D2 N3 S'"), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.deepEqual(parseSwaraTokens("Sa, Ri2 Ga3 Ma1 Pa Dha2 Ni3 Sa''"), [60, 62, 64, 65, 67, 69, 71, 84]);
  assert.deepEqual(parseSwaraTokens('R1 R2 R3 G1 G2 G3 M1 M2 D1 D2 D3 N1 N2 N3'), [61, 62, 63, 62, 63, 64, 65, 66, 68, 69, 70, 69, 70, 71]);
  assert.deepEqual(parseSwaraTokens('R₂ Ga₃ Sa′'), [62, 64, 72]);
  for (const input of ['', 'R', 'G', 'M', 'D', 'N', 'R4', 'Sa1', "R1''", "S'''", 'C4', Array(129).fill('S').join(' ')]) assert.equal(parseSwaraTokens(input), null, input);
});

test('canonical swara formatting round-trips all supported pitches', () => {
  const pitches = Array.from({ length: 25 }, (_, index) => index + 60);
  assert.deepEqual(parseSwaraTokens(formatSwaraTokens(pitches)), pitches);
  assert.equal(formatSwaraTokens([60, 62, 64, 72, 84]), "S R2 G3 S' S''");
  assert.equal(formatSwaraTokens([59]), '');
  assert.deepEqual(parseNoteTokens(formatWesternTokens(pitches)), pitches);
  assert.equal(formatWesternTokens([60, 61, 72]), 'C4 C#4 C5');
});

test('clip storage filters malformed entries, deduplicates, and reports failed writes', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage);
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
  const clip = { id: 'clip-1', title: 'My melody reference', videoId: 'AbCdEfG_1-2', start: 60, end: 90, notes: '', bpm: 76, createdAt: 1 };
  saveClips([clip]);
  assert.deepEqual(loadClips(), [clip]);
  const privateStudy={...clip,id:'private-song',videoId:'',songId:'vaseegara-minnale-2001',notes:'C4 D4 E4'};
  saveClips([privateStudy]);
  assert.deepEqual(loadClips(),[privateStudy], 'Private studies retain their catalogue link without a YouTube video');
  assert.throws(()=>saveClips([{...clip,songId:42}]),/invalid/);
  const transcription = {notes:[{midi:60,start:0.25,end:0.75,confidence:0.8}], chords:[], duration:1, sourceStart:60, warnings:['Review this draft.']};
  saveClips([{...clip, transcription, transcriptionMode:'detected'}]);
  assert.deepEqual(loadClips()[0].transcription, transcription);
  assert.equal(loadClips()[0].transcriptionMode, 'detected');
  values.set(CLIPS_STORAGE_KEY, JSON.stringify([{...clip,transcription:{notes:'broken'}}]));
  assert.deepEqual(loadClips(), [clip], 'Damaged optional draft must preserve the reference clip');
  const { bpm, ...oldClip } = clip;
  values.set(CLIPS_STORAGE_KEY, JSON.stringify([oldClip]));
  assert.deepEqual(loadClips(), [clip]);
  values.set(CLIPS_STORAGE_KEY, JSON.stringify([clip, clip, { ...clip, id: 'bad', videoId: 'invalid' }, { ...clip, id: 'long', end: 4000 }]));
  assert.deepEqual(loadClips(), [clip]);
  values.set(CLIPS_STORAGE_KEY, 'not json');
  assert.deepEqual(loadClips(), []);
  assert.throws(() => saveClips([{ ...clip, end: 30 }]), /invalid/);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } } });
  assert.deepEqual(loadClips(), []);
  assert.throws(() => saveClips([clip]), /quota/);
});
