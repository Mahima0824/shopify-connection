// Short success blip for warehouse scans (Web Audio, no assets).
// Module-level context so repeat scans don't re-allocate.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Unlock audio on first user interaction (mobile browsers suspend
// AudioContext until a gesture; scans happen async after that).
if (typeof window !== "undefined") {
  const unlock = () => audio();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export function playScanBeep(frequency = 880, durationMs = 150): void {
  const ac = audio();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    const t = ac.currentTime;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start();
    osc.stop(t + durationMs / 1000 + 0.01);
  } catch {
    // Sound is best-effort; a scan must never fail because of audio.
  }
}
