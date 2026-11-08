import { useEffect, useRef, useState } from 'react';
import { catalogue, composers, type Song } from './catalogue';
import './Library.css';
import { top100SongIds } from './top100-data';
const top100Set=new Set(top100SongIds);
const top100Order=new Map(top100SongIds.map((id,index)=>[id,index]));
import { lessonLevel, songLevel } from './progression';

function Heart({ filled = false }: { filled?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>;
}

export function SongArtwork({ song }: { song: Song }) {
  return <div className={`song-art art-${song.color}`} aria-hidden="true">
    <div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-orbit orbit-three"/>
    <span className="art-year">{song.year}</span><span className="art-note">♪</span>
    <div className="art-caption"><span>TAMIL CLASSICS</span><strong>{song.film}</strong></div>
    <div className="art-keys">{Array.from({length: 8}, (_, i) => <i key={i}/>)}</div>
  </div>;
}

export function SongCard({song, onSelect, saved = false, onSave}: {song: Song; onSelect: (song: Song) => void; saved?: boolean; onSave?: (id: string) => void}) {
  return <article className="song-card">
    <button className="song-cover-button" onClick={() => onSelect(song)} aria-label={`Explore ${song.title}`}><SongArtwork song={song}/><span className="song-open">↗</span></button>
    <div className="song-card-info"><div><button className="song-title-button" onClick={() => onSelect(song)}>{song.title}</button><p>{song.composer} <span>·</span> {song.year}</p></div>
    {onSave && <button className={`song-save ${saved ? 'is-saved' : ''}`} aria-label={`${saved ? 'Unsave' : 'Save'} ${song.title}`} aria-pressed={saved} onClick={() => onSave(song.id)}><Heart filled={saved}/></button>}</div>
    <div className="song-card-foot"><span>{song.film}</span><span className="reference-tag" title="Private song studies unlock at Level 2; reference metadata is always available.">Reference · Study L{songLevel(song)}</span></div>
  </article>;
}

function readFavorites(): string[] {
  try { const stored = JSON.parse(localStorage.getItem('isai-favorite-songs') || '[]'); return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
}

export function SongDetail({song, onClose, onPractice, onAddSong, unlockedLevel=1, onViewJourney}: {song: Song; onClose: () => void; onPractice: (lessonId: string) => void; onAddSong?:(song:Song)=>void; unlockedLevel?:number; onViewJourney?:()=>void}) {
  const songStudyLevel=songLevel(song);
  const foundationId=(lessonLevel(song.lessonId)||1)<=unlockedLevel?song.lessonId:'first-notes';
  const source='sourceUrl' in song && typeof song.sourceUrl==='string' && song.sourceUrl.startsWith('https://')?song.sourceUrl:undefined;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="song-dialog" ref={dialog} onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }} aria-labelledby="song-detail-title">
    <button className="dialog-close" aria-label="Close song details" onClick={onClose}>×</button>
    <SongArtwork song={song}/>
    <div className="song-detail-content"><span className="eyebrow">THE SONGBOOK · REFERENCE</span><h2 id="song-detail-title">{song.title}</h2>
      <p className="song-detail-meta">{song.film} · {song.year}<br/>Music by {song.composer}</p>
      <div className="reference-explanation"><strong>A song to work toward</strong><p>This is a discovery reference. A verified piano arrangement and recording are not included. Use your own authorised notes or an audio draft to create a private song study.</p></div>
      <h3>Build the skills first</h3><p>{song.skill}. Try an original guided exercise, then listen for these ideas in the song. The exercise is not this song’s melody or chord chart.</p>
      <button className="library-primary" onClick={() => onPractice(foundationId)}>Practice the foundation <span>→</span></button>
      {onAddSong&&<div className="song-study-action"><span className="song-study-level">SONG STUDIES · LEVEL {songStudyLevel}</span><p>{unlockedLevel>=songStudyLevel?'Create a private study, then add notation or audio you have the rights to transcribe. The catalogue does not supply this song’s score.':'Complete the foundation level with at least 80% pitch accuracy in each lesson to unlock creating song studies. You can browse references at any time.'}</p><button className="library-primary" disabled={unlockedLevel<songStudyLevel} onClick={()=>onAddSong(song)}>Create my song study <span>{unlockedLevel>=songStudyLevel?'→':'Locked'}</span></button>{unlockedLevel<songStudyLevel&&onViewJourney&&<button className="library-journey-link" onClick={onViewJourney}>See my learning levels →</button>}</div>}
      {source&&<a className="library-listen" href={source} target="_blank" rel="noopener noreferrer">View metadata source <span>↗</span></a>}
      <a className="library-listen" href={`https://musescore.com/sheetmusic?text=${encodeURIComponent(`${song.title} ${song.film} piano`)}`} target="_blank" rel="noopener noreferrer">Search sheet music on MuseScore <span>↗</span></a><p className="musescore-status">Search link only. A matching score and its permissions have not been verified; no MuseScore notation is bundled.</p><a className="library-listen" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.title} ${song.film} official song`)}`} target="_blank" rel="noopener noreferrer">Find a recording on YouTube <span>↗</span></a>
    </div>
  </dialog>;
}

