// audio.js — all audio-related stuff, exported as a module

// Lazily created AudioContext so iOS sees it as user-gesture initiated
let audioCtx = null;

export function getAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      throw new Error("Web Audio API not supported in this browser.");
    }
    audioCtx = new AC();
  }
  return audioCtx;
}

// amplitude constants
const BASE_AMP = 0.5;   // baseline for one voice
const MIN_AMP  = 0.2;   // never quieter than this
const MAX_AMP  = 0.95;  // keep head-room

export function ampForFreq(freq, voices = 1) {
  let a = BASE_AMP / voices * Math.sqrt(440 / freq);
  return Math.max(Math.min(a, MAX_AMP), MIN_AMP / voices);
}

// Reusable unlock function (used before any sound)
export async function unlockAudio() {
  try {
    const ctx = getAudioCtx(); // ensure it exists

    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      await ctx.resume();
    }

    // Ultra-short, basically silent pulse to fully unlock on mobile
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    gain.gain.setValueAtTime(0.0001, ctx.currentTime); // almost silent
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, ctx.currentTime);

    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  } catch (err) {
    console.warn("unlockAudio failed:", err);
  }
}

// sequential single note
export function playOneNoteSequential(freq, duration, voices = 1) {
  return new Promise(async resolve => {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    const now = ctx.currentTime;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(ampForFreq(freq, voices), now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.onended = resolve;
    osc.start(now);
    osc.stop(now + duration);
  });
}

// chord / multiple notes at once
export async function playNotesSimult(freqArray) {
  if (!freqArray || !freqArray.length) return;
  const ctx = getAudioCtx();
  if (ctx.state === "suspended") await ctx.resume();
  const now = ctx.currentTime;
  const duration = 1.0;
  const voices = freqArray.length;

  for (const freq of freqArray) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(ampForFreq(freq, voices), now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }
}
