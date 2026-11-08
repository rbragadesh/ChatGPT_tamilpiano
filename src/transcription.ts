import type { SavedClip } from './clips.ts';
import type { Lesson } from './lessons.ts';

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_EXCERPT_SECONDS = 60;
export const SERVICE_URL_KEY = 'isai-transcription-url';
export type TranscriptionMode = 'melody' | 'chords' | 'detected';
export interface TranscribedNote { midi: number; start: number; end: number; confidence: number }
export interface TranscribedChord { label: string; start: number; end: number; confidence: number; notes?: number[] }
export interface TranscriptionResult {
  notes: TranscribedNote[];
  chords: TranscribedChord[];
  duration: number;
  sourceStart: number;
  warnings: string[];
}
export interface TranscriptionJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result?: TranscriptionResult;
  error?: string;
}

export function normalizeServiceUrl(value: string): string {
  const url = new URL(value.trim());
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Use an HTTPS service address. HTTP is supported only for localhost development.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Use the service base address without credentials, a query, or a fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

export function defaultServiceUrl(): string {
  try {
    const saved = localStorage.getItem(SERVICE_URL_KEY);
    if (saved) return saved;
  } catch { /* The URL can still be entered for the current visit. */ }
  return typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    ? 'http://127.0.0.1:8000' : '';
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function pitches(value: unknown): value is number[] { return Array.isArray(value) && value.length > 0 && value.length <= 88 && value.every(n => Number.isInteger(n) && n >= 21 && n <= 108); }
function eventRange(event: Record<string, unknown>, duration: number) {
  return finite(event.start) && finite(event.end) && event.start >= 0 && event.start < duration && event.end > event.start && event.end <= duration + 0.05
    && finite(event.confidence) && event.confidence >= 0 && event.confidence <= 1;
}

/** Validate untrusted service responses before storing them or creating playable lessons. */
export function parseTranscriptionResult(value: unknown): TranscriptionResult {
  if (!record(value) || !finite(value.duration) || value.duration <= 0 || value.duration > MAX_EXCERPT_SECONDS + 0.1
    || !finite(value.sourceStart) || value.sourceStart < 0 || !Array.isArray(value.notes) || value.notes.length > 10000
    || !Array.isArray(value.chords) || value.chords.length > 1000 || !Array.isArray(value.warnings)
    || value.warnings.length > 100 || !value.warnings.every(w => typeof w === 'string' && w.length <= 2000)) {
    throw new Error('The note analysis returned an invalid result.');
  }
  const duration = value.duration;
  const notes = value.notes.map(note => {
    if (!record(note) || !Number.isInteger(note.midi) || (note.midi as number) < 21 || (note.midi as number) > 108 || !eventRange(note, duration)) {
      throw new Error('The note analysis returned an invalid note event.');
    }
    return { midi: note.midi as number, start: note.start as number, end: Math.min(note.end as number, duration), confidence: note.confidence as number };
  }).sort((a,b) => a.start - b.start || a.midi - b.midi);
  const chords = value.chords.map(chord => {
    if (!record(chord) || typeof chord.label !== 'string' || !chord.label || chord.label.length > 100 || !eventRange(chord, duration)
      || (chord.notes !== undefined && !pitches(chord.notes))) {
      throw new Error('The note analysis returned an invalid chord event.');
    }
    return { label: chord.label, start: chord.start as number, end: Math.min(chord.end as number, duration), confidence: chord.confidence as number,
      ...(chord.notes ? { notes: [...new Set(chord.notes as number[])].sort((a,b) => a-b) } : {}) };
  }).sort((a,b) => a.start-b.start);
  return { notes, chords, duration, sourceStart: value.sourceStart, warnings: [...value.warnings] as string[] };
}

export function parseTranscriptionJob(value: unknown): TranscriptionJob {
  if (!record(value) || typeof value.id !== 'string' || !/^[A-Za-z\d_-]{1,128}$/.test(value.id)
    || !['queued', 'processing', 'completed', 'failed'].includes(value.status as string)) {
    throw new Error('The transcription service returned an invalid job response.');
  }
  if (value.status === 'completed' && value.result === undefined) throw new Error('The completed transcription has no result.');
  return { id: value.id, status: value.status as TranscriptionJob['status'],
    ...(value.result !== undefined ? { result: parseTranscriptionResult(value.result) } : {}),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0,2000) } : {}) };
}

