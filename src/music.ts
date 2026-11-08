export type Notation = 'western' | 'carnatic' | 'both';
const WESTERN = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SWARAS = ['S', 'R₁', 'R₂', 'G₂', 'G₃', 'M₁', 'M₂', 'P', 'D₁', 'D₂', 'N₂', 'N₃'];
export const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;
export const westernName = (midi: number, octave = false) => `${WESTERN[modulo(midi, 12)]}${octave ? Math.floor(midi / 12) - 1 : ''}`;
export const swaraName = (midi: number, tonic: number) => {
  const interval = midi - (60 + tonic);
  const octave = Math.floor(interval / 12);
  const superscript = ['', '¹', '²', '³', '⁴', '⁵', '⁶'];
  const mark = octave === 0 ? '' : `${octave > 0 ? '̇' : '̣'}${Math.abs(octave) > 1 ? superscript[Math.abs(octave)] || Math.abs(octave) : ''}`;
  return `${SWARAS[modulo(interval,12)]}${mark}`;
};
export const noteName = (midi: number, tonic: number, notation: Notation) => notation === 'western' ? westernName(midi) : notation === 'carnatic' ? swaraName(midi,tonic) : `${westernName(midi)} · ${swaraName(midi,tonic)}`;
export const noteFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const frequencyToMidi = (frequency: number) => 69 + 12 * Math.log2(frequency / 440);
export const isBlack = (midi: number) => [1,3,6,8,10].includes(modulo(midi,12));
// A conservative normalized autocorrelation detector for one sustained pitch.
// It intentionally does not claim to recognize polyphonic piano chords.
export function detectPitch(samples: Float32Array, sampleRate: number): number | null {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  if (Math.sqrt(energy / samples.length) < 0.012) return null;
  const minLag = Math.floor(sampleRate / 1400);
  const maxLag = Math.min(Math.floor(sampleRate / 90), Math.floor(samples.length / 2));
  const correlations = new Float64Array(maxLag + 1);
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0, aEnergy = 0, bEnergy = 0;
    for (let i = 0; i < samples.length - maxLag; i++) {
      const a = samples[i], b = samples[i + lag];
      correlation += a * b; aEnergy += a*a; bEnergy += b*b;
    }
    correlations[lag] = correlation / Math.sqrt(aEnergy*bEnergy || 1);
  }
  // First strong local maximum avoids preferring octave/subharmonic multiples.
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const value = correlations[lag];
    if (value > 0.88 && value > correlations[lag-1] && value >= correlations[lag+1]) {
      best = value; bestLag = lag; break;
    }
  }
  if (!bestLag || best < 0.88) return null;
  const before = correlations[bestLag-1], center = correlations[bestLag], after = correlations[bestLag+1];
  const correction = (before - after) / (2 * (before - 2*center + after)) || 0;
  return sampleRate / (bestLag + correction);
}

let context: AudioContext | null = null;
const activeVoices = new Set<OscillatorNode>();
export async function unlockAudio() {
  const AudioContextClass = window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
  if (!AudioContextClass) throw new Error('Audio is not available in this browser.');
  if (!context || context.state === 'closed') context = new AudioContextClass();
  if (context.state === 'suspended') await context.resume();
  return context;
}
export function soundNote(midi: number, seconds = 0.8, volume = 0.16) {
  if (!context || context.state !== 'running') return;
  const now = context.currentTime;
  // A decaying fundamental and quiet overtone give a clear, soft practice tone.
  for (const [harmonic, amount] of [[1,1],[2,0.2],[3,0.08]]) {
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = noteFrequency(midi)*harmonic;
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume*amount, now+0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now+Math.max(0.08,seconds));
    oscillator.connect(gain); gain.connect(context.destination);
    activeVoices.add(oscillator);
    oscillator.onended = () => {activeVoices.delete(oscillator); oscillator.disconnect(); gain.disconnect();};
    oscillator.start(now); oscillator.stop(now + seconds + 0.05);
  }
}
export function soundBeat(accent: boolean) {
  if (!context || context.state !== 'running') return;
  const oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.frequency.value = accent ? 1100 : 780;
  gain.gain.setValueAtTime(0.07,context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001,context.currentTime+0.045);
  oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime+0.05);
  activeVoices.add(oscillator); oscillator.onended = () => {activeVoices.delete(oscillator); oscillator.disconnect(); gain.disconnect();};
}
export function stopSounds() { for (const oscillator of activeVoices) {try {oscillator.stop();} catch {/* Already stopped. */}} activeVoices.clear(); }
