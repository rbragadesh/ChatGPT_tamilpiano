import { ArrowRight, BookOpen, Check, ChevronRight, Clock3, Layers3, LockKeyhole, Music2, Piano, Trophy } from 'lucide-react';
import { lessons } from './lessons';
import { getProgression, hasPassed, PASS_SCORE } from './progression';
import type { PracticeProgress } from './progression';
import './Journey.css';

interface Props {
  progress: PracticeProgress;
  onStartLesson: (id: string) => void;
  onExploreSongs: () => void;
}
const levelIcons = [BookOpen, Music2, Piano, Clock3, Layers3];

export function Journey({ progress, onStartLesson, onExploreSongs }: Props) {
  const journey = getProgression(progress);
  return <section className="level-journey" aria-labelledby="learning-path-title">
    <div className="level-journey-heading"><div><div className="eyebrow">A LITTLE PROGRESS, EVERY DAY</div><h1 id="learning-path-title">A path that grows with you<span>.</span></h1><p>Complete each stage to open the next. Your favourite music is something to work towards.</p></div><div className="level-journey-summary"><Trophy size={20}/><b>{journey.passedLessons}<span> / {journey.totalLessons}</span></b><small>exercises passed</small></div></div>
    <div className="level-journey-rule"><span className="level-rule-score">{PASS_SCORE}%</span><p>Reach <b>{PASS_SCORE}% pitch accuracy in every exercise</b> in a stage to unlock the next level. These milestones track exercise progress; timing, expression, and musical proficiency are not graded.</p></div>
    <div className="level-stage-grid">{journey.levels.map(level => {
      const Icon = levelIcons[level.number - 1];
      return <article key={level.number} className={`level-stage ${level.status}`} aria-label={`Level ${level.number}: ${level.title}, ${level.status}`}>
        <div className="level-stage-heading"><span className="level-stage-icon">{level.completed ? <Check size={23}/> : level.unlocked ? <Icon size={23}/> : <LockKeyhole size={21}/>}</span><div><div className="eyebrow">LEVEL {level.number} · {level.subtitle}</div><h2>{level.title}</h2></div><span className="level-stage-count">{level.passedLessonIds.length}/{level.lessonIds.length}</span></div>
        <p className="level-stage-description">{level.description}</p>
        <div className="level-stage-lessons">{level.lessonIds.map(id => {
          const lesson = lessons.find(item => item.id === id)!;
          const score = progress?.[id]?.score;
          const validScore = typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
          const passed = hasPassed(progress, id);
          return <button key={id} disabled={!level.unlocked} aria-label={`${level.unlocked ? passed ? 'Practise again' : 'Start' : 'Locked'}: ${lesson.title}`} onClick={() => { if (level.unlocked) onStartLesson(id); }}>
            <span className={`level-lesson-marker ${passed ? 'passed' : ''}`}>{passed ? <Check size={15}/> : level.unlocked ? <span/> : <LockKeyhole size={12}/>}</span><span className="level-lesson-copy"><b>{lesson.title}</b><small>{validScore ? `${Math.round(score)}% best${passed ? ' · passed' : ` · aim for ${PASS_SCORE}%`}` : lesson.duration}</small></span>{level.unlocked && <ChevronRight size={15}/>}
          </button>;
        })}</div>
        <div className="level-stage-status">{level.completed ? <><Check size={14}/>Stage complete</> : level.unlocked ? <><Music2 size={14}/>{level.remainingLessonIds.length} {level.remainingLessonIds.length === 1 ? 'exercise' : 'exercises'} to reach {PASS_SCORE}%</> : <><LockKeyhole size={13}/>Complete every exercise in Level {level.number - 1} at {PASS_SCORE}%</>}</div>
      </article>;
    })}</div>
    <div className="level-song-unlock"><div className="level-song-symbol">{journey.songsUnlocked ? <Music2 size={29}/> : <LockKeyhole size={27}/>}</div><div><div className="eyebrow">THE SONGS YOU WANT TO LEARN</div><h2>{journey.songsUnlocked ? 'Your song studies can begin.' : 'Song studies open at Level 2.'}</h2><p>Library entries are song references. Full film-song scores and recordings are not included. Build a playable study only from notes or audio you have the rights or permission to use. Its suggested level comes from the actual notes, not the composer or title.</p></div><button className="button primary" disabled={!journey.songsUnlocked} onClick={() => { if (journey.songsUnlocked) onExploreSongs(); }}>{journey.songsUnlocked ? 'Explore song studies' : 'Finish Level 1 first'}<ArrowRight size={16}/></button></div>
  </section>;
}
