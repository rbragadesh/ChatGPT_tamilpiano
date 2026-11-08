import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Headphones, Mic, Pause, Play, RotateCcw, Volume2, X } from 'lucide-react';
import { lessons, type Lesson } from './lessons';
import { detectPitch, frequencyToMidi, isBlack, noteName, soundBeat, soundNote, stopSounds, unlockAudio, westernName, type Notation } from './music';
import './Practice.css';

interface Props { lessonId: string; customLesson?: Lesson; notation: Notation; tonic: number; onBack: () => void; onComplete: (id: string, score: number) => void }
type Phase = 'ready' | 'practice' | 'listen' | 'complete';
const COMPUTER_KEYS = 'awsedftgyhujkolp;'.split('');
const formatBeats = (beats:number) => Number(beats.toFixed(3)).toString();

function Staff({notes, next, tonic, notation, beats, nextBeats, hasNext}: {notes:number[];next:number[];tonic:number;notation:Notation;beats:number;nextBeats:number;hasNext:boolean}) {
  const clefNotes=notes.length?notes:next;
  const bass=clefNotes.length>0&&Math.max(...clefNotes)<60;
  const yFor = (midi:number) => {
    const degree = [0,0,1,2,2,3,3,4,5,5,6,6][midi%12];
    return 106 - ((Math.floor(midi/12)-5)*7+degree)*6-(bass?72:0);
  };
  const positions=[...notes,...next].map(yFor);
  const top=Math.min(0,(positions.length?Math.min(...positions):60)-60);
  const bottom=Math.max(155,(positions.length?Math.max(...positions):100)+36);
  return <svg className="lesson-staff" viewBox={`0 ${top} 500 ${bottom-top}`} role="img" aria-label={`${bass?'Bass':'Treble'} clef. ${notes.length?`Current notes ${notes.map(n=>noteName(n,tonic,notation)).join(', ')}`:'Rest'}. ${formatBeats(beats)} beats.`}>
    {[46,58,70,82,94].map(y=><line key={y} x1="24" x2="480" y1={y} y2={y} stroke="currentColor" opacity=".22"/>)}
    <text x="30" y="94" fontSize={bass?'56':'63'} fontFamily="serif" fill="currentColor">{bass?'𝄢':'𝄞'}</text>
    {[{ns:notes,x:200,current:true,length:beats},...(hasNext?[{ns:next,x:360,current:false,length:nextBeats}]:[])].map(({ns,x,current,length})=><g key={x} opacity={current?1:0.25}>
      {!ns.length&&<text x={x} y="78" textAnchor="middle" fontSize="18" fontFamily="Georgia,serif" fill="currentColor">rest</text>}
      {ns.map((midi,i)=>{const y=yFor(midi);const accidental = [1,6].includes(midi%12)?'♯':[3,8,10].includes(midi%12)?'♭':'';const standard=[0.25,0.5,1,1.5,2,3,4].includes(length); return <g key={midi}>
        {y>=106 && Array.from({length:20},(_,i)=>106+12*i).filter(ly=>ly<=y+1).map(ly=><line key={ly} x1={x-17} x2={x+17} y1={ly} y2={ly} stroke="currentColor"/>)}
        {y<=34 && Array.from({length:20},(_,i)=>34-12*i).filter(ly=>ly>=y-1).map(ly=><line key={ly} x1={x-17} x2={x+17} y1={ly} y2={ly} stroke="currentColor"/>)}
        {accidental && <text x={x-29-i*5} y={y+5} fontSize="24" fill="currentColor">{accidental}</text>}
        {standard?<ellipse cx={x} cy={y} rx="8" ry="5.5" transform={`rotate(-18 ${x} ${y})`} fill={length>=2?'var(--practice-paper)':'currentColor'} stroke="currentColor" strokeWidth="2"/>:<path d={`M${x-8},${y} l8,-6 8,6 -8,6 Z`} fill="var(--practice-paper)" stroke="currentColor" strokeWidth="2"/>}
        {standard&&length<4 && <line x1={x+7} x2={x+7} y1={y} y2={y-31} stroke="currentColor" strokeWidth="2"/>}
        {standard&&length<1 && <path d={`M${x+7},${y-31} q18,12 3,21`} fill="none" stroke="currentColor" strokeWidth="2"/>}
        {length===0.25 && <path d={`M${x+7},${y-23} q18,12 3,21`} fill="none" stroke="currentColor" strokeWidth="2"/>}
        {(length===1.5||length===3) && <circle cx={x+17} cy={y-2} r="2" fill="currentColor"/>}
      </g>})}
      <text x={x} y={bottom-6} textAnchor="middle" fontSize="12" fill="currentColor">{ns.length?ns.map(n=>noteName(n,tonic,notation)).join(' + '):'Rest'} · {formatBeats(length)} {length===1?'beat':'beats'}</text>
    </g>)}
    <text x="200" y={top+20} textAnchor="middle" fontSize="10" letterSpacing="2" fill="currentColor">NOW</text>
    {hasNext&&<text x="360" y={top+20} textAnchor="middle" fontSize="10" letterSpacing="2" fill="currentColor">NEXT</text>}
  </svg>;
}

