import { MAX_AUDIO_BYTES, MAX_EXCERPT_SECONDS, parseTranscriptionResult } from './transcription';
import type { TranscriptionResult } from './transcription';
import { SAMPLE_RATE } from './local-dsp';

export interface LocalTranscriptionOptions { signal?:AbortSignal; onProgress?:(message:string)=>void }
type WorkerReply={type:'progress';message:string}|{type:'result';result:unknown}|{type:'error';message:string};
const MAX_FILE_SECONDS=600;
let decodeInFlight=false;
const cancelled=()=>new DOMException('Cancelled','AbortError');
const assertActive=(signal?:AbortSignal)=>{if(signal?.aborted)throw cancelled();};

/** Read duration without decoding a long compressed recording into phone memory. */
async function inspectDuration(file:File,signal?:AbortSignal):Promise<number|undefined> {
  return new Promise((resolve,reject)=>{
    const audio=document.createElement('audio'),url=URL.createObjectURL(file);
    let settled=false;
    const finish=(duration?:number,error?:Error)=>{
      if(settled)return;settled=true;
      audio.onloadedmetadata=null;audio.onerror=null;
      clearTimeout(timer);signal?.removeEventListener('abort',abort);audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);
      if(error)reject(error);else resolve(duration);
    };
    const abort=()=>finish(undefined,cancelled());
    const timer=setTimeout(()=>finish(),5000);
    audio.onloadedmetadata=()=>finish(Number.isFinite(audio.duration)?audio.duration:undefined);
    audio.onerror=()=>finish();audio.preload='metadata';audio.src=url;
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
}

/** Analyse a local file. Audio is decoded on this device and never uploaded. */
export async function transcribeLocal(file:File,start:number,end:number,options:LocalTranscriptionOptions={}):Promise<TranscriptionResult> {
  const {signal,onProgress}=options;
  assertActive(signal);
  if(!file.size)throw new Error('Choose a recording with audio in it.');
  if(file.size>MAX_AUDIO_BYTES)throw new Error('Choose an audio file no larger than 25 MiB. Trim longer recordings first.');
  if(decodeInFlight)throw new Error('The previous recording is still decoding. Wait a moment before starting another passage.');
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<0.15||end-start>MAX_EXCERPT_SECONDS)throw new Error('Choose a passage between 0.15 and 60 seconds long.');
  if(typeof Worker==='undefined'||typeof WebAssembly==='undefined')throw new Error('This browser cannot run the local note model. Try a recent version of Safari, Chrome, or Firefox.');
  const OfflineContext=window.OfflineAudioContext||(window as unknown as {webkitOfflineAudioContext?:typeof OfflineAudioContext}).webkitOfflineAudioContext;
  if(!OfflineContext)throw new Error('This browser cannot decode audio locally. Try a recent version of Safari or Chrome.');
  onProgress?.('Checking your recording on this device…');
  const knownDuration=await inspectDuration(file,signal);
  assertActive(signal);
  if(knownDuration!==undefined&&knownDuration>MAX_FILE_SECONDS)throw new Error('For phone memory, choose a recording of 10 minutes or less. Trim a longer recording before importing it.');
  if(knownDuration!==undefined&&end>knownDuration+0.04)throw new Error('The selected end time is beyond this recording. Choose times inside the file or use the already-trimmed option.');
  onProgress?.('Decoding your selected audio locally…');
  assertActive(signal);
  if(decodeInFlight)throw new Error('The previous recording is still decoding. Wait a moment before starting another passage.');
  const context=new OfflineContext(1,1,SAMPLE_RATE);
  let decoded:AudioBuffer|null;
  try {decodeInFlight=true;const bytes=await file.arrayBuffer();assertActive(signal);decoded=await context.decodeAudioData(bytes);}
  catch {assertActive(signal);throw new Error('Your browser could not decode this file. Try WAV, MP3, or M4A exported by your device.');}
  finally {decodeInFlight=false;}
  assertActive(signal);
  if(decoded.duration>MAX_FILE_SECONDS)throw new Error('Choose a recording of 10 minutes or less to limit phone memory.');
  if(end>decoded.duration+0.04||start>=decoded.duration)throw new Error('Choose a start and end time inside the imported recording.');
  const sourceEnd=Math.min(end,decoded.duration),first=Math.floor(start*decoded.sampleRate),last=Math.min(decoded.length,Math.floor(sourceEnd*decoded.sampleRate));
  if(last-first<decoded.sampleRate*0.15)throw new Error('Choose at least 0.15 seconds of audio.');
  const mono=new Float32Array(last-first);
  for(let channel=0;channel<decoded.numberOfChannels;channel++) {
    const input=decoded.getChannelData(channel);
    for(let i=first;i<last;i++)mono[i-first]+=input[i]/decoded.numberOfChannels;
  }
  let samples=mono;
  // decodeAudioData normally resamples to the context's rate. Keep a native
  // resampling fallback for browsers that return the original sample rate.
  if(decoded.sampleRate!==SAMPLE_RATE) {
    const resampler=new OfflineContext(1,Math.ceil(mono.length*SAMPLE_RATE/decoded.sampleRate),SAMPLE_RATE);
    const buffer=resampler.createBuffer(1,mono.length,decoded.sampleRate);buffer.copyToChannel(mono,0);
    const source=resampler.createBufferSource();source.buffer=buffer;source.connect(resampler.destination);source.start();
    samples=(await resampler.startRendering()).getChannelData(0).slice();
  }
  decoded=null;
  assertActive(signal);
  const baseUrl=new URL(import.meta.env.BASE_URL,window.location.href).href;
  return new Promise((resolve,reject)=>{
    let worker:Worker;
    try {worker=new Worker(new URL('./transcription.worker.ts',import.meta.url),{type:'module'});}
    catch {reject(new Error('The local audio worker could not start. Reload the app and try again.'));return;}
    const abort=()=>finish(undefined,cancelled());
    let settled=false;
    const finish=(result?:TranscriptionResult,error?:Error)=>{
      if(settled)return;settled=true;clearTimeout(timeout);signal?.removeEventListener('abort',abort);worker.terminate();
      if(error)reject(error);else resolve(result!);
    };
    const timeout=setTimeout(()=>finish(undefined,new Error('Local analysis took too long. Try a shorter passage and keep this app open.')),10*60*1000);
    worker.onmessage=(event:MessageEvent<WorkerReply>)=>{
      if(settled)return;
      const reply=event.data;
      if(reply.type==='progress')onProgress?.(reply.message);
      else if(reply.type==='error')finish(undefined,new Error(reply.message));
      else if(reply.type==='result') {
        try{finish(parseTranscriptionResult(reply.result));}
        catch(error){finish(undefined,error instanceof Error?error:new Error('The local model returned an invalid draft.'));}
      }
    };
    worker.onerror=()=>finish(undefined,new Error('The local model could not run in this browser. Try a shorter recording or a recent browser.'));
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    worker.postMessage({type:'analyse',samples:samples.buffer,sourceStart:start,baseUrl},[samples.buffer]);
  });
}
