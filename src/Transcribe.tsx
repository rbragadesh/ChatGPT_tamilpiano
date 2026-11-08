import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleHelp, FileAudio, LoaderCircle, Radio, RotateCcw, Trash2, FolderOpen, X } from 'lucide-react';
import type { SavedClip } from './clips';
import { formatTimestamp, parseTimestamp } from './clips';
import { noteName, westernName } from './music';
import { MAX_AUDIO_BYTES, MAX_EXCERPT_SECONDS, parseTranscriptionResult } from './transcription';
import { transcribeLocal } from './local-transcription';
import type { TranscriptionMode, TranscriptionResult } from './transcription';
import './Transcribe.css';

interface Props { clip: SavedClip; onApply: (result: TranscriptionResult, mode?: TranscriptionMode) => void }
interface ActiveRequest { controller: AbortController }

export function Transcribe({clip,onApply}:Props) {
  const [file,setFile]=useState<File|null>(null);
  const [hasPermission,setHasPermission]=useState(false);
  const [preview,setPreview]=useState('');
  const [start,setStart]=useState(formatTimestamp(clip.start));
  const [end,setEnd]=useState(formatTimestamp(Math.min(clip.end,clip.start+MAX_EXCERPT_SECONDS)));
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState(''),[error,setError]=useState('');
  const [result,setResult]=useState<TranscriptionResult|null>(()=>{try{return clip.transcription?parseTranscriptionResult(clip.transcription):null;}catch{return null;}});
  const [mode,setMode]=useState<TranscriptionMode>(clip.transcriptionMode||'melody');
  const [visibleEvents,setVisibleEvents]=useState(80);
  const receivedDraft=useRef<TranscriptionResult|null>(result);
  const active=useRef<ActiveRequest|null>(null);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current?.controller.abort();active.current=null;};},[]);
  useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  function chooseFile(value:File|null) {
    setError('');setStatus('');setResult(null);receivedDraft.current=null;setFile(null);setHasPermission(false);
    if(!value)return;
    if(value.size>MAX_AUDIO_BYTES){setError('Choose an audio file no larger than 25 MiB. Export a shorter passage if needed.');return;}
    if(!value.size){setError('This file is empty. Choose an audio recording.');return;}
    if(!/\.(wav|mp3|m4a|flac|ogg|aac|mp4|aiff?|webm|opus)$/i.test(value.name)&&!value.type.startsWith('audio/')){setError('Choose an audio recording such as WAV, MP3, M4A, FLAC, or OGG.');return;}
    setFile(value);
  }
  function cancel() {
    active.current?.controller.abort();active.current=null;setBusy(false);setStatus('Stopped. Your recording stays on this device.');
  }
  async function transcribe(event:React.FormEvent) {
    event.preventDefault();
    if(active.current)return;
    setError('');
    const from=parseTimestamp(start),to=parseTimestamp(end);
    if(!file){setError('Choose the audio recording you want to analyse.');return;}
    if(!hasPermission){setError('Confirm that you have the rights or permission needed to transcribe this recording and its music.');return;}
    if(from===null||to===null||to<=from||to-from>MAX_EXCERPT_SECONDS){setError('Choose a valid passage of up to 60 seconds. Start and end are positions in your audio file.');return;}
    const run:ActiveRequest={controller:new AbortController()};active.current=run;
    setResult(null);receivedDraft.current=null;setBusy(true);setStatus('Preparing your recording on this device…');
    try {
      const draft=parseTranscriptionResult(await transcribeLocal(file,from,to,{
        signal:run.controller.signal,
        onProgress:(message:string)=>{if(mounted.current&&active.current===run&&!run.controller.signal.aborted)setStatus(message);},
      }));
      if(run.controller.signal.aborted||!mounted.current||active.current!==run)return;
      receivedDraft.current=draft;setVisibleEvents(80);setResult(draft);
      setStatus(draft.notes.length?'Your draft is ready to review.':'No note events were detected. Try a clearer recording or another passage.');
    }catch(error){
      if(mounted.current&&active.current===run&&!run.controller.signal.aborted)setError(error instanceof Error?error.message:'This recording could not be analysed. Try a short MP3 or WAV file.');
    }finally{
      if(active.current===run){active.current=null;if(mounted.current)setBusy(false);}
    }
  }
  function removeNote(index:number) {
    if(!result)return;
    const removed=result.notes[index];if(!removed)return;
    const warning='You edited the detected notes. Original chord suggestions were cleared because they may no longer match. Reset edits to restore the received draft.';
    setResult({...result,notes:result.notes.filter((_,i)=>i!==index),chords:[],warnings:[...new Set([...result.warnings,warning])]});
    if(mode==='chords')setMode('melody');
    setStatus(`Removed ${westernName(removed.midi,true)} at ${removed.start.toFixed(2)} seconds. Review the remaining notes before saving.`);
  }
  function resetEdits() {
    setResult(receivedDraft.current);setStatus('Your received draft has been restored.');
  }
  const playableChords=!!result?.chords.some(c=>c.notes?.length);
  const edited=!!result&&result!==receivedDraft.current;

  return <section className="transcribe-section" aria-labelledby={`transcribe-title-${clip.id}`}>
    <div className="transcribe-heading"><span className="transcribe-icon"><Radio size={21}/></span><div><div className="eyebrow">FROM LISTENING TO PLAYING</div><h3 id={`transcribe-title-${clip.id}`}>Find the notes in your audio</h3></div></div>
    <p className="transcribe-lead">Choose a recording of this passage. Find its notes on this device, review the draft, then save it to this clip for practice.</p>
    <form onSubmit={transcribe}>
      <label className={`transcribe-file ${file?'has-file':''}`}><input type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.mp4,.webm" disabled={busy} onChange={e=>chooseFile(e.target.files?.[0]||null)} aria-label="Audio recording to transcribe"/><FileAudio size={25}/><span><b>{file?file.name:'Choose an audio recording'}</b><small>{file?`${(file.size/1024/1024).toFixed(1)} MB · tap to choose another`:'WAV, MP3, M4A, FLAC, OGG · up to 25 MiB'}</small></span><FolderOpen size={18}/></label>
      {preview&&<audio className="transcribe-preview" src={preview} controls preload="metadata" aria-label="Preview your selected recording"/>}
      <div className="transcribe-time-row"><div><label htmlFor={`audio-from-${clip.id}`}>Audio start</label><input id={`audio-from-${clip.id}`} value={start} disabled={busy} onChange={e=>setStart(e.target.value)} placeholder="1:20"/></div><span>→</span><div><label htmlFor={`audio-to-${clip.id}`}>Audio end</label><input id={`audio-to-${clip.id}`} value={end} disabled={busy} onChange={e=>setEnd(e.target.value)} placeholder="1:50"/></div><button className="text-link" type="button" disabled={busy} onClick={()=>{setStart('0:00');setEnd(formatTimestamp(Math.min(clip.end-clip.start,60)));}}>My file is already trimmed</button></div>
      <p className="transcribe-help">Times refer to your audio file, not necessarily the YouTube video. Choose up to 60 seconds from a file no longer than 10 minutes; try a clear 10–20 second phrase first. Browser format support varies; MP3 or WAV is a good place to start.</p>
      <div className="transcribe-privacy"><CircleHelp size={17}/><p>Your recording stays on this device. The first use may take longer while the note model loads; keep the app open during analysis. YouTube audio is not downloaded.</p></div>
      <label className="transcribe-rights"><input type="checkbox" required checked={hasPermission} disabled={!file||busy} onChange={e=>setHasPermission(e.target.checked)}/><span>I have the rights or permission needed to transcribe this recording and its music<small>Use original music, public-domain recordings and compositions, or content covered by suitable permission or a licence.</small></span></label>
      <div className="transcribe-actions"><button className="button primary" type="submit" disabled={busy||!file||!hasPermission}>{busy?<LoaderCircle size={16} className="is-spinning"/>:<Radio size={16}/>} {busy?'Finding notes…':'Find notes on this device'}</button>{busy&&<button className="button outline" type="button" onClick={cancel}><X size={16}/>Stop</button>}</div>
    </form>
    {status&&<p className="transcribe-status" role="status">{status}</p>}{error&&<p className="transcribe-error" role="alert">{error}</p>}
    {result&&<div className="transcription-result"><div className="transcription-result-title"><span><Check size={16}/>AUTOMATIC DRAFT</span><b>{result.notes.length} detected notes · {result.duration.toFixed(1)} seconds</b></div><p className="transcribe-review-note">Check this against the recording. Vocals, drums, overlapping instruments, and ornamentation can create missing or extra notes. Chord labels and the upper-voice line are estimates.</p>{result.warnings.length>0&&<ul className="transcription-warnings">{result.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul>}
      <div className="transcription-edit-tools"><p>Remove notes that sound wrong or follow an unwanted harmonic. Activation is the model’s signal strength, not the probability that a note is correct.</p>{edited&&<button className="text-link" type="button" onClick={resetEdits}><RotateCcw size={13}/>Reset edits</button>}</div>
      {result.notes.length>0&&<><div className="transcription-note-table" role="region" aria-label="Detected notes" tabIndex={0}><table><thead><tr><th>Time</th><th>Western</th><th>Carnatic · Sa=C</th><th>Activation</th><th><span className="transcription-sr-only">Edit</span></th></tr></thead><tbody>{result.notes.slice(0,visibleEvents).map((note,i)=><tr key={i}><td>{note.start.toFixed(2)}–{note.end.toFixed(2)}s</td><td>{westernName(note.midi,true)}</td><td>{noteName(note.midi,0,'carnatic')}</td><td>{Math.round(note.confidence*100)}%</td><td><button className="transcription-remove-note" type="button" aria-label={`Remove ${westernName(note.midi,true)} at ${note.start.toFixed(2)} seconds`} onClick={()=>removeNote(i)}><Trash2 size={13}/></button></td></tr>)}</tbody></table></div>{result.notes.length>visibleEvents&&<button className="text-link transcription-more-notes" type="button" onClick={()=>setVisibleEvents(n=>n+80)}>Show more notes ({result.notes.length-visibleEvents} remaining)</button>}<p className="transcribe-help">Showing {Math.min(visibleEvents,result.notes.length)} of {result.notes.length} events. All remaining events are saved when you apply the draft.</p></>}
      {result.chords.length>0&&<div className="transcription-chords"><h4>Chord suggestions</h4>{result.chords.slice(0,30).map((chord,i)=><span key={i} title={`${chord.start.toFixed(2)}–${chord.end.toFixed(2)} seconds · ${Math.round(chord.confidence*100)}% confidence`}><b>{chord.label}</b><small>{chord.start.toFixed(1)}s</small></span>)}</div>}
      {result.notes.length>0&&<><fieldset className="transcription-mode"><legend>Build a practice study</legend>{([{value:'melody',label:'Upper voice',detail:'An estimated lead line'},{value:'detected',label:'All detected notes',detail:'Keep overlapping pitches'},{value:'chords',label:'Chord suggestions',detail:'Estimated harmony shapes'}] as const).map(item=><label key={item.value} className={mode===item.value?'selected':''}><input type="radio" name={`transcription-mode-${clip.id}`} value={item.value} checked={mode===item.value} disabled={item.value==='chords'&&!playableChords} onChange={()=>setMode(item.value)}/><span><b>{item.label}</b><small>{item.detail}</small></span></label>)}</fieldset><button className="button primary" type="button" onClick={()=>onApply(result,mode)}>Save draft to this clip <ArrowRight size={16}/></button><p className="transcribe-help">You can review or replace the draft later. Saving keeps note events on this device; the source recording is not saved in your library.</p></>}
    </div>}
  </section>;
}
