// audio.js — all audio-related stuff, exported as a module

// Create AudioContext (desktop + iOS Safari compatible)
export const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// amplitude constants
export const BASE_AMP = 0.5;   // baseline for one voice
export const MIN_AMP  = 0.2;   // never quieter than this
export const MAX_AMP  = 0.95;  // keep head-room

function ampForFreq(freq, voices = 1) {
  let a = BASE_AMP / voices * Math.sqrt(440 / freq);
  return Math.max(Math.min(a, MAX_AMP), MIN_AMP / voices);
}

// Reusable unlock function (used before any sound)
export async function unlockAudio() {
  try {
    const silentAudio = document.getElementById('unlockSound');

    // Try to play the silent <audio>, but don't depend on it working
    if (silentAudio) {
      try {
        await silentAudio.play();
        setTimeout(() => {
          silentAudio.pause();
          silentAudio.currentTime = 0;
        }, 200);
      } catch (err) {
        console.warn('Silent unlockSound failed to play:', err);
      }
    }

    // ALWAYS try to resume the AudioContext while we're still in the user gesture
    if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
      await audioCtx.resume();
    }

  } catch (err) {
    console.warn('unlockAudio() failed:', err);
  }
}


// sequential single note
export function playOneNoteSequential(freq, duration, voices = 1) {
  return new Promise(async resolve => {
    if (audioCtx.state === "suspended") await audioCtx.resume();
    const now = audioCtx.currentTime;

    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(ampForFreq(freq, voices), now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(audioCtx.destination);
    osc.onended = resolve;
    osc.start(now);
    osc.stop(now + duration);
  });
}

// chord / multiple notes at once
export async function playNotesSimult(freqArray) {
  if (!freqArray || !freqArray.length) return;
  if (audioCtx.state === "suspended") await audioCtx.resume();
  const now = audioCtx.currentTime;
  const duration = 1.0;
  const voices = freqArray.length;

  for (const freq of freqArray) {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(ampForFreq(freq, voices), now);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }
}