export function Practice({lessonId,customLesson,notation,tonic,onBack,onComplete}:Props) {
  const lesson = customLesson || lessons.find(l=>l.id===lessonId) || lessons[0];
  const [phase,setPhaseState] = useState<Phase>('ready');
  const phaseRef=useRef<Phase>('ready');
  const setPhase=(value:Phase)=>{phaseRef.current=value;setPhaseState(value);};
  const [index,setIndex]=useState(0), indexRef=useRef(0);
  const [tempo,setTempo]=useState(lesson.bpm), [metronome,setMetronome]=useState(false), [beat,setBeat]=useState(0);
  const [computerOctave,setComputerOctave]=useState(0), computerOctaveRef=useRef(0);computerOctaveRef.current=computerOctave;
  const [active,setActive]=useState<number[]>([]), [accepted,setAccepted]=useState<number[]>([]);
  const acceptedRef=useRef(new Set<number>()), chordStarted=useRef(0);
  const [feedback,setFeedback]=useState('Listen first, or start at your own pace.');
  const keyboardRef=useRef<HTMLDivElement|null>(null), tonicRef=useRef(tonic); tonicRef.current=tonic;
  const [mistake,setMistake]=useState(false), [score,setScore]=useState(100), [micOn,setMicOn]=useState(false), [micError,setMicError]=useState('');
  const attempts=useRef(0), correct=useRef(0), timer=useRef<ReturnType<typeof setTimeout>|null>(null), restTimer=useRef<ReturnType<typeof setTimeout>|null>(null), keyTimers=useRef<ReturnType<typeof setTimeout>[]>([]);
  const streamRef=useRef<MediaStream|null>(null), micSource=useRef<MediaStreamAudioSourceNode|null>(null), raf=useRef(0), micGeneration=useRef(0);
  const onCompleteRef=useRef(onComplete); onCompleteRef.current=onComplete;
  const step=lesson.steps[Math.min(index,lesson.steps.length-1)];
  const notes=step.notes.map(n=>60+tonic+n), next=lesson.steps[index+1]?.notes.map(n=>60+tonic+n)||[];
  const hasChords=lesson.steps.some(s=>s.notes.length>1);
  const allNotes=lesson.steps.flatMap(s=>s.notes);
  const highestNote=60+tonic+(allNotes.length?Math.max(...allNotes):0);
  const lowestNote=60+tonic+(allNotes.length?Math.min(...allNotes):0);
  const keyboardLow=Math.min(60,Math.floor(lowestNote/12)*12);
  const keyboardHigh=Math.max(84,Math.ceil(highestNote/12)*12);
  const keys=Array.from({length:keyboardHigh-keyboardLow+1},(_,i)=>keyboardLow+i);
  const whiteCount=keys.filter(n=>!isBlack(n)).length;

  // Only move the keyboard's own scroll position. scrollIntoView can unexpectedly
  // move the entire lesson on a narrow phone screen.
  useEffect(()=>{
    const container=keyboardRef.current;if(!container)return;
    const current=lesson.steps[Math.min(index,lesson.steps.length-1)];
    const target=container.querySelector<HTMLButtonElement>(`[data-midi="${60+tonic+current.notes[Math.floor(current.notes.length/2)]}"]`);
    if(!target)return;
    const viewport=container.getBoundingClientRect(), key=target.getBoundingClientRect();
    if(key.left<viewport.left+10||key.right>viewport.right-10)container.scrollTo({left:container.scrollLeft+key.left-viewport.left-container.clientWidth/2+key.width/2,behavior:'smooth'});
  },[index,tonic,lesson.id]);

  const stopMic=useCallback(()=>{micGeneration.current++;cancelAnimationFrame(raf.current);streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;micSource.current?.disconnect();micSource.current=null;setMicOn(false);},[]);
  const stopPlayback=useCallback(()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;if(restTimer.current)clearTimeout(restTimer.current);restTimer.current=null;stopSounds();setActive([]);},[]);
  useEffect(()=>()=>{stopPlayback();stopMic();keyTimers.current.forEach(clearTimeout);},[stopPlayback,stopMic]);

  const reset=()=>{stopPlayback();indexRef.current=0;setIndex(0);attempts.current=0;correct.current=0;acceptedRef.current.clear();setAccepted([]);setScore(100);setMistake(false);setPhase('ready');setFeedback('A fresh start. Take it one note at a time.');};
  useEffect(()=>{reset();stopMic();setTempo(lesson.bpm);setComputerOctave(0);},[lesson.id,tonic]); // Switching tonic starts a fresh phrase.

  const advancePractice=useCallback(()=>{
    acceptedRef.current.clear();setAccepted([]);setMistake(false);
    const nextIndex=indexRef.current+1;indexRef.current=nextIndex;setIndex(nextIndex);
    if(nextIndex>=lesson.steps.length){const result=attempts.current?Math.round(correct.current/attempts.current*100):0;setScore(result);setPhase('complete');setFeedback('Phrase complete. A little practice goes a long way.');stopMic();onCompleteRef.current(lesson.id,result);}
    else setFeedback(nextIndex%3===0?'Lovely. Keep your hands relaxed.':'That’s it. Follow the next note.');
  },[lesson.id,lesson.steps.length,stopMic]);

  // Rests have no target pitch. Advance them using their actual beat duration;
  // requiring an input event here would leave a generated lesson stuck forever.
  useEffect(()=>{
    if(phase!=='practice'||index>=lesson.steps.length||step.notes.length)return;
    stopSounds();setActive([]);setFeedback(`Rest for ${formatBeats(step.beats)} ${step.beats===1?'beat':'beats'}. Let the silence breathe.`);
    const restIndex=index;
    restTimer.current=setTimeout(()=>{restTimer.current=null;if(phaseRef.current==='practice'&&indexRef.current===restIndex)advancePractice();},step.beats*60000/tempo);
    return()=>{if(restTimer.current)clearTimeout(restTimer.current);restTimer.current=null;};
  },[phase,index,tempo,lesson.steps.length,step,advancePractice]);

  const playInput=useCallback((midi:number,fromMic=false)=>{
    if(phaseRef.current==='listen'||phaseRef.current==='complete')return;
    const current=lesson.steps[indexRef.current];
    if(phaseRef.current==='practice'&&(!current||!current.notes.length))return;
    if(!fromMic){soundNote(midi);setActive(a=>[...new Set([...a,midi])]);keyTimers.current.push(setTimeout(()=>setActive(a=>a.filter(n=>n!==midi)),250));}
    if(phaseRef.current!=='practice')return;
    if(!current)return;
    const target=current.notes.map(n=>60+tonic+n);
    if(Date.now()-chordStarted.current>650){acceptedRef.current.clear();setAccepted([]);}
    if(acceptedRef.current.has(midi))return;
    attempts.current++;
    if(!target.includes(midi)){setMistake(true);setFeedback(`Try ${target.map(n=>noteName(n,tonic,notation)).join(' + ')}. You have time.`);setScore(Math.round(correct.current/attempts.current*100));return;}
    setMistake(false);correct.current++;setScore(Math.round(correct.current/attempts.current*100));
    if(!acceptedRef.current.size)chordStarted.current=Date.now();
    acceptedRef.current.add(midi);setAccepted([...acceptedRef.current]);
    if(target.every(n=>acceptedRef.current.has(n))){
      advancePractice();
    }else setFeedback('Good — add the other highlighted chord notes.');
  },[lesson,tonic,notation,advancePractice]);
  const inputRef=useRef(playInput);inputRef.current=playInput;

  useEffect(()=>{
    const down=(event:KeyboardEvent)=>{if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||(event.target instanceof HTMLElement && (['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName)||event.target.isContentEditable)))return;const offset=COMPUTER_KEYS.indexOf(event.key.toLowerCase());if(offset<0)return;event.preventDefault();void unlockAudio().then(()=>inputRef.current(60+tonicRef.current+computerOctaveRef.current+offset)).catch(()=>setFeedback('Audio could not start. Tap a piano key to try again.'));};
    window.addEventListener('keydown',down);return()=>window.removeEventListener('keydown',down);
  },[]);

  useEffect(()=>{
    if(!metronome||(phase!=='practice'&&phase!=='listen')){setBeat(0);return;}
    let count=0;
    const tick=()=>{soundBeat(count%lesson.meter===0);setBeat(count%lesson.meter+1);count++;};tick();
    const interval=setInterval(tick,60000/tempo);return()=>clearInterval(interval);
  },[metronome,phase,tempo,lesson.meter]);

  const begin=async()=>{try{await unlockAudio();stopPlayback();indexRef.current=0;setIndex(0);attempts.current=0;correct.current=0;acceptedRef.current.clear();setAccepted([]);setScore(100);setMistake(false);setPhase('practice');setFeedback(hasChords?'Play the highlighted keys. Press chord notes together.':'Play the highlighted note. We’ll wait for you.');}catch{setFeedback('Audio is unavailable. Try Safari or another recent browser.');}};
  const listen=async()=>{
    if(phaseRef.current==='listen'){stopPlayback();setPhase('ready');setFeedback('Listening paused. Start again whenever you’re ready.');return;}
    try{await unlockAudio();}catch{setFeedback('Audio is unavailable in this browser.');return;}
    stopMic();stopPlayback();setPhase('listen');setFeedback('Listen to the note lengths and follow the highlighted keys.');indexRef.current=0;setIndex(0);
    const playStep=(i:number)=>{
      if(phaseRef.current!=='listen')return;
      if(i>=lesson.steps.length){setPhase('ready');indexRef.current=0;setIndex(0);setActive([]);setFeedback('Now it’s your turn. Choose Start practice.');return;}
      const s=lesson.steps[i], duration=s.beats*60/tempo;indexRef.current=i;setIndex(i);
      const pitches=s.notes.map(n=>60+tonic+n);setActive(pitches);if(!pitches.length)stopSounds();pitches.forEach(n=>soundNote(n,duration*0.88,0.14/Math.sqrt(pitches.length)));
      timer.current=setTimeout(()=>playStep(i+1),duration*1000);
    };playStep(0);
  };

  const toggleMic=async()=>{
    if(micOn){stopMic();return;}
    setMicError('');if(hasChords){setMicError('Microphone input supports single notes. Use the on-screen or computer keyboard for chords.');return;}
    if(lesson.steps.some(step=>step.notes.some(note=>60+tonic+note<42||60+tonic+note>89))){setMicError('Microphone input supports F♯2 through F6. Use the touch or computer keyboard for the wider range in this study.');return;}
    if(!navigator.mediaDevices?.getUserMedia){setMicError('Microphone access needs HTTPS and a supported browser. The touch keyboard still works.');return;}
    const generation=++micGeneration.current;
    try {
      const ctx=await unlockAudio();const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      if(generation!==micGeneration.current){stream.getTracks().forEach(t=>t.stop());return;}
      streamRef.current=stream;const source=ctx.createMediaStreamSource(stream);micSource.current=source;const analyser=ctx.createAnalyser();analyser.fftSize=4096;source.connect(analyser);
      const samples=new Float32Array(analyser.fftSize);let candidate=-1,stable=0,lastAccepted=-1,silent=0,lastFrame=0;setMicOn(true);setFeedback('Play single notes on your piano. Use headphones to avoid speaker feedback.');
      const sample=(time:number)=>{
        if(generation!==micGeneration.current)return;
        if(time-lastFrame>55){lastFrame=time;analyser.getFloatTimeDomainData(samples);const hz=detectPitch(samples,ctx.sampleRate);
          if(hz){silent=0;const midi=Math.round(frequencyToMidi(hz));if(midi===candidate)stable++;else{candidate=midi;stable=0;}
            if(stable>=3&&midi!==lastAccepted&&Math.abs(frequencyToMidi(hz)-midi)<0.32){lastAccepted=midi;inputRef.current(midi,true);}}
          else{silent++;if(silent>=3){lastAccepted=-1;stable=0;}}
        }raf.current=requestAnimationFrame(sample);
      };raf.current=requestAnimationFrame(sample);
    } catch(error) {if(generation===micGeneration.current){stopMic();setMicError(error instanceof DOMException&&error.name==='NotAllowedError'?'Microphone permission was declined. Enable it in browser settings or use the touch keyboard.':'Could not open the microphone. Check your input device and try again.');}}
  };

  return <section className="practice-screen">
    <div className="practice-top"><button className="practice-back" onClick={onBack}><ArrowLeft size={18}/> Back to learning</button><span className="practice-original">{lesson.source==='transcription'?'ESTIMATED TRANSCRIPTION':customLesson?'YOUR CLIP EXERCISE':'ORIGINAL EXERCISE'}</span></div>
    <div className="practice-heading"><div><p className="practice-eyebrow">{lesson.category} · {lesson.level} · {lesson.duration}</p><h1>{lesson.title}</h1><p>{lesson.subtitle}</p></div><div className="practice-tonic">Sa = {westernName(60+tonic)}<small>Movable tonic</small></div></div>
    <div className="practice-layout"><div className="practice-main">
      <div className="practice-progress"><span>Phrase {Math.min(index+1,lesson.steps.length)} of {lesson.steps.length}</span><span>{phase==='complete'?'Complete':attempts.current ? `${score}% pitch accuracy` : 'Pitch practice · no timing grade'}</span><div><i style={{width:`${index/lesson.steps.length*100}%`}}/></div></div>
      <div className={`practice-stage ${mistake?'has-mistake':''}`}>
        {phase==='complete'?<div className="practice-complete"><div className="complete-check"><Check size={30}/></div><p className="practice-eyebrow">A LITTLE PROGRESS, EVERY DAY</p><h2>Beautifully done.</h2><p>You finished {lesson.title.toLowerCase()}.</p><strong>{attempts.current?`${score}%`:'—'} <span>pitch accuracy</span></strong><p className="practice-score-note">{attempts.current?'Pitch accuracy is based on correct note attempts.':'Timed rests completed. No pitched notes to grade.'}<br/>Timing and expression aren’t graded yet.</p><button className="practice-primary" onClick={begin}><RotateCcw size={17}/> Practise again</button></div>:<><div className="practice-stage-label"><span>{phase==='listen'?<><Volume2 size={14}/> LISTEN & FOLLOW</>:phase==='practice'?'YOUR TURN':'A MOMENT TO LISTEN'}</span><span>{lesson.meter}/4 time · {formatBeats(step.beats)} {step.beats===1?'beat':'beats'}</span></div><Staff notes={notes} next={next} tonic={tonic} notation={notation} beats={step.beats} nextBeats={lesson.steps[index+1]?.beats||1} hasNext={index+1<lesson.steps.length}/><div className="practice-target">{!notes.length&&<span className="rest-target">Rest · {formatBeats(step.beats)} {step.beats===1?'beat':'beats'}</span>}{notes.map(n=><span key={n} className={accepted.includes(n)?'accepted':''}>{noteName(n,tonic,notation)}{accepted.includes(n)&&<Check size={13}/>}</span>)}</div><p className="practice-feedback" role="status">{feedback}</p></>}
      </div>
      <div className="practice-controls"><button className="practice-primary" onClick={phase==='practice'?()=>{stopPlayback();setPhase('ready');setFeedback('Paused. Start practice to begin again.');}:begin} disabled={phase==='listen'}>{phase==='practice'?<Pause size={17}/>:<Play size={17}/>} {phase==='practice'?'Pause practice':'Start practice'}</button><button className="practice-secondary" onClick={listen}>{phase==='listen'?<Pause size={17}/>:<Headphones size={17}/>} {phase==='listen'?'Stop listening':'Listen first'}</button><button className="practice-icon" aria-label="Reset lesson" onClick={reset}><RotateCcw size={17}/></button></div>
      <div className="practice-keyboard-wrap" ref={keyboardRef}><div className="practice-keyboard" aria-label="Playable piano keyboard" style={{minWidth:Math.max(480,whiteCount*32)}}>{keys.map(midi=>{const black=isBlack(midi),whitesBefore=keys.filter(n=>n<midi&&!isBlack(n)).length;const target=notes.includes(midi)&&phase!=='complete';return <button key={midi} data-midi={midi} aria-label={`Play ${westernName(midi,true)}, ${noteName(midi,tonic,'carnatic')}`} className={`piano-key ${black?'black':'white'} ${target?'target':''} ${active.includes(midi)||accepted.includes(midi)?'pressed':''}`} style={black?{left:`${whitesBefore/whiteCount*100}%`,width:`${60/whiteCount}%`}:undefined} onPointerDown={async event=>{event.preventDefault();try{await unlockAudio();inputRef.current(midi);}catch{setFeedback('Sound could not start. Try another browser.');}}}><span>{notation==='both'?<>{westernName(midi)}<small>{noteName(midi,tonic,'carnatic')}</small></>:noteName(midi,tonic,notation)}</span></button>})}</div></div>
      <div className="keyboard-hint"><span><i/> Highlighted keys are your next notes</span><span>A = {westernName(60+tonic+computerOctave,true)} · W S E D F T G… · K = octave</span></div>
      <div className="keyboard-computer-range"><label htmlFor="computer-octave">Computer keyboard octave</label><select id="computer-octave" aria-label="Computer keyboard octave" value={computerOctave} onChange={e=>setComputerOctave(Number(e.target.value))}>{[-48,-36,-24,-12,0,12,24,36,48].map(shift=><option key={shift} value={shift}>A = {westernName(60+tonic+shift,true)}{shift===0?' · default':''}</option>)}</select></div><div className="keyboard-scroll-controls"><button onClick={()=>keyboardRef.current?.scrollBy({left:-180,behavior:'smooth'})} aria-label="Scroll keyboard to lower notes"><ArrowLeft size={13}/> Lower notes</button><button onClick={()=>keyboardRef.current?.scrollBy({left:180,behavior:'smooth'})} aria-label="Scroll keyboard to higher notes">Higher notes <ArrowRight size={13}/></button></div>
      <div className="practice-settings"><label>Tempo <strong>{tempo} BPM</strong><input aria-label="Practice tempo" type="range" min="30" max="200" step="1" value={tempo} disabled={phase==='listen'} onChange={e=>setTempo(Number(e.target.value))}/></label><button className={`metronome-toggle ${metronome?'enabled':''}`} aria-pressed={metronome} onClick={async()=>{try{await unlockAudio();setMetronome(m=>!m);}catch{setFeedback('Audio is unavailable.');}}}><span className="beat-dots">{Array.from({length:lesson.meter},(_,i)=><i key={i} className={beat===i+1?'lit':''}/>)}</span>Metronome {metronome?'on':'off'}</button><button className={`practice-mic ${micOn?'enabled':''}`} onClick={toggleMic} disabled={phase==='listen'} aria-pressed={micOn}>{micOn?<X size={16}/>:<Mic size={16}/>} {micOn?'Stop microphone':'Use microphone'}</button></div>
      {micError&&<p className="mic-message" role="alert">{micError}</p>}
      {micOn&&<p className="mic-message">Listening locally · Single notes only · Separate repeated notes with a brief release. Audio is never recorded or uploaded.</p>}
    </div><aside className="practice-guide"><p className="practice-eyebrow">YOUR PRACTICE COMPANION</p><h2>Small notes.<br/>Lasting progress.</h2><p>{lesson.description}</p><ol>{lesson.tips.map((tip,i)=><li key={tip}><span>{String(i+1).padStart(2,'0')}</span><p>{tip}</p></li>)}</ol><div className="practice-guide-note"><Headphones size={18}/><p>{lesson.source==='transcription'?'These notes are estimated from uploaded audio and played with synthesized tones. Full song mixes can produce errors; check the notes against your recording. Diamond markers show unquantized durations, with beat lengths written numerically.':customLesson?'This exercise plays your entered notation with synthesized tones. YouTube audio stays in your clip player; these notes have not been automatically transcribed or verified.':'This is an original learning exercise with synthesized piano tones. It is not a film-song recording or transcription.'}</p></div></aside></div>
  </section>;
}
