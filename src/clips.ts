import { parseTranscriptionResult } from './transcription.ts';
import type { TranscriptionMode, TranscriptionResult } from './transcription.ts';
/** Personal clips contain links, note drafts, and user-authored notes, never downloaded audio. */
export interface SavedClip {
  id: string;
  title: string;
  videoId: string;
  songId?: string;
  start: number;
  end: number;
  notes: string;
  bpm: number;
  createdAt: number;
  transcription?: TranscriptionResult;
  transcriptionMode?: TranscriptionMode;
}

export const CLIPS_STORAGE_KEY = 'isai-clips-v1';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_CLIP_SECONDS = 3600;

/** Integer seconds, M:SS, H:MM:SS, or YouTube-style 1h2m3s. */
export function parseTimestamp(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  let seconds: number;
  if (/^\d+$/.test(text)) {
    seconds = Number(text);
  } else if (/^\d+:\d{1,2}(?::\d{1,2})?$/.test(text)) {
    const parts = text.split(':').map(Number);
    if (parts.slice(1).some(part => part >= 60)) return null;
    seconds = parts.reduce((total, part) => total * 60 + part, 0);
  } else {
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
    if (!match || !match.slice(1).some(Boolean)) return null;
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  }
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const s = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}`
    : `${minutes}:${s}`;
}

/** Accept only official YouTube URL shapes; embed URLs are always built from the validated ID. */
export function parseYouTubeUrl(raw: string): { videoId: string; start?: number } | null {
  try {
    const text = raw.trim();
    if (!text) return null;
    const candidate = /^[A-Za-z][A-Za-z\d+.-]*:/.test(text) ? text : `https://${text}`;
    const url = new URL(candidate);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let videoId: string | null = null;
    if (host === 'youtu.be') {
      const match = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
      videoId = match?.[1] ?? null;
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      if (/^\/watch\/?$/.test(url.pathname)) videoId = url.searchParams.get('v');
      else videoId = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
    }
    if (!videoId || !VIDEO_ID.test(videoId)) return null;
    const fragment = new URLSearchParams(url.hash.slice(1));
    const rawStart = url.searchParams.get('start') ?? url.searchParams.get('t') ?? fragment.get('t');
    if (rawStart !== null) {
      const start = parseTimestamp(rawStart);
      return start === null ? null : { videoId, start };
    }
    return { videoId };
  } catch {
    return null;
  }
}

