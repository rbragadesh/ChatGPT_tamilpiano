import type { InferenceSession } from 'onnxruntime-web/wasm';
import { createLocalResult, decodeNotes, FFT_HOP, MODEL_SHA256, OVERLAP_FRAMES, SAMPLE_RATE, WINDOW_SAMPLES } from './local-dsp';

interface Request {type:'analyse';samples:ArrayBuffer;sourceStart:number;baseUrl:string}
const workerScope=self as unknown as {onmessage:((event:MessageEvent<Request>)=>void)|null;postMessage:(value:unknown)=>void};
const progress=(message:string)=>workerScope.postMessage({type:'progress',message});

workerScope.onmessage=async(event)=>{
  let session:InferenceSession|undefined;
  try {
    const request=event.data;
    if(request.type!=='analyse')throw new Error('Invalid local analysis request.');
    const audio=new Float32Array(request.samples),duration=audio.length/SAMPLE_RATE;
    if(!audio.length||duration>60.01||!Number.isFinite(request.sourceStart)||request.sourceStart<0)throw new Error('Choose an audio passage of up to 60 seconds.');
    let peak=0;
    for(const sample of audio){if(!Number.isFinite(sample))throw new Error('The recording contains invalid audio samples.');peak=Math.max(peak,Math.abs(sample));}
    if(peak<0.0001){workerScope.postMessage({type:'result',result:createLocalResult([],duration,request.sourceStart)});return;}
    progress('Loading the local note model. The first run may take a moment…');
    // Runtime files are copied from the pinned npm package into one same-origin
    // directory. A runtime-only import prevents Vite from duplicating the 15 MiB
    // WASM binary inside another assets chunk.
    const ort=await import(/* @vite-ignore */ new URL('onnx/ort.wasm.bundle.min.mjs',request.baseUrl).href) as typeof import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads=1;
    ort.env.wasm.proxy=false;
    ort.env.wasm.wasmPaths=new URL('onnx/',request.baseUrl).href;
    const response=await fetch(new URL('models/basic-pitch-0.4.0.onnx',request.baseUrl));
    if(!response.ok)throw new Error('The local note model could not load. Open Isai online once, then try again.');
    const model=await response.arrayBuffer();
    const digest=await crypto.subtle.digest('SHA-256',model);
    const hex=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(hex!==MODEL_SHA256)throw new Error('The note model failed its integrity check. Reload the app while online.');
    session=await ort.InferenceSession.create(model,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    const overlap=OVERLAP_FRAMES*FFT_HOP,stride=WINDOW_SAMPLES-overlap,leftPad=overlap/2,halfFrames=OVERLAP_FRAMES/2;
    const totalWindows=Math.ceil((audio.length+leftPad)/stride);
    const chunks:{frames:Float32Array;onsets:Float32Array;times:Float64Array}[]=[];
    let windowsDone=0,totalFrames=0,pitchCount=88;
    for(let offset=0;offset<audio.length+leftPad;offset+=stride) {
      const window=new Float32Array(WINDOW_SAMPLES),sourceFirst=Math.max(0,offset-leftPad),windowFirst=Math.max(0,leftPad-offset);
      window.set(audio.subarray(sourceFirst,Math.min(audio.length,sourceFirst+WINDOW_SAMPLES-windowFirst)),windowFirst);
      const input=new ort.Tensor('float32',window,[1,WINDOW_SAMPLES,1]);
      const outputs=await session.run({'serving_default_input_2:0':input},['StatefulPartitionedCall:1','StatefulPartitionedCall:2']);
      input.dispose();
      const frameTensor=outputs['StatefulPartitionedCall:1'],onsetTensor=outputs['StatefulPartitionedCall:2'];
      const frames=frameTensor.data as Float32Array,onsets=onsetTensor.data as Float32Array;
      const frameCount=Number(frameTensor.dims[1]);pitchCount=Number(frameTensor.dims[2]);
      if(pitchCount!==88||onsetTensor.dims.join(',')!==frameTensor.dims.join(','))throw new Error('The model returned an unsupported shape.');
      const indices:number[]=[],times:number[]=[];
      for(let i=halfFrames;i<frameCount-halfFrames;i++) {
        const time=(offset+i*FFT_HOP-leftPad)/SAMPLE_RATE;
        if(time>=0&&time<duration){indices.push(i);times.push(time);}
      }
      const retainedFrames=new Float32Array(indices.length*pitchCount),retainedOnsets=new Float32Array(retainedFrames.length);
      indices.forEach((index,i)=>{retainedFrames.set(frames.subarray(index*pitchCount,(index+1)*pitchCount),i*pitchCount);retainedOnsets.set(onsets.subarray(index*pitchCount,(index+1)*pitchCount),i*pitchCount);});
      chunks.push({frames:retainedFrames,onsets:retainedOnsets,times:Float64Array.from(times)});totalFrames+=times.length;
      frameTensor.dispose();onsetTensor.dispose();
      windowsDone++;progress(`Finding notes on this device… ${Math.round(windowsDone/totalWindows*100)}%`);
    }
    const frames=new Float32Array(totalFrames*pitchCount),onsets=new Float32Array(frames.length),times=new Float64Array(totalFrames);
    let position=0;
    for(const chunk of chunks){frames.set(chunk.frames,position*pitchCount);onsets.set(chunk.onsets,position*pitchCount);times.set(chunk.times,position);position+=chunk.times.length;}
    progress('Preparing note timings and chord suggestions…');
    const notes=decodeNotes(frames,onsets,times,duration,pitchCount);
    workerScope.postMessage({type:'result',result:createLocalResult(notes,duration,request.sourceStart)});
  }catch(error) {
    workerScope.postMessage({type:'error',message:error instanceof Error?error.message:'Local note analysis failed. Try a shorter, clearer recording.'});
  }finally {
    await session?.release();
  }
};
