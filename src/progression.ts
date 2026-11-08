import { lessons } from './lessons.ts';
import type { Lesson } from './lessons.ts';
import type { Song } from './catalogue.ts';

export const PASS_SCORE = 80;
export type SkillLevelNumber = 1 | 2 | 3 | 4 | 5;
export type PracticeProgress = Record<string, { score: number }>;
export interface SkillLevel {
  number: SkillLevelNumber;
  title: string;
  subtitle: string;
  description: string;
  lessonIds: string[];
}

export const skillLevels: SkillLevel[] = [
  { number: 1, title: 'Find your notes', subtitle: 'Foundations', description: 'Find Sa, connect two naming systems, and begin reading the treble staff.', lessonIds: ['first-notes', 'sa-ri-ga', 'staff-reading'] },
  { number: 2, title: 'Follow a melody', subtitle: 'Melody', description: 'Explore scales, melodic direction, and a wider range of notes. Personal song studies become available here.', lessonIds: ['major-journey', 'minor-mood', 'five-note-bloom', 'call-response'] },
  { number: 3, title: 'Give music its roots', subtitle: 'Harmony basics', description: 'Put notes together and find the bass movement behind a chord sequence.', lessonIds: ['first-chord', 'left-hand-roots'] },
  { number: 4, title: 'Keep the music moving', subtitle: 'Rhythm & changes', description: 'Practise three-beat time, shorter note values, offbeats, and chord changes.', lessonIds: ['waltz-time', 'steady-eighths', 'syncopation', 'chord-changes'] },
  { number: 5, title: 'Bring it together', subtitle: 'Melody & harmony', description: 'Combine a melody with supporting harmony, then explore more demanding personal studies.', lessonIds: ['melody-and-harmony'] },
];

const levelsByLesson = new Map(skillLevels.flatMap(level => level.lessonIds.map(id => [id, level.number] as const)));

export function lessonLevel(id: string): SkillLevelNumber | undefined {
  return levelsByLesson.get(id);
}

export function hasPassed(progress: PracticeProgress, id: string): boolean {
  const score = progress?.[id]?.score;
  return typeof score === 'number' && Number.isFinite(score) && score >= PASS_SCORE && score <= 100;
}

export interface LevelProgress extends SkillLevel {
  unlocked: boolean;
  completed: boolean;
  requirementsMet: boolean;
  passedLessonIds: string[];
  remainingLessonIds: string[];
  status: 'locked' | 'available' | 'complete';
}

/** Only a continuous chain of completed stages unlocks the next stage. */
export function getProgression(progress: PracticeProgress) {
  let previousComplete = true;
  const levels: LevelProgress[] = skillLevels.map(level => {
    const passedLessonIds = level.lessonIds.filter(id => hasPassed(progress, id));
    const remainingLessonIds = level.lessonIds.filter(id => !hasPassed(progress, id));
    const unlocked = previousComplete;
    const requirementsMet = remainingLessonIds.length === 0;
    const completed = unlocked && requirementsMet;
    previousComplete = completed;
    return { ...level, unlocked, completed, requirementsMet, passedLessonIds, remainingLessonIds, status: !unlocked ? 'locked' : completed ? 'complete' : 'available' };
  });
  const currentLevel = [...levels].reverse().find(level => level.unlocked)!.number;
  const completedLevels = levels.filter(level => level.completed).length;
  return {
    currentLevel,
    unlockedLevel: currentLevel,
    completedLevels,
    allComplete: completedLevels === skillLevels.length,
    passedLessons: skillLevels.reduce((count, level) => count + level.lessonIds.filter(id => hasPassed(progress, id)).length, 0),
    totalLessons: skillLevels.reduce((count, level) => count + level.lessonIds.length, 0),
    nextLessonId: levels.find(level => level.unlocked && !level.completed)?.remainingLessonIds[0],
    songsUnlocked: currentLevel >= 2,
    levels,
  };
}

/** A reference title does not establish its arrangement's actual difficulty. */
export function songLevel(_song: Song): SkillLevelNumber {
  return 2;
}

/**
 * Suggested prerequisites for an actual saved study, based on its note content.
 * These are transparent learning-path rules, not a musician's difficulty grade.
 * Unquantised transcription timings are not mistaken for written syncopation.
 */
export function requiredLevelForLesson(lesson: Lesson): SkillLevelNumber {
  const builtIn = lessonLevel(lesson.id);
  if (builtIn) return builtIn;
  let required: SkillLevelNumber = 1;
  const raise = (level: SkillLevelNumber) => { if (level > required) required = level; };
  const bpm = Number.isFinite(lesson.bpm) && lesson.bpm > 0 ? lesson.bpm : 76;
  const notes = lesson.steps.flatMap(step => step.notes).filter(Number.isFinite);
  if (!notes.length) return 1;
  const low = Math.min(...notes), high = Math.max(...notes), span = high - low;
  const majorPositions = new Set([0, 2, 4, 5, 7, 9, 11]);
  if (span > 7 || notes.some(note => !majorPositions.has(((note % 12) + 12) % 12))) raise(2);
  if (span > 12 || low < 0 || high > 12) raise(3);
  if (span > 24) raise(4);
  if (span > 36) raise(5);

  let elapsed = 0;
  let previous: number[] = [];
  let hasMelody = false, hasHarmony = false;
  const attackTimes: number[] = [];
  for (const step of lesson.steps) {
    const voices = [...new Set(step.notes)].sort((a, b) => a - b);
    const seconds = Math.max(0, step.beats) * 60 / bpm;
    if (voices.length > 1) raise(3);
    if (voices.length >= 4) raise(5);
    if (voices.length > 1 && seconds >= 0.15) hasHarmony = true;
    if (voices.length === 1 && seconds >= 0.15) hasMelody = true;
    if (previous.length === 1 && voices.length === 1) {
      const leap = Math.abs(voices[0] - previous[0]);
      if (leap > 7) raise(3);
      if (leap > 12) raise(4);
    }
    const added = voices.some(note => !previous.includes(note));
    const repeatedAttack = voices.length > 0 && voices.join(',') === previous.join(',');
    if (voices.length && (added || repeatedAttack)) {
      const last = attackTimes[attackTimes.length - 1];
      // Small onset differences within a detected chord are not fast melodies.
      if (last === undefined || elapsed - last > 0.075) attackTimes.push(elapsed);
    }
    if (lesson.source !== 'transcription' && voices.length && (step.beats < 1 || !Number.isInteger(step.beats))) raise(4);
    previous = voices;
    elapsed += seconds;
  }
  if (hasMelody && hasHarmony) raise(5);
  if (lesson.source === 'transcription') {
    const intervals = attackTimes.slice(1).map((time, index) => time - attackTimes[index]);
    if (intervals.some(seconds => seconds < 0.25)) raise(4);
    if (intervals.some(seconds => seconds < 0.125)) raise(5);
  }
  return required;
}

export function canPractiseLesson(lesson: Lesson, progress: PracticeProgress): boolean {
  return requiredLevelForLesson(lesson) <= getProgression(progress).unlockedLevel;
}

export function levelLessons(number: SkillLevelNumber) {
  const ids = skillLevels.find(level => level.number === number)?.lessonIds || [];
  return ids.map(id => lessons.find(lesson => lesson.id === id)!).filter(Boolean);
}
