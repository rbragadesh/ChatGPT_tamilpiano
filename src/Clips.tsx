import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Clock3, ExternalLink, Link2, Music2, Play, Plus, Repeat2, Trash2, Video, X } from 'lucide-react';
import type { Lesson } from './lessons';
import type { Song } from './catalogue';
import { requiredLevelForLesson } from './progression';
import { formatTimestamp, formatSwaraTokens, formatWesternTokens, loadClips, parseNoteTokens, parseSwaraTokens, parseTimestamp, parseYouTubeUrl, saveClips } from './clips';
import type { SavedClip } from './clips';
import './Clips.css';
import { Transcribe } from './Transcribe';
import { parseTranscriptionResult, transcriptionToLesson } from './transcription';
import type { TranscriptionMode, TranscriptionResult } from './transcription';

interface YouTubePlayer {
  destroy(): void; seekTo(time: number, allowSeekAhead: boolean): void; playVideo(): void;
  pauseVideo(): void; getCurrentTime(): number; getPlayerState(): number;
  setPlaybackRate(rate: number): void; getAvailablePlaybackRates(): number[];
}
type YTNamespace = { Player: new (element: HTMLElement, config: Record<string, unknown>) => YouTubePlayer };
type YouTubeWindow = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
let youtubeApi: Promise<YTNamespace> | undefined;
function getYoutubeApi(): Promise<YTNamespace> {
  const win = window as YouTubeWindow;
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (youtubeApi) return youtubeApi;
  youtubeApi = new Promise((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (win.YT?.Player) resolve(win.YT); else reject(new Error('YouTube player did not initialise.'));
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => { youtubeApi = undefined; reject(new Error('YouTube could not load.')); };
    document.head.appendChild(script);
  });
  return youtubeApi;
}

function ClipPlayer({ clip }: { clip: SavedClip }) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const loopRef = useRef(false);
  const readyRef = useRef(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => {
    let cancelled = false;
    readyRef.current = false; setReady(false); setError(''); setSpeed(1);
    const timer = window.setTimeout(() => {
      if (!readyRef.current) setError('The embedded player is taking a while. Check your connection or open this excerpt on YouTube.');
    }, 12000);
    getYoutubeApi().then(YT => {
      if (cancelled || !container.current) return;
      const target = document.createElement('div');
      container.current.replaceChildren(target);
      player.current = new YT.Player(target, {
        host: 'https://www.youtube-nocookie.com', videoId: clip.videoId,
        width: '100%', height: '100%',
        playerVars: { start: Math.floor(clip.start), end: Math.ceil(clip.end), playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => { if (!cancelled) { readyRef.current = true; clearTimeout(timer); setReady(true); setError(''); } },
          onError: () => { if (!cancelled) setError('This video cannot play here. It may restrict embedding, require sign-in, or be unavailable. Try opening it on YouTube.'); },
          onStateChange: (event: { data: number }) => {
            if (!cancelled && event.data === 0 && loopRef.current && player.current) {
              player.current.seekTo(clip.start, true); player.current.playVideo();
            }
          },
        },
      });
    }).catch(() => { if (!cancelled) setError('YouTube is unavailable here. The saved clip is still in your library; open it on YouTube to listen.'); });
    const interval = window.setInterval(() => {
      const current = player.current;
      if (!current || !readyRef.current) return;
      try {
        if (current.getPlayerState() === 1 && current.getCurrentTime() >= clip.end - 0.08) {
          if (loopRef.current) { current.seekTo(clip.start, true); current.playVideo(); }
          else current.pauseVideo();
        }
      } catch { /* The iframe may still be negotiating its connection. */ }
    }, 100);
    return () => {
      cancelled = true; clearTimeout(timer); clearInterval(interval);
      try { player.current?.destroy(); } catch { /* Player may not have loaded. */ }
      player.current = null;
    };
  }, [clip.id, clip.videoId, clip.start, clip.end]);
  function replay() { player.current?.seekTo(clip.start, true); player.current?.playVideo(); }
  function changeSpeed(rate: number) {
    const current = player.current;
    if (!current) return;
    if (!current.getAvailablePlaybackRates().includes(rate)) { setError('This video does not offer that playback speed. Use a speed in the YouTube player settings.'); return; }
    current.setPlaybackRate(rate); setSpeed(rate);
  }
  return <div className="clip-player-area">
    <div className="clip-video" ref={container}><div className="clip-player-loading"><Video size={30}/><span>Connecting to YouTube…</span></div></div>
    {error && <p className="clip-player-error" role="status">{error}</p>}
    <div className="clip-player-controls"><button className="button primary" onClick={replay} disabled={!ready}><Play size={15}/>Play excerpt</button><button className={`clip-loop ${loop ? 'on' : ''}`} aria-pressed={loop} onClick={() => setLoop(!loop)}><Repeat2 size={17}/>{loop ? 'Loop on' : 'Loop off'}</button><label className="clip-speed">Speed<select aria-label="Playback speed" value={speed} disabled={!ready} onChange={e => changeSpeed(Number(e.target.value))}>{[0.25,0.5,0.75,1].map(value => <option key={value} value={value}>{value}×</option>)}</select></label><a className="clip-external" href={`https://www.youtube.com/watch?v=${clip.videoId}&t=${Math.floor(clip.start)}s`} target="_blank" rel="noopener noreferrer">Open YouTube <ExternalLink size={14}/></a></div>
    <p className="clip-small">Tap Play to begin audio. YouTube needs Internet access and may show ads. Your clip is a bookmark to the video; no recording is downloaded.</p>
  </div>;
}

