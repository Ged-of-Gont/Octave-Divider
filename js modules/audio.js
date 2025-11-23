// audio.js — all audio-related stuff, exported as a module

// ---------------------------------------------------------------------
// 0) User-tunable constants (volume, wave balance, partial recipes)
// ---------------------------------------------------------------------

// Master output ceiling (ear safety)
const MASTER_GAIN_LEVEL = 0.1;

// Per-oscillator amplitude shaping
const BASE_AMP = 0.5;   // baseline for one voice
const MIN_AMP  = 0.2;   // never quieter than this
const MAX_AMP  = 0.95;  // keep head-room

// Relative loudness compensation per waveform
const WAVE_GAIN_MAP = {
  square:      0.05,
  sawtooth:    0.04,
  triangle:    0.8,
  softSquare:  0.15,
  mellowSaw:   0.1,
  hollowGlass: 0.1,
};

// Built-in oscillator types we support directly
const BUILT_IN_WAVES = ["triangle", "square", "sawtooth"];

// Waveforms that can be selected by the UI
const ALLOWED_WAVEFORMS = [
  "triangle",
  "square",
  "sawtooth",
  "softSquare",
  "mellowSaw",
  "hollowGlass"
];

// Partial recipes for custom PeriodicWaves
// 1) Soft Square — odd harmonics, faster decay than a true square
const SOFT_SQUARE_PARTIALS = {
  1: 1.0,
  3: 0.4,
  5: 0.2,
  7: 0.1,
  9: 0.05
};

// 2) Mellow Saw — all harmonics but heavily tapered
const MELLOW_SAW_PARTIALS = {
  1: 1.0,
  2: 0.3,
  3: 0.15,
  4: 0.08,
  5: 0.04,
  6: 0.02
};

// 3) Hollow Glass — slightly weird, shifted energy
const HOLLOW_GLASS_PARTIALS = {
  1: 0.3,
  2: 1.0,
  3: 0.6,
  4: 0.2,
  5: 0.4
};

// ---------------------------------------------------------------------
// 1) AudioContext + master output
// ---------------------------------------------------------------------

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

let masterGain = null;

function getMasterGain(ctx) {
  if (!masterGain) {
    masterGain = ctx.createGain();
    masterGain.gain.value = MASTER_GAIN_LEVEL;
    masterGain.connect(ctx.destination);
  }
  return masterGain;
}

// ---------------------------------------------------------------------
// 2) Waveform state + custom PeriodicWaves
// ---------------------------------------------------------------------

let currentWaveform = "triangle"; // default
let periodicWaves = null;         // cache for custom PeriodicWaves

export function setWaveform(type) {
  if (ALLOWED_WAVEFORMS.includes(type)) {
    currentWaveform = type;
  } else {
    currentWaveform = "triangle";
  }
}

function ensurePeriodicWaves(ctx) {
  if (periodicWaves) return periodicWaves;

  function buildWave(partials) {
    // partials = { harmonicNumber: amplitude, ... }
    const maxHarm = Math.max(...Object.keys(partials).map(n => parseInt(n, 10)));
    const real = new Float32Array(maxHarm + 1); // leave real = 0 for sine-series
    const imag = new Float32Array(maxHarm + 1);
    for (const [k, amp] of Object.entries(partials)) {
      const idx = parseInt(k, 10);
      imag[idx] = amp;
    }
    return ctx.createPeriodicWave(real, imag);
  }

  const softSquare = buildWave(SOFT_SQUARE_PARTIALS);
  const mellowSaw  = buildWave(MELLOW_SAW_PARTIALS);
  const hollowGlass = buildWave(HOLLOW_GLASS_PARTIALS);

  periodicWaves = {
    softSquare,
    mellowSaw,
    hollowGlass
  };
  return periodicWaves;
}

// ---------------------------------------------------------------------
// 3) Amplitude helpers + unlock
// ---------------------------------------------------------------------

export function ampForFreq(freq, voices = 1) {
  let a = BASE_AMP / voices * Math.sqrt(440 / freq);
  return Math.max(Math.min(a, MAX_AMP), MIN_AMP / voices);
}

// Reusable unlock function (used before any sound)
export async function unlockAudio() {
  try {
    const ctx = getAudioCtx();

    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      await ctx.resume();
    }

    const mg = getMasterGain(ctx);

    // Ultra-short, almost-silent pulse just to fully unlock on mobile
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    gain.gain.setValueAtTime(0.0001, ctx.currentTime); // basically silent
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, ctx.currentTime);

    osc.connect(gain).connect(mg);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  } catch (err) {
    console.warn("unlockAudio failed:", err);
  }
}

// ---------------------------------------------------------------------
// 4) Playback helpers
// ---------------------------------------------------------------------

// sequential single note
export function playOneNoteSequential(freq, duration, voices = 1) {
  return new Promise(async resolve => {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    ensurePeriodicWaves(ctx);

    const mg  = getMasterGain(ctx);
    const now = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    // choose waveform
    if (BUILT_IN_WAVES.includes(currentWaveform)) {
      osc.type = currentWaveform;
    } else if (periodicWaves && periodicWaves[currentWaveform]) {
      osc.setPeriodicWave(periodicWaves[currentWaveform]);
    } else {
      osc.type = "triangle";
    }

    osc.frequency.setValueAtTime(freq, now);

    const baseAmp = ampForFreq(freq, voices);
    const factor  = waveGainFactor(currentWaveform);
    gain.gain.setValueAtTime(baseAmp * factor, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(mg);
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
  ensurePeriodicWaves(ctx);

  const mg  = getMasterGain(ctx);
  const now = ctx.currentTime;
  const duration = 1.0;
  const voices = freqArray.length;

  for (const freq of freqArray) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    if (BUILT_IN_WAVES.includes(currentWaveform)) {
      osc.type = currentWaveform;
    } else if (periodicWaves && periodicWaves[currentWaveform]) {
      osc.setPeriodicWave(periodicWaves[currentWaveform]);
    } else {
      osc.type = "triangle";
    }

    osc.frequency.setValueAtTime(freq, now);

    const baseAmp = ampForFreq(freq, voices);
    const factor  = waveGainFactor(currentWaveform);
    gain.gain.setValueAtTime(baseAmp * factor, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(mg);
    osc.start(now);
    osc.stop(now + duration);
  }
}

// ---------------------------------------------------------------------
// 5) Wave gain lookup
// ---------------------------------------------------------------------
function waveGainFactor(type) {
  return WAVE_GAIN_MAP[type] ?? 1.0;
}
