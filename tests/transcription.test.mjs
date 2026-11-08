import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServiceUrl, parseTranscriptionJob, parseTranscriptionResult, transcriptionToLesson } from '../src/transcription.ts';

const clip={id:'test',title:'My passage',videoId:'dQw4w9WgXcQ',start:80,end:84,notes:'',bpm:60,createdAt:0};
const result={notes:[{midi:60,start:.5,end:1.5,confidence:.8},{midi:64,start:1,end:2,confidence:.7},{midi:67,start:3,end:3.5,confidence:.9}],chords:[{label:'C',start:1,end:2,confidence:.6,notes:[60,64,67]}],duration:4,sourceStart:80,warnings:['Review the automatic draft.']};

test('service URLs permit HTTPS paths and loopback development without embedded credentials',()=>{
  assert.equal(normalizeServiceUrl(' https://audio.example.org/isai/ '),'https://audio.example.org/isai');
  assert.equal(normalizeServiceUrl('http://127.0.0.1:8000/'),'http://127.0.0.1:8000');
  assert.equal(normalizeServiceUrl('http://[::1]:8000/'),'http://[::1]:8000');
  for(const url of ['http://audio.example.org','https://user:secret@example.org','https://example.org/?token=a','https://example.org/#secret','file:///tmp/audio','javascript:alert(1)'])assert.throws(()=>normalizeServiceUrl(url));
});

test('job and result validation reject malformed service output before creating lesson state',()=>{
  assert.equal(parseTranscriptionJob({id:'job-1',status:'completed',result}).result.notes.length,3);
  assert.throws(()=>parseTranscriptionJob({id:'../other',status:'queued'}));
  assert.throws(()=>parseTranscriptionJob({id:'ok',status:'completed'}));
  assert.throws(()=>parseTranscriptionResult({...result,duration:61}));
  assert.throws(()=>parseTranscriptionResult({...result,notes:[{midi:60,start:0,end:1,confidence:2}]}));
  assert.throws(()=>parseTranscriptionResult({...result,notes:[{midi:60,start:2,end:1,confidence:.8}]}));
  assert.throws(()=>parseTranscriptionResult({...result,notes:[{midi:200,start:0,end:1,confidence:.8}]}));
  assert.throws(()=>parseTranscriptionResult({...result,chords:[{label:'C',start:0,end:1,confidence:.8,notes:['C']}]}));
});

test('detected-note lessons preserve polyphony, rests, and total source timing',()=>{
  const lesson=transcriptionToLesson(clip,result,'detected');
  assert.equal(lesson.source,'transcription');
  assert.ok(Math.abs(lesson.steps.reduce((sum,s)=>sum+s.beats,0)-4)<1e-9);
  assert.deepEqual(lesson.steps.map(s=>s.notes),[[],[0],[0,4],[4],[],[7],[]]);
  assert.equal(lesson.steps[0].beats,.5);
  assert.equal(lesson.steps[2].beats,.5);
});

test('melody studies select the upper detected voice and label the approximation',()=>{
  const lesson=transcriptionToLesson(clip,result,'melody');
  assert.ok(lesson.description.includes('rather than the main melody'));
  assert.ok(lesson.steps.every(s=>s.notes.length<=1));
  assert.ok(lesson.steps.some(s=>s.notes[0]===4));
  assert.ok(Math.abs(lesson.steps.reduce((sum,s)=>sum+s.beats,0)-4)<1e-9);
});

test('chord studies preserve suggested chord pitches and refuse missing chord candidates',()=>{
  const lesson=transcriptionToLesson(clip,result,'chords');
  assert.equal(lesson.category,'chords');
  assert.deepEqual(lesson.steps.map(s=>s.notes),[[],[0,4,7],[]]);
  assert.throws(()=>transcriptionToLesson(clip,{...result,chords:[]},'chords'),/No playable chord/);
  assert.throws(()=>transcriptionToLesson(clip,{...result,notes:[]}),/No playable notes/);
});


test('adjacent repeated pitches remain separate attacks rather than one long held note',()=>{
  const repeated={...result,notes:[{midi:60,start:0,end:1,confidence:.8},{midi:60,start:1,end:2,confidence:.9}],chords:[],duration:2};
  const lesson=transcriptionToLesson(clip,repeated,'melody');
  assert.deepEqual(lesson.steps,[{notes:[0],beats:1},{notes:[0],beats:1}]);
});
