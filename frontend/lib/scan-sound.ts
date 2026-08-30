// Port of the Web Audio API beep feedback from outward.html — lazily creates
// one AudioContext on first use (browser-only, never at module load / SSR time).
let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function playSuccessSound() {
  const c = getCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.connect(g);
  g.connect(c.destination);
  o.type = "sine";
  o.frequency.setValueAtTime(880, c.currentTime);
  o.frequency.setValueAtTime(1320, c.currentTime + 0.1);
  g.gain.setValueAtTime(0.3, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.3);
  o.start(c.currentTime);
  o.stop(c.currentTime + 0.3);
}

export function playErrorSound() {
  const c = getCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.connect(g);
  g.connect(c.destination);
  o.type = "sine";
  o.frequency.setValueAtTime(300, c.currentTime);
  g.gain.setValueAtTime(0.3, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.4);
  o.start(c.currentTime);
  o.stop(c.currentTime + 0.4);
}
