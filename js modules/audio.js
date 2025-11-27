// audio.js — all audio-related stuff, exported as a module

// =====================================================================
// 0) TWIDDABLE CONSTANTS
// =====================================================================

// Global output safety — overall loudness cap
const MASTER_GAIN_LEVEL = 0.50; // try 0.25–0.4 for comfort

// Per-voice amplitude shaping
const BASE_AMP = 0.5;   // baseline for one voice
const MIN_AMP  = 0.2;   // never quieter than this
const MAX_AMP  = 0.95;  // keep head-room

// Relative loudness compensation per waveform
// (feel free to tweak these)
const WAVEFORM_GAIN_FACTORS = {
  square:      0.05,
  sawtooth:    0.04,
  triangle:    0.8,
  softSquare:  0.15,
  mellowSaw:   0.3,
  hollowGlass: 0.25
};

// Gentle compressor settings to tame peaks
const COMP_THRESHOLD_DB = -18;  // when compression starts
const COMP_KNEE_DB      = 24;
const COMP_RATIO        = 4;
const COMP_ATTACK_SEC   = 0.003;
const COMP_RELEASE_SEC  = 0.25;

// =====================================================================
// 1) AudioContext + master graph (masterGain -> compressor -> destination)
// =====================================================================

let audioCtx   = null;
let masterGain = null;
let compressor = null;

export function getAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      throw new Error("Web Audio API not supported in this browser.");
    }
    audioCtx = new AC();
    setupMasterGraph(audioCtx);
  }
  return audioCtx;
}

function setupMasterGraph(ctx) {
  if (masterGain && compressor) return;

  // Master gain (global volume cap)
  masterGain = ctx.createGain();
  masterGain.gain.value = MASTER_GAIN_LEVEL;

  // Dynamics compressor to tame sudden peaks
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(COMP_THRESHOLD_DB, ctx.currentTime);
  compressor.knee.setValueAtTime(COMP_KNEE_DB, ctx.currentTime);
  compressor.ratio.setValueAtTime(COMP_RATIO, ctx.currentTime);
  compressor.attack.setValueAtTime(COMP_ATTACK_SEC, ctx.currentTime);
  compressor.release.setValueAtTime(COMP_RELEASE_SEC, ctx.currentTime);

  // Wire: voices -> masterGain -> compressor -> speakers
  masterGain.connect(compressor).connect(ctx.destination);
}

// =====================================================================
// 2) Waveform state + custom PeriodicWaves
// =====================================================================

let currentWaveform = "triangle"; // default

// cache for custom PeriodicWaves
let periodicWaves = null;

// names of built-in oscillator types (no sine in UI list)
const BUILT_IN_WAVES = ["triangle", "square", "sawtooth"];

export function setWaveform(type) {
  const allowed = [
    "triangle",
    "square",
    "sawtooth",
    "softSquare",
    "mellowSaw",
    "hollowGlass"
  ];
  if (allowed.includes(type)) {
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
    const real = new Float32Array(maxHarm + 1); // keep real = 0 for sine-series
    const imag = new Float32Array(maxHarm + 1);
    for (const [k, amp] of Object.entries(partials)) {
      const idx = parseInt(k, 10);
      imag[idx] = amp;
    }
    return ctx.createPeriodicWave(real, imag);
  }

  // 1) Soft Square — odd harmonics, faster decay than a true square
  const softSquare = buildWave({
    1: 1.0,
    3: 0.4,
    5: 0.2,
    7: 0.1,
    9: 0.05
  });

  // 2) Mellow Saw — all harmonics but heavily tapered
  const mellowSaw = buildWave({
    1: 1.0,
    2: 0.3,
    3: 0.15,
    4: 0.08,
    5: 0.04,
    6: 0.02
  });

  // 3) Hollow Glass — slightly weird, shifted energy
  const hollowGlass = buildWave({
    1: 0.3,
    2: 1.0,
    3: 0.6,
    4: 0.2,
    5: 0.4
  });

  periodicWaves = {
    softSquare,
    mellowSaw,
    hollowGlass
  };
  return periodicWaves;
}

// =====================================================================
// 3) Amplitude helpers + unlock
// =====================================================================

export function ampForFreq(freq, voices = 1) {
  let a = BASE_AMP / voices * Math.sqrt(440 / freq);
  return Math.max(Math.min(a, MAX_AMP), MIN_AMP / voices);
}

function waveGainFactor(type) {
  return WAVEFORM_GAIN_FACTORS[type] ?? 1.0;
}

// Reusable unlock function (used before any sound)
export async function unlockAudio() {
  try {
    const ctx = getAudioCtx();

    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      await ctx.resume();
    }

    // Ultra-short, almost-silent pulse just to fully unlock on mobile
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    gain.gain.setValueAtTime(0.0001, ctx.currentTime); // basically silent
    osc.type = "sine"; // internal only, not exposed in UI
    osc.frequency.setValueAtTime(440, ctx.currentTime);

    osc.connect(gain).connect(masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  } catch (err) {
    console.warn("unlockAudio failed:", err);
  }
}

// =====================================================================
// 4) Playback helpers
// =====================================================================

// sequential single note
export function playOneNoteSequential(freq, duration, voices = 1) {
  return new Promise(async resolve => {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    ensurePeriodicWaves(ctx);

    const now  = ctx.currentTime;
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

    osc.connect(gain).connect(masterGain);
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

  const now      = ctx.currentTime;
  const duration = 1.0;
  const voices   = freqArray.length;

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

    osc.connect(gain).connect(masterGain);
    osc.start(now);
    osc.stop(now + duration);
  }
}
