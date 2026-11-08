import type { TranscribedChord, TranscribedNote, TranscriptionResult } from './transcription.ts';

export const SAMPLE_RATE = 22050;
export const FFT_HOP = 256;
export const WINDOW_SAMPLES = 43844;
export const OVERLAP_FRAMES = 30;
export const MODEL_SHA256 = '2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec';
const rounded = (value:number) => Math.round(value * 10000) / 10000;

/** Local maxima with conservative height, spacing, and prominence thresholds. */
export function onsetPeaks(values:Float32Array, stride=1, offset=0, length=Math.floor(values.length/stride)):number[] {
  const get=(index:number)=>values[index*stride+offset];
  const candidates:number[]=[];
  for(let i=1;i<length-1;i++) {
    const height=get(i);
    if(height<0.5||height<=get(i-1))continue;
    let right=i;
    while(right+1<length&&get(right+1)===height)right++;
    if(right+1>=length||get(right+1)>=height){i=right;continue;}
    const middle=Math.floor((i+right)/2);
    let leftMin=height,rightMin=height;
    for(let j=i-1;j>=0&&get(j)<=height;j--)leftMin=Math.min(leftMin,get(j));
    for(let j=right+1;j<length&&get(j)<=height;j++)rightMin=Math.min(rightMin,get(j));
    if(height-Math.max(leftMin,rightMin)>=0.1)candidates.push(middle);
    i=right;
  }
  const spacing=Math.max(1,Math.round(0.1/(FFT_HOP/SAMPLE_RATE)));
  const selected:number[]=[];
  // Match the peak-distance rule by retaining the strongest nearby onset.
  candidates.sort((a,b)=>get(b)-get(a)||b-a);
  for(const candidate of candidates)if(selected.every(index=>Math.abs(candidate-index)>=spacing))selected.push(candidate);
  return selected.sort((a,b)=>a-b);
}

/** Threshold model activations into note drafts; activation is not a probability. */
export function decodeNotes(frames:Float32Array,onsets:Float32Array,times:Float64Array,duration:number,pitchCount=88):TranscribedNote[] {
  if(!Number.isFinite(duration)||duration<=0||duration>60.1)throw new Error('Choose a passage of up to 60 seconds.');
  if(frames.length!==times.length*pitchCount||onsets.length!==frames.length)throw new Error('The model returned an unexpected activation shape.');
  const notes:TranscribedNote[]=[];
  if(times.length<2)return notes;
  const step=FFT_HOP/SAMPLE_RATE;
  for(let pitch=0;pitch<pitchCount;pitch++) {
    const active=new Uint8Array(times.length);
    for(let i=0;i<times.length;i++)active[i]=Number(frames[i*pitchCount+pitch]>=0.3);
    for(let i=1;i<active.length-1;i++)if(!active[i]&&active[i-1]&&active[i+1])active[i]=1;
    const peaks=onsetPeaks(onsets,pitchCount,pitch,times.length);
    let first=-1;
    for(let i=0;i<=active.length;i++) {
      if(i<active.length&&active[i]){if(first<0)first=i;continue;}
      if(first<0)continue;
      const boundaries=[first,...peaks.filter(p=>p>=first+5&&p<i-5),i];
      for(let part=0;part<boundaries.length-1;part++) {
        const left=boundaries[part],right=boundaries[part+1];
        const start=Math.max(0,times[left]),end=Math.min(duration,times[Math.min(right-1,times.length-1)]+step);
        if(end-start<0.1)continue;
        let sum=0;
        for(let frame=left;frame<right;frame++)sum+=frames[frame*pitchCount+pitch];
        const confidence=Math.min(1,Math.max(0,sum/(right-left)));
        if(confidence<0.4)continue;
        notes.push({midi:pitch+21,start:rounded(start),end:rounded(end),confidence:rounded(confidence)});
        if(notes.length>10000)throw new Error('This passage contains too many detected events. Try a shorter, clearer recording.');
      }
      first=-1;
    }
  }
  return notes.sort((a,b)=>a.start-b.start||a.midi-b.midi);
}

const CHORD_NAMES=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const TRIADS=new Map<string,string>();
for(let root=0;root<12;root++)for(const [suffix,intervals] of [['',[0,4,7]],['m',[0,3,7]]] as const) {
  TRIADS.set(intervals.map(n=>(n+root)%12).sort((a,b)=>a-b).join(','),CHORD_NAMES[root]+suffix);
}

/** Name only exact three-pitch-class major/minor overlaps; no forced harmonisation. */
export function chordSuggestions(notes:TranscribedNote[],duration:number):TranscribedChord[] {
  const changes=new Map<number,{add:number[];remove:number[]}>();
  const at=(time:number)=>{let change=changes.get(time);if(!change){change={add:[],remove:[]};changes.set(time,change);}return change;};
  at(0);at(duration);
  notes.forEach((note,index)=>{at(note.start).add.push(index);at(note.end).remove.push(index);});
  const times=[...changes.keys()].sort((a,b)=>a-b),active=new Map<number,TranscribedNote>();
  const suggestions:TranscribedChord[]=[];
  for(let i=0;i<times.length-1;i++) {
    const start=times[i],end=times[i+1],change=changes.get(start)!;
    change.remove.forEach(index=>active.delete(index));change.add.forEach(index=>active.set(index,notes[index]));
    if(end-start<0.025)continue;
    const voices=new Map<number,TranscribedNote>();
    for(const note of active.values()) {
      const pitchClass=note.midi%12,existing=voices.get(pitchClass);
      if(!existing||note.confidence>existing.confidence)voices.set(pitchClass,note);
    }
    if(voices.size!==3)continue;
    const key=[...voices.keys()].sort((a,b)=>a-b).join(','),label=TRIADS.get(key);
    if(!label)continue;
    const pitches=[...voices.values()].map(n=>n.midi).sort((a,b)=>a-b),confidence=Math.min(...[...voices.values()].map(n=>n.confidence));
    const last=suggestions[suggestions.length-1];
    if(last&&last.label===label&&last.notes!.join(',')===pitches.join(',')&&Math.abs(last.end-start)<0.03) {
      last.end=rounded(end);last.confidence=Math.min(last.confidence,confidence);
    }else suggestions.push({label,start:rounded(start),end:rounded(end),confidence,notes:pitches});
  }
  return suggestions.filter(chord=>chord.end-chord.start>=0.15);
}

export function createLocalResult(notes:TranscribedNote[],duration:number,sourceStart:number):TranscriptionResult {
  const warnings=[
    'Machine-generated draft: review notes and timing against the recording before practising.',
    'Best on a clear solo instrument. Mixed vocals, drums and accompaniment may produce missing, extra, or octave-shifted notes; the model does not isolate a lead melody.',
    'Activation values are signal strengths, not calibrated probabilities. Chord labels are conservative major/minor triad suggestions, not a verified arrangement.',
  ];
  if(!notes.length)warnings.unshift('No confident notes were found in this passage. Try a clearer recording or another range.');
  return {notes,chords:chordSuggestions(notes,duration),duration:rounded(duration),sourceStart,warnings};
}