/** Keep source timing and overlapping pitches. Melody mode is deliberately an upper-voice estimate. */
export function transcriptionToLesson(clip: SavedClip, value: TranscriptionResult, mode: TranscriptionMode = 'melody'): Lesson {
  const result = parseTranscriptionResult(value);
  const bpm = Math.min(200, Math.max(30, clip.bpm));
  const events: {start:number;end:number;notes:number[]}[] = mode === 'chords'
    ? result.chords.filter(c => c.notes?.length).map(c => ({start:c.start,end:c.end,notes:c.notes!}))
    : result.notes.map(n => ({start:n.start,end:n.end,notes:[n.midi]}));
  if (!events.length) throw new Error(mode === 'chords' ? 'No playable chord suggestions were detected. Try the detected notes instead.' : 'No playable notes were detected. Try a clearer or shorter recording.');
  const changes=new Map<number,{add:number[];remove:number[]}>();
  const changeAt=(time:number)=>{let change=changes.get(time);if(!change){change={add:[],remove:[]};changes.set(time,change);}return change;};
  changeAt(0);changeAt(result.duration);
  for(const event of events){changeAt(event.start).add.push(...event.notes);changeAt(event.end).remove.push(...event.notes);}
  const times=[...changes.keys()].sort((a,b)=>a-b),active=new Map<number,number>();
  const segments: {notes:number[];seconds:number}[] = [];
  for (let i=0; i<times.length-1; i++) {
    const from=times[i],to=times[i+1],change=changes.get(from)!;
    for(const note of change.remove){const count=(active.get(note)||0)-1;if(count>0)active.set(note,count);else active.delete(note);}
    for(const note of change.add)active.set(note,(active.get(note)||0)+1);
    if (to-from < 0.0001) continue;
    let notes=[...active.keys()].sort((a,b)=>a-b);
    if (mode==='melody' && notes.length) notes=[notes[notes.length-1]];
    const last=segments[segments.length-1];
    const rearticulated=change.add.some(note=>notes.includes(note));
    if(last && !rearticulated && last.notes.join(',')===notes.join(','))last.seconds+=to-from;
    else segments.push({notes,seconds:to-from});
  }
  const modeName = mode==='melody'?'Upper-voice study':mode==='chords'?'Chord suggestions':'Detected-note study';
  return { id: `clip-${clip.id}-${mode}`, title: clip.title, subtitle: modeName, source: 'transcription',
    description: mode==='melody'?'An approximate upper-voice line selected from the detected pitches. This may follow accompaniment or harmonics rather than the main melody. Review it against the recording.'
      : mode==='chords'?'Estimated chord shapes from your selected audio. They are suggestions to review, rather than a verified harmonic analysis.'
      :'An automatic draft of detected pitches and their timing. Mixed instruments, vocals, and overtones can produce missing or extra notes. Review the result before learning it.',
    category: mode==='chords'?'chords':'melody', level:'Developing', duration:`${Math.max(1,Math.ceil(result.duration/60))} min`, bpm, meter:4,
    steps:segments.map(s=>({notes:s.notes.map(n=>n-60),beats:s.seconds*bpm/60})),
    tips:['Listen to the original passage slowly and compare each phrase with this draft.', 'Gaps in the detected audio are preserved as rests. Pitch accuracy is scored; timing and expression are not graded.', 'Source pitches use C as the reference Sa. Your selected tonic transposes the exercise; automatic transcription does not determine a raga.'] };
}
