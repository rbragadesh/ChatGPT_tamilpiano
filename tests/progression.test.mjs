import test from 'node:test';
import assert from 'node:assert/strict';
import { lessons } from '../src/lessons.ts';
import { canPractiseLesson, getProgression, hasPassed, lessonLevel, PASS_SCORE, requiredLevelForLesson, skillLevels, songLevel } from '../src/progression.ts';

const passed = (ids, score=80) => Object.fromEntries(ids.map(id=>[id,{score}]));
const custom = (steps, extra={}) => ({id:'my-authorised-study',title:'My study',subtitle:'',description:'',category:'melody',level:'Developing',duration:'1 min',bpm:60,meter:4,tips:[],steps,...extra});

test('the curriculum covers all original exercises once, in five explicit stages',()=>{
  assert.equal(PASS_SCORE,80);
  assert.deepEqual(skillLevels.map(level=>level.number),[1,2,3,4,5]);
  const ids=skillLevels.flatMap(level=>level.lessonIds);
  assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual([...ids].sort(),lessons.map(lesson=>lesson.id).sort());
  assert.equal(lessonLevel('first-notes'),1);
  assert.equal(lessonLevel('first-chord'),3);
  assert.equal(lessonLevel('melody-and-harmony'),5);
  assert.equal(lessonLevel('a-film-title-is-not-an-exercise'),undefined);
});

test('new learners can practise only the foundations and need every exercise at eighty percent',()=>{
  let state=getProgression({});
  assert.equal(state.unlockedLevel,1);
  assert.equal(state.songsUnlocked,false);
  assert.equal(state.nextLessonId,'first-notes');
  assert.deepEqual(state.levels.map(level=>level.unlocked),[true,false,false,false,false]);
  const progress=passed(skillLevels[0].lessonIds);
  progress['staff-reading'].score=79;
  state=getProgression(progress);
  assert.equal(state.unlockedLevel,1);
  assert.deepEqual(state.levels[0].remainingLessonIds,['staff-reading']);
  progress['staff-reading'].score=80;
  state=getProgression(progress);
  assert.equal(state.unlockedLevel,2);
  assert.equal(state.songsUnlocked,true);
  assert.equal(state.nextLessonId,'major-journey');
  assert.equal(state.completedLevels,1);
});

test('out-of-order scores cannot unlock skipped prerequisites or let clip scores count as curriculum exercises',()=>{
  const progress=passed(skillLevels.slice(1).flatMap(level=>level.lessonIds));
  progress['clip-first-notes']={score:100};
  progress['clip-random-melody']={score:100};
  const state=getProgression(progress);
  assert.equal(state.unlockedLevel,1);
  assert.equal(state.completedLevels,0);
  assert.equal(state.allComplete,false);
  assert.equal(state.levels[1].requirementsMet,true);
  assert.equal(state.levels[1].completed,false);
  assert.equal(state.passedLessons,11);
});

test('invalid stored scores do not pass and all completed stages retain replay access',()=>{
  for(const score of [79,101,-1,NaN,Infinity,'100',undefined])assert.equal(hasPassed({x:{score}},'x'),false);
  assert.equal(hasPassed({x:{score:80}},'x'),true);
  const state=getProgression(passed(lessons.map(lesson=>lesson.id),100));
  assert.equal(state.unlockedLevel,5);
  assert.equal(state.completedLevels,5);
  assert.equal(state.allComplete,true);
  assert.equal(state.passedLessons,14);
  assert.equal(state.nextLessonId,undefined);
  assert.ok(state.levels.every(level=>level.unlocked&&level.completed));
});

test('reference song access is level two without inventing an arrangement difficulty from metadata',()=>{
  assert.equal(songLevel({id:'a',composer:'Ilaiyaraaja',year:1982}),2);
  assert.equal(songLevel({id:'b',composer:'A. R. Rahman',year:2017}),2);
});

test('personal study prerequisites use the actual note content and preserve known curriculum levels',()=>{
  assert.equal(requiredLevelForLesson(lessons.find(lesson=>lesson.id==='first-chord')),3);
  assert.equal(requiredLevelForLesson(custom([{notes:[0],beats:1},{notes:[2],beats:1},{notes:[4],beats:1}])) ,1);
  assert.equal(requiredLevelForLesson(custom([{notes:[0],beats:1},{notes:[3],beats:1}])) ,2);
  assert.equal(requiredLevelForLesson(custom([{notes:[0,4,7],beats:4}])) ,3);
  assert.equal(requiredLevelForLesson(custom([{notes:[0],beats:1},{notes:[0,4,7],beats:4}])) ,5);
  assert.equal(requiredLevelForLesson(custom([{notes:[0],beats:0.5},{notes:[2],beats:0.5}])) ,4);
  assert.equal(requiredLevelForLesson(custom([{notes:[0,4,7,11],beats:4}])) ,5);
  assert.equal(requiredLevelForLesson(custom([{notes:[-12],beats:1},{notes:[12],beats:1}])) ,4);
  assert.equal(canPractiseLesson(lessons.find(lesson=>lesson.id==='major-journey'),{}),false);
  assert.equal(canPractiseLesson(lessons.find(lesson=>lesson.id==='major-journey'),passed(skillLevels[0].lessonIds)),true);
});

test('unquantised transcription timing and staggered chord onsets do not manufacture rhythm or combined-skill requirements',()=>{
  const simple=custom([{notes:[],beats:.46},{notes:[0],beats:.72},{notes:[],beats:.29},{notes:[2],beats:.71}],{source:'transcription'});
  assert.equal(requiredLevelForLesson(simple),1);
  const staggered=custom([{notes:[],beats:.5},{notes:[0],beats:.02},{notes:[0,4],beats:.02},{notes:[0,4,7],beats:1.5}],{source:'transcription'});
  assert.equal(requiredLevelForLesson(staggered),3);
  const fast=custom([{notes:[0],beats:.2},{notes:[2],beats:.2},{notes:[4],beats:.2}],{source:'transcription'});
  assert.equal(requiredLevelForLesson(fast),4);
});