export function Clips({ onPractice, onPracticeClip, initialSong, unlockedLevel=1 }: { onPractice: (id: string) => void; onPracticeClip?: (lesson: Lesson, minimumLevel?:number) => void; initialSong?:Song; unlockedLevel?:number }) {
  const [clips, setClips] = useState<SavedClip[]>(loadClips);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState(initialSong?`${initialSong.title} · ${initialSong.film}`:'');
  const [linkedSong,setLinkedSong]=useState<Song|undefined>(initialSong);
  const [start, setStart] = useState('0:00');
  const [end, setEnd] = useState('0:30');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [inputFormat, setInputFormat] = useState<'western'|'carnatic'>('western');
  const [bpm, setBpm] = useState(76);
  const [notationRights,setNotationRights]=useState(false);
  const selected = clips.find(clip => clip.id === active);
  useEffect(()=>{if(initialSong){setLinkedSong(initialSong);setTitle(`${initialSong.title} · ${initialSong.film}`);setUrl('');setStart('0:00');setEnd('0:30');}},[initialSong?.id]);
  const studyLevel=(lesson:Lesson,clip:SavedClip)=>Math.max(clip.songId?2:1,requiredLevelForLesson(lesson));
  useEffect(() => {
    setNotationRights(false);
    if (!selected) return;
    setInputFormat('western'); setNotes(selected.notes); setBpm(selected.bpm);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setActive(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [active]);
  function persist(next: SavedClip[]) {
    try { saveClips(next); setClips(next); return true; }
    catch { setError('Your browser could not save this clip. Free some website storage or allow local storage, then try again.'); return false; }
  }
  function updateUrl(value: string) {
    setUrl(value); setError('');
    const parsed = parseYouTubeUrl(value);
    if (parsed?.start !== undefined) { setStart(formatTimestamp(parsed.start)); setEnd(formatTimestamp(parsed.start + 30)); }
  }
  function addClip(event: React.FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    const parsed = url.trim()?parseYouTubeUrl(url):null;
    if (url.trim()&&!parsed) { setError('Paste a valid YouTube video link, or leave it blank for a private study.'); return; }
    if (!parsed&&!title.trim()) {setError('Give your private study a name, or add a YouTube link.');return;}
    const from = parseTimestamp(start), to = parseTimestamp(end);
    if (from === null || to === null || to <= from || to - from > 3600) { setError('Enter a valid start and end time. The excerpt must be longer than zero and no longer than one hour.'); return; }
    const clip: SavedClip = { id: crypto.randomUUID(), title: title.trim().slice(0,120) || 'My practice clip', videoId: parsed?.videoId||'', ...(linkedSong?{songId:linkedSong.id}:{}), start: from, end: to, notes: '', bpm: 76, createdAt: Date.now() };
    if (persist([clip, ...clips])) { setLinkedSong(undefined);setTitle(''); setUrl(''); setStart('0:00'); setEnd('0:30'); setNotice('Study saved on this device. Open it to add your authorised notes or an audio draft.'); }
  }
  function notationLesson(clip: SavedClip): Lesson | null {
    const pitches = inputFormat === 'carnatic' ? parseSwaraTokens(notes) : parseNoteTokens(notes);
    if (!pitches || pitches.some(note => note < 60 || note > 84)) { setError(inputFormat === 'carnatic' ? "Enter numbered swaras such as S R2 G3 M1 P D2 N3 S'. Use an apostrophe for the next octave. Range: S to S''; up to 128 notes." : 'Enter notes from C4 to C6, separated by spaces. Example: C4 D4 E4 G4. Up to 128 notes; sharps and flats are welcome.'); return null; }
    return buildNotationLesson(clip,pitches);
  }
  function buildNotationLesson(clip:SavedClip,pitches:number[]):Lesson {
    return { id: `clip-${clip.id}`, title: clip.title, subtitle: 'Your personal notation', source: 'manual', description: 'A guided exercise built from your authorised notation. Check it against your source before practising.', category: 'melody', level: 'Beginner', duration: `${Math.max(1,Math.ceil(pitches.length * 60 / bpm / 60))} min`, bpm, meter: 4, steps: pitches.map(note => ({notes:[note-60],beats:1})), tips: ['Every note lasts one beat. Adjust the tempo to match your practice pace.', 'The notes you enter use C4 as the reference Sa. Choosing a different tonic in settings transposes this exercise.', 'Check your transcription against the recording slowly. YouTube audio is not analysed by this app.'] };
  }
  function saveNotation(practice: boolean) {
    if (!selected) return;
    if (!notationRights) {setError('Confirm that you have the rights or permission to save this notation.');return;}
    setError(''); setNotice('');
    const lesson = notationLesson(selected);
    if (!lesson) return;
    if(practice&&studyLevel(lesson,selected)>unlockedLevel){setError(`This study unlocks at Level ${studyLevel(lesson,selected)}. Continue your learning path first.`);return;}
    const pitches = inputFormat === 'carnatic' ? parseSwaraTokens(notes)! : parseNoteTokens(notes)!;
    if (!persist(clips.map(clip => clip.id === selected.id ? {...clip, notes: formatWesternTokens(pitches), bpm} : clip))) return;
    if (practice && onPracticeClip) { setActive(null); onPracticeClip(lesson,selected.songId?2:1); }
    else setNotice('Your notation and tempo are saved.');
  }
  function changeInputFormat(format:'western'|'carnatic') {
    const pitches = inputFormat === 'carnatic' ? parseSwaraTokens(notes) : parseNoteTokens(notes);
    if (notes.trim() && !pitches) { setError('Finish or clear your current notes before changing the input format.'); return; }
    setError(''); setInputFormat(format);
    if (pitches) setNotes(format === 'carnatic' ? formatSwaraTokens(pitches) : formatWesternTokens(pitches));
  }
  function applyTranscription(result: TranscriptionResult, mode: TranscriptionMode = 'melody') {
    if (!selected) return;
    setError('');
    try {
      const draft = parseTranscriptionResult(result);
      if (persist(clips.map(clip => clip.id === selected.id ? {...clip, transcription: draft, transcriptionMode: mode} : clip))) {
        setNotice('Automatic draft saved on this device. Compare it with the recording before practising.');
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this draft.'); }
  }
  function practiseDraft() {
    if (!selected?.transcription || !onPracticeClip) return;
    try {
      const lesson = transcriptionToLesson(selected, selected.transcription, selected.transcriptionMode || 'melody');
      const required=studyLevel(lesson,selected);
      if(required>unlockedLevel){setError(`This study unlocks at Level ${required}. Continue your learning path first.`);return;}
      setActive(null); onPracticeClip(lesson,selected.songId?2:1);
    } catch (error) { setError(error instanceof Error ? error.message : 'This draft has no playable notes.'); }
  }
  const manualPitches=inputFormat==='carnatic'?parseSwaraTokens(notes):parseNoteTokens(notes);
  const manualLevel=selected&&manualPitches&&manualPitches.every(note=>note>=60&&note<=84)?studyLevel(buildNotationLesson(selected,manualPitches),selected):selected?.songId?2:1;
  let draftLevel=selected?.songId?2:1;
  if(selected?.transcription){try{draftLevel=studyLevel(transcriptionToLesson(selected,selected.transcription,selected.transcriptionMode||'melody'),selected);}catch{/* Empty drafts report their error when opened. */}}
  return <div className="clips-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="small-line"/>YOUR MUSIC, YOUR PACE</div><h1>Make a song your own<span>.</span></h1><p>Save the moments you love. Listen closely. Learn a little at a time.</p></div><span className="clips-total"><Video size={17}/>{clips.length} personal {clips.length === 1 ? 'clip' : 'clips'}</span></div>
    {linkedSong&&<div className="clip-song-selection"><div><span className="eyebrow">YOUR PRIVATE SONG STUDY</span><strong>{linkedSong.title}</strong><p>{linkedSong.film} · {linkedSong.composer}. Add only notation or recordings you have the rights to use. No film-song score is bundled.</p></div><button className="text-link" onClick={()=>{setLinkedSong(undefined);setTitle('');}}>Clear song selection</button></div>}<div className="clips-intro-grid"><form className="clip-add-form" onSubmit={addClip}><div className="clip-form-heading"><span className="clip-link-icon"><Link2 size={21}/></span><div><h2>Save a practice clip</h2><p>A favourite melody, a chord change, a tiny beginning.</p></div></div><label htmlFor="clip-url">YouTube video link <span>optional</span></label><input id="clip-url" type="url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={e => updateUrl(e.target.value)} autoComplete="off"/><label htmlFor="clip-title">Give it a name <span>{url.trim()?'optional':'required for a private study'}</span></label><input id="clip-title" required={!url.trim()} placeholder="e.g. My favourite interlude" maxLength={120} value={title} onChange={e => setTitle(e.target.value)}/><div className="clip-time-inputs"><div><label htmlFor="clip-start">Start at</label><input id="clip-start" required inputMode="decimal" value={start} placeholder="1:20" onChange={e => setStart(e.target.value)}/></div><span>→</span><div><label htmlFor="clip-end">End at</label><input id="clip-end" required inputMode="decimal" value={end} placeholder="1:50" onChange={e => setEnd(e.target.value)}/></div><span className="clip-time-hint">minutes : seconds</span></div><button className="button primary" type="submit"><Plus size={17}/>Save to my clips<ArrowRight size={17}/></button></form><aside className="clips-explainer"><span className="clip-explainer-symbol">♫</span><div className="eyebrow">A LITTLE LISTENING RITUAL</div><h2>Hear it.<br/>Slow it.<br/>Make it yours.</h2><p>Loop a short excerpt, slow down the player, then work out a few notes at the keyboard.</p><div className="clips-honest-note"><Music2 size={17}/><p>YouTube links save listening clips. To generate a note draft, open a clip and select an audio recording you have the rights to transcribe. Its notes are analysed on this device. You can also enter your own notation.</p></div></aside></div>
    {error && !selected && <p className="clip-form-error" role="alert">{error}</p>}{notice && !selected && <p className="clip-notice" role="status"><Check size={16}/>{notice}</p>}
    <div className="section-heading clips-list-heading"><div><div className="eyebrow">A COLLECTION THAT SOUNDS LIKE YOU</div><h2>Your saved moments</h2></div><span className="muted">Private to this browser</span></div>
    {clips.length === 0 ? <div className="clips-empty"><span><Video size={30}/></span><h3>Your first favourite belongs here.</h3><p>Add a YouTube bookmark, or give a private study a name.<br/>Start with 20–30 seconds. Small phrases make lovely practice.</p><button className="text-link" onClick={() => document.getElementById('clip-url')?.focus()}>Add your first clip <ArrowRight size={16}/></button></div> : <div className="saved-clips-grid">{clips.map((clip,index) => <article className="saved-clip-card" key={clip.id}><button className={`saved-clip-art clip-color-${index%4}`} onClick={() => {setActive(clip.id);setError('');setNotice('');}} aria-label={`Open ${clip.title}`}><span className="clip-art-id">{String(index+1).padStart(2,'0')}</span><span className="clip-art-note">♪</span><span className="clip-art-play"><Play size={21} fill="currentColor"/></span><span className="clip-duration"><Clock3 size={12}/>{formatTimestamp(clip.end-clip.start)}</span></button><div className="saved-clip-info"><span className="clip-card-kicker">{clip.videoId?'YOUTUBE PRACTICE CLIP':'PRIVATE SONG STUDY'}</span><h3><button onClick={() => {setActive(clip.id);setError('');setNotice('');}}>{clip.title}</button></h3><p>{formatTimestamp(clip.start)} – {formatTimestamp(clip.end)} <span>·</span> {clip.transcription ? 'Automatic draft saved' : clip.notes ? 'Notation added' : clip.videoId?'Listening clip':'Add your authorised notes'}</p><div className="clip-card-actions"><button className="text-link" onClick={() => {setActive(clip.id);setError('');setNotice('');}}>Open clip <ArrowRight size={15}/></button><button className="icon-button" aria-label={`Delete ${clip.title}`} onClick={() => { if (window.confirm(`Delete “${clip.title}” from this device?`)) persist(clips.filter(item => item.id !== clip.id)); }}><Trash2 size={16}/></button></div></div></article>)}</div>}
    {selected && <div className="dialog-backdrop clip-modal-backdrop" onClick={() => setActive(null)}><section className="clip-modal" role="dialog" aria-modal="true" aria-labelledby="clip-modal-title" onClick={e => e.stopPropagation()}><button className="icon-button clip-modal-close" onClick={() => setActive(null)} aria-label="Close clip"><X size={21}/></button><div className="eyebrow">YOUR PERSONAL PRACTICE CLIP</div><h2 id="clip-modal-title">{selected.title}</h2><p className="clip-modal-time">{formatTimestamp(selected.start)} – {formatTimestamp(selected.end)}</p>{selected.videoId?<ClipPlayer clip={selected}/>:<div className="clip-local-study"><Music2 size={24}/><div><h3>A private study, ready for your notes.</h3><p>Add notation or select an audio recording you have the rights to transcribe. Analysis stays on this device; the catalogue does not include a commercial song score.</p></div></div>}{selected.transcription&&<div className="clip-saved-draft"><div><span className="eyebrow">SAVED AUTOMATIC DRAFT</span><h3>{selected.transcription.notes.length} detected notes · {selected.transcription.duration.toFixed(1)} seconds</h3><p>{selected.transcriptionMode==='chords'?'Chord suggestions':selected.transcriptionMode==='detected'?'All detected notes':'Estimated upper voice'} · Review against your recording</p></div>{onPracticeClip&&<button className="button primary" disabled={draftLevel>unlockedLevel} onClick={practiseDraft}><Play size={15}/>Practise saved draft{draftLevel>unlockedLevel?` · Level ${draftLevel}`:''}</button>}</div>}{selected.transcription&&draftLevel>unlockedLevel&&<p className="clip-level-lock">This draft unlocks at Level {draftLevel}. Keep practising your learning path; you can review and save drafts at any time.</p>}<Transcribe key={selected.id} clip={selected} onApply={applyTranscription}/><div className="clip-notation"><div className="clip-notation-heading"><Music2 size={20}/><div><h3>Turn your notes into practice</h3><p>Add the notes you have worked out. We’ll guide you through them.</p></div></div><div className="clip-input-format"><label htmlFor="clip-input-format">Enter notes as</label><select id="clip-input-format" value={inputFormat} onChange={e => changeInputFormat(e.target.value as 'western'|'carnatic')}><option value="western">Western · C D E</option><option value="carnatic">Carnatic · Sa Ri Ga</option></select></div><label htmlFor="clip-notes">{inputFormat === 'western' ? 'Your Western notation' : 'Your Carnatic notation'} <span>{inputFormat === 'western' ? 'C4 to C6' : "S to S'' · Sa = C"} · one note per beat</span></label><textarea id="clip-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder={inputFormat === 'western' ? 'C4 D4 E4 G4 E4 D4 C4' : "S R2 G3 P G3 R2 S"} rows={3} maxLength={4096}/><label className="clip-notation-rights"><input type="checkbox" checked={notationRights} onChange={e=>setNotationRights(e.target.checked)}/><span>I have the rights or permission to save and practise this notation</span></label><div className="clip-note-controls"><label htmlFor="clip-bpm">Tempo <b>{bpm} BPM</b><input id="clip-bpm" type="range" min={30} max={200} value={bpm} onChange={e => setBpm(Number(e.target.value))}/></label><button className="button outline" disabled={!notationRights} onClick={() => saveNotation(false)}>Save notation</button>{onPracticeClip && <button className="button primary" disabled={!notationRights||manualLevel>unlockedLevel} onClick={() => saveNotation(true)}><Play size={15}/>Practise my notes{manualLevel>unlockedLevel?` · Level ${manualLevel}`:''}</button>}</div>{manualLevel>unlockedLevel&&<p className="clip-level-lock">This notation unlocks at Level {manualLevel}. You can save it now and practise after completing earlier learning levels.</p>}<p className="clip-small">{inputFormat === 'western' ? 'Use spaces between notes; C#4 and Db4 are accepted.' : "Use S or Sa, R2 or Ri2, G3 or Ga3, M1 or Ma1, P or Pa, D2 or Dha2, N3 or Ni3. Add ' for the upper octave. Ri, Ga, Ma, Dha and Ni need their numbered variant."} Switch input format to convert your notes. Swaras use C as the reference Sa; the practice room can transpose them. Shared swara positions use a canonical name when converting. This editor does not transcribe the recording.</p><button className="text-link" onClick={() => {setActive(null);onPractice('first-notes');}}>New to finding notes? Start with five notes <ArrowRight size={15}/></button></div>{error && <p className="clip-form-error" role="alert">{error}</p>}{notice && <p className="clip-notice" role="status"><Check size={16}/>{notice}</p>}</section></div>}
  </div>;
}
