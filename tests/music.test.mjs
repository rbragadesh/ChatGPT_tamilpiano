import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, frequencyToMidi, noteFrequency, noteName, swaraName, westernName } from '../src/music.ts';
import { lessons } from '../src/lessons.ts';

test('Western names stay fixed while Carnatic Sa moves with the selected tonic',()=>{
  assert.equal(westernName(60,true),'C4');
  assert.equal(swaraName(60,0),'S');
  assert.equal(swaraName(62,2),'S');
  assert.equal(swaraName(66,2),'G₃');
  assert.equal(noteName(66,2,'both'),'F♯ · G₃');
  assert.equal(swaraName(74,2),'Ṡ');
  assert.equal(swaraName(84,0),'Ṡ²');
  assert.equal(swaraName(36,0),'Ṣ²');
});

test('equal temperament frequency conversions round-trip across the lesson range',()=>{
  for(let midi=48;midi<=96;midi++)assert.ok(Math.abs(frequencyToMidi(noteFrequency(midi))-midi)<1e-9);
  assert.equal(noteFrequency(69),440);
});

test('microphone detector rejects silence and detects single-note fundamental pitches',()=>{
  assert.equal(detectPitch(new Float32Array(4096),48000),null);
  for(const midi of [48,60,64,69,72,79]){
    const hz=noteFrequency(midi);
    const samples=Float32Array.from({length:4096},(_,i)=>0.2*Math.sin(2*Math.PI*hz*i/48000)+0.03*Math.sin(4*Math.PI*hz*i/48000));
    const detected=detectPitch(samples,48000);
    assert.notEqual(detected,null);
    assert.ok(Math.abs(frequencyToMidi(detected)-midi)<0.05,`expected MIDI ${midi}, got ${frequencyToMidi(detected)}`);
  }
});

test('all original lessons have playable, bounded notes and nonzero beat lengths',()=>{
  assert.ok(lessons.length>=12);
  assert.equal(new Set(lessons.map(l=>l.id)).size,lessons.length);
  assert.ok(lessons.some(l=>l.steps.some(s=>s.notes.length>1)),'chord practice exists');
  assert.ok(lessons.some(l=>l.steps.some(s=>s.beats<1)),'rhythm subdivisions exist');
  for(const lesson of lessons){
    assert.ok(lesson.steps.length>=4);
    assert.ok(lesson.bpm>=40&&lesson.bpm<=140);
    for(const step of lesson.steps){
      assert.ok(step.beats>0);
      assert.ok(step.notes.length>0);
      for(const note of step.notes)assert.ok(Number.isInteger(note)&&note>=0&&note<=12);
    }
  }
});