/** Parse equal-tempered Western pitches; chromatic notes are absolute MIDI pitches. */
export function parseNoteTokens(raw: string): number[] | null {
  const text = raw.trim();
  if (!text || text.length > 4096) return null;
  const tokens = text.split(/[\s,]+/);
  if (tokens.length > 128 || tokens.some(token => !token)) return null;
  const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const notes: number[] = [];
  for (const token of tokens) {
    const match = /^([A-Ga-g])([#b♯♭]?)([3-6])$/.exec(token);
    if (!match) return null;
    const accidental = ['#', '♯'].includes(match[2]) ? 1 : ['b', '♭'].includes(match[2]) ? -1 : 0;
    const midi = (Number(match[3]) + 1) * 12 + natural[match[1].toUpperCase()] + accidental;
    if (midi < 48 || midi > 95) return null;
    notes.push(midi);
  }
  return notes;
}

/** Carnatic keyboard reference with Sa=C4; apostrophes raise a swara by an octave. */
export function parseSwaraTokens(raw: string): number[] | null {
  const text = raw.trim().replace(/[’′]/g, "'").replace(/[₁₂₃]/g, digit => ({ '₁': '1', '₂': '2', '₃': '3' })[digit] ?? digit);
  if (!text || text.length > 4096) return null;
  const tokens = text.split(/[\s,]+/);
  if (tokens.length > 128 || tokens.some(token => !token)) return null;
  const intervals: Record<string, number> = {
    s: 0, sa: 0, r1: 1, ri1: 1, r2: 2, ri2: 2, r3: 3, ri3: 3,
    g1: 2, ga1: 2, g2: 3, ga2: 3, g3: 4, ga3: 4,
    m1: 5, ma1: 5, m2: 6, ma2: 6, p: 7, pa: 7,
    d1: 8, dha1: 8, d2: 9, dha2: 9, d3: 10, dha3: 10,
    n1: 9, ni1: 9, n2: 10, ni2: 10, n3: 11, ni3: 11,
  };
  const notes: number[] = [];
  for (const token of tokens) {
    const match = /^([a-z]+[1-3]?)('{0,2})$/i.exec(token);
    if (!match || !Object.hasOwn(intervals, match[1].toLowerCase())) return null;
    const midi = 60 + intervals[match[1].toLowerCase()] + match[2].length * 12;
    if (midi > 84) return null;
    notes.push(midi);
  }
  return notes;
}

/** A canonical spelling for the equal-tempered pitches shared by several swaras. */
export function formatSwaraTokens(notes: number[]): string {
  const names = ['S', 'R1', 'R2', 'G2', 'G3', 'M1', 'M2', 'P', 'D1', 'D2', 'N2', 'N3'];
  if (notes.some(note => !Number.isInteger(note) || note < 60 || note > 84)) return '';
  return notes.map(note => names[(note - 60) % 12] + "'".repeat(Math.floor((note - 60) / 12))).join(' ');
}

export function formatWesternTokens(notes: number[]): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  if (notes.some(note => !Number.isInteger(note) || note < 48 || note > 95)) return '';
  return notes.map(note => names[note % 12] + (Math.floor(note / 12) - 1)).join(' ');
}

function validClip(value: unknown): value is SavedClip {
  if (!value || typeof value !== 'object') return false;
  const clip = value as Record<string, unknown>;
  return typeof clip.id === 'string' && clip.id.length > 0 && clip.id.length <= 128
    && typeof clip.title === 'string' && clip.title.trim().length > 0 && clip.title.length <= 160
    && typeof clip.videoId === 'string' && (clip.videoId === '' || VIDEO_ID.test(clip.videoId))
    && (clip.songId === undefined || (typeof clip.songId === 'string' && clip.songId.length > 0 && clip.songId.length <= 200))
    && typeof clip.start === 'number' && Number.isSafeInteger(clip.start) && clip.start >= 0
    && typeof clip.end === 'number' && Number.isSafeInteger(clip.end) && clip.end > clip.start
    && clip.end - clip.start <= MAX_CLIP_SECONDS
    && typeof clip.notes === 'string' && clip.notes.length <= 4096
    && (clip.bpm === undefined || (typeof clip.bpm === 'number' && Number.isFinite(clip.bpm) && clip.bpm >= 30 && clip.bpm <= 200))
    && typeof clip.createdAt === 'number' && Number.isFinite(clip.createdAt) && clip.createdAt >= 0;
}

export function loadClips(): SavedClip[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(CLIPS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.filter(validClip).filter(clip => {
      if (seen.has(clip.id)) return false;
      seen.add(clip.id);
      return true;
    }).map(clip => ({
      id: clip.id, title: clip.title, videoId: clip.videoId, start: clip.start,
      end: clip.end, notes: clip.notes, bpm: clip.bpm ?? 76, createdAt: clip.createdAt,
      ...(clip.songId ? {songId:clip.songId} : {}),
      ...savedDraft(clip),
    }));
  } catch {
    // Private browsing/storage restrictions should never stop the app rendering.
    return [];
  }
}

export function saveClips(clips: SavedClip[]): void {
  if (!clips.every(validClip)) throw new Error('A clip contains invalid metadata.');
  clips.forEach(clip => { if (clip.transcription) parseTranscriptionResult(clip.transcription); });
  // Surface quota/security errors so the UI never claims an unsaved change succeeded.
  localStorage.setItem(CLIPS_STORAGE_KEY, JSON.stringify(clips));
}

function savedDraft(clip: SavedClip): Partial<SavedClip> {
  if (!clip.transcription) return {};
  try {
    return {transcription:parseTranscriptionResult(clip.transcription), transcriptionMode:['melody','chords','detected'].includes(clip.transcriptionMode || '')?clip.transcriptionMode:'melody'};
  } catch {
    // A damaged draft should never discard an otherwise valid saved clip.
    return {};
  }
}