export function Library({onPractice, initialComposer, onAddSong, unlockedLevel=1, onViewJourney}: {onPractice: (lessonId: string) => void; initialComposer?: string; onAddSong?:(song:Song)=>void; unlockedLevel?:number; onViewJourney?:()=>void}) {
  const [search, setSearch] = useState('');
  const [composer, setComposer] = useState(initialComposer || 'All composers');
  const [era, setEra] = useState('All eras');
  const [savedOnly, setSavedOnly] = useState(false);
  const [top100Only,setTop100Only]=useState(false);
  const [favorites, setFavorites] = useState<string[]>(readFavorites);
  const [selected, setSelected] = useState<Song | null>(null);
  const [limit, setLimit] = useState(12);
  const [sort, setSort] = useState('curated');
  const [saveNotice, setSaveNotice] = useState('');
  useEffect(() => { setComposer(initialComposer || 'All composers'); }, [initialComposer]);
  useEffect(() => { setLimit(12); }, [search, composer, era, savedOnly, top100Only, sort]);
  const toggleFavorite = (id: string) => setFavorites(current => {
    const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id];
    try { localStorage.setItem('isai-favorite-songs', JSON.stringify(next)); } catch { setSaveNotice('Your browser could not save favourites. They will stay available for this visit.'); }
    return next;
  });
  const filtered = catalogue.filter(song => {
    const match = `${song.title} ${song.film} ${song.composer} ${song.year}`.toLowerCase().includes(search.trim().toLowerCase());
    return match && (composer === 'All composers' || song.composer === composer) &&
      (era === 'All eras' || Math.floor(song.year / 10) * 10 === Number(era)) && (!savedOnly || favorites.includes(song.id)) && (!top100Only || top100Set.has(song.id));
  }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'newest' ? b.year - a.year : top100Only ? (top100Order.get(a.id)||0)-(top100Order.get(b.id)||0) : 0);
  const reset = () => { setSearch(''); setComposer('All composers'); setEra('All eras'); setSavedOnly(false); setTop100Only(false); };

  return <section className="library-page">
    <div className="library-heading"><div><span className="eyebrow">YOUR TAMIL SONGBOOK</span><h1>Music you grew up with.</h1><p>Find your favourite songs. Build the skills to play them.</p></div><div className="library-total"><strong>{catalogue.length}</strong><span>song references<br/>across {new Set(catalogue.map(song=>Math.floor(song.year/10))).size} decades</span></div></div>
    <div className="library-tabs" aria-label="Library view"><button onClick={() => {setSavedOnly(false);setTop100Only(false);}} className={!savedOnly&&!top100Only ? 'active' : ''}>All songs <span>{catalogue.length}</span></button><button onClick={() => {setSavedOnly(false);setTop100Only(true);}} className={top100Only?'active':''}>Top 100 picks <span>100</span></button><button onClick={() => {setSavedOnly(true);setTop100Only(false);}} className={savedOnly ? 'active' : ''}>Saved songs <span>{favorites.length}</span></button></div>
    <div className="library-filters">
      <label className="song-search"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input aria-label="Search songs, films or composers" placeholder="Search songs, films or composers…" value={search} onChange={event => setSearch(event.target.value)}/>{search && <button onClick={() => setSearch('')} aria-label="Clear search">×</button>}</label>
      <label className="library-select"><span className="sr-only">Composer</span><select aria-label="Composer" value={composer} onChange={event => setComposer(event.target.value)}><option>All composers</option>{composers.map(name => <option key={name}>{name}</option>)}</select></label>
      <label className="library-select"><span className="sr-only">Era</span><select aria-label="Era" value={era} onChange={event => setEra(event.target.value)}><option>All eras</option>{[...new Set(catalogue.map(song=>Math.floor(song.year/10)*10))].sort((a,b)=>a-b).map(year => <option key={year} value={year}>{year}s</option>)}</select></label>
    </div>
    <div className="library-results"><span>{filtered.length} {filtered.length === 1 ? 'song' : 'songs'} to explore</span><label>Sort by <select aria-label="Sort songs" value={sort} onChange={event => setSort(event.target.value)}><option value="curated">Collection order</option><option value="title">Song title</option><option value="newest">Newest first</option></select></label></div>
    <p className="library-note"><span>♫</span> Browse song references at any level. Private song studies unlock at Level 2; their notes need your permission or a suitable licence. Original exercises are in your learning path.</p>
    {top100Only&&<p className="library-note">An editorial selection of 25 songs per composer. MuseScore links open searches; they are not verified score matches or permission grants.</p>}
    {saveNotice && <p role="status" className="library-note">{saveNotice}</p>}
    {filtered.length ? <div className="song-grid">{filtered.slice(0, limit).map(song => <SongCard key={song.id} song={song} onSelect={setSelected} onSave={toggleFavorite} saved={favorites.includes(song.id)}/>)}</div> : <div className="library-empty"><span>♬</span><h2>{savedOnly ? 'Your favourites start here.' : 'Let’s try another search.'}</h2><p>{savedOnly ? 'Tap the heart on a song to keep it in your collection.' : 'Try a song title, film, composer, or a different era.'}</p><button className="library-primary" onClick={reset}>Explore all songs →</button></div>}
    {filtered.length > limit && <button className="library-load" onClick={() => setLimit(current => current + 12)}>Explore more songs <span>↓</span></button>}
    {selected && <SongDetail song={selected} onClose={() => setSelected(null)} onPractice={id => { setSelected(null); onPractice(id); }} unlockedLevel={unlockedLevel} onAddSong={onAddSong?song=>{setSelected(null);onAddSong(song);}:undefined} onViewJourney={onViewJourney?()=>{setSelected(null);onViewJourney();}:undefined}/>}
  </section>;
}

export default Library;
