import test from 'node:test';
import assert from 'node:assert/strict';
import { chordSuggestions, createLocalResult, decodeNotes, FFT_HOP, onsetPeaks, SAMPLE_RATE } from '../src/local-dsp.ts';

test('local onset peak selection preserves strong separated attacks and rejects tiny fluctuations',()=>{
  const peaks=new Float32Array(60);
  peaks[10]=0.8;peaks[15]=0.6;peaks[35]=0.9;peaks[50]=0.3;
  assert.deepEqual(onsetPeaks(peaks),[10,35]);
});

test('local activation decoding preserves polyphonic pitches and actual timing',()=>{
  const count=100,pitches=88,step=FFT_HOP/SAMPLE_RATE;
  const frames=new Float32Array(count*pitches),onsets=new Float32Array(frames.length);
  const times=Float64Array.from({length:count},(_,i)=>i*step);
  for(const midi of [60,64,67])for(let frame=20;frame<80;frame++)frames[frame*pitches+midi-21]=0.75;
  const notes=decodeNotes(frames,onsets,times,count*step);
  assert.deepEqual(notes.map(n=>n.midi),[60,64,67]);
  assert.ok(Math.abs(notes[0].start-20*step)<0.0001);
  assert.ok(Math.abs(notes[0].end-80*step)<0.0001);
  assert.equal(notes[0].confidence,0.75);
  const chords=chordSuggestions(notes,count*step);
  assert.equal(chords[0].label,'C');
  assert.deepEqual(chords[0].notes,[60,64,67]);
});

test('local decoder splits repeated note onsets and rejects weak short noise',()=>{
  const count=100,pitches=88,step=FFT_HOP/SAMPLE_RATE;
  const frames=new Float32Array(count*pitches),onsets=new Float32Array(frames.length);
  const times=Float64Array.from({length:count},(_,i)=>i*step);
  for(let frame=10;frame<90;frame++)frames[frame*pitches+39]=0.75;
  onsets[50*pitches+39]=0.9;
  for(let frame=10;frame<14;frame++)frames[frame*pitches+40]=0.8;
  for(let frame=20;frame<80;frame++)frames[frame*pitches+41]=0.35;
  const notes=decodeNotes(frames,onsets,times,count*step);
  assert.equal(notes.length,2);
  assert.deepEqual(notes.map(n=>n.midi),[60,60]);
  assert.equal(notes[0].end,notes[1].start);
});

test('chord suggestions do not invent harmony for extra pitch classes or combine unplayed voicings',()=>{
  const events=(midi,start=0,end=1)=>({midi,start,end,confidence:0.8});
  assert.deepEqual(chordSuggestions([60,64,67,69].map(midi=>events(midi)),1),[]);
  const notes=[...[60,64,67].map(midi=>events(midi)),...[64,67,72].map(midi=>events(midi,1,2))];
  assert.deepEqual(chordSuggestions(notes,2).map(c=>c.notes),[[60,64,67],[64,67,72]]);
  assert.equal(chordSuggestions([57,60,64].map(midi=>events(midi)),1)[0].label,'Am');
});

test('silent local result remains an empty draft with a clear warning',()=>{
  const result=createLocalResult([],1.5,20);
  assert.deepEqual(result.notes,[]);assert.deepEqual(result.chords,[]);
  assert.equal(result.sourceStart,20);assert.equal(result.duration,1.5);
  assert.match(result.warnings[0],/No confident notes/);
});
