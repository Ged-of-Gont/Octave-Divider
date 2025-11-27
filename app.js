// Oktavia — Microtonal Scale Workshop
// Copyright (C) 2025  Jonathan William Horn
// Licensed under the GNU AGPL v3.0 or later. See LICENSE file for details.

import {
  getAudioCtx,
  unlockAudio,
  playOneNoteSequential,
  playNotesSimult,
  setWaveform
} from './js modules/audio.js';

import {
  fractionStringApprox,
  parseFractionOrDecimal,
  ratioToHue,
  hexToRgba
} from './js modules/math-utils.js';

import {
  generateSclFileContent,
  generateKbmFileContent,
  generateTunFileContent
} from './js modules/tuning-export.js';

/**************************************************************************
 * 1) Variables + Setup
 **************************************************************************/
const cssVars = getComputedStyle(document.documentElement);
const DRAG_TOLERANCE_PX = parseFloat(cssVars.getPropertyValue("--drag-tolerance-px")) || 10;
const TAP_MOVE_THRESHOLD = 30; // px – adjust if needed
let touchStartData = new Map(); // touchId -> { x, y, time, moved }
const DEFAULT_PARTICLE_COUNT = parseFloat(cssVars.getPropertyValue("--default-particle-count")) || 250;
const PARTICLE_VELOCITY_SCALE = parseFloat(cssVars.getPropertyValue("--particle-velocity-scale")) || 0.02;
const PARTICLE_LIFETIME_BASE = parseFloat(cssVars.getPropertyValue("--particle-lifetime-base")) || 1000;
const PARTICLE_LIFETIME_RND = parseFloat(cssVars.getPropertyValue("--particle-lifetime-random")) || 100;
const GLOBAL_PARTICLE_CAP = parseInt(cssVars.getPropertyValue("--particle-global-cap")) || 2000;
// Global configuration for keyboard style:
const KEY_RAINBOW_SATURATION = "100%";  // used in computing the base rainbow color
const KEY_RAINBOW_LIGHTNESS = "70%";      // used in computing the base rainbow color
// For the pulse effect overlay:
const KEY_PULSE_COLOR = "#edebd4"; // nearly white (can be changed as needed)
const KEY_PULSE_DURATION = 300;    // pulse effect duration in milliseconds

let isPlaying = false;

const scaleInstructions = `
  a. Set the tonic note, the first note of the scale.<br><br>
  b. Add intervals. (manually or with preset scales)<br><br>
  c. Drag the vertical bars. They will snap to simple ratios.<br><br>
  d. Tap or click on the Blue Hz # to hear the note.<br><br>
  e. Tap or click on pink interval to delete that note.<br><br>
  f. Tap or click on the pink box to lock a note, enabling chords.<br><br>
  g. Save a json to reload settings into this app. Save a .tun or .scl to load into other synths.<br>
`;

const keyboardInstructions = `
  a. Set the tonic note, the first note of the scale.<br><br>
  b. Add intervals. (manually or with preset scales)<br><br>
  c. Tap or click the keys to hear the notes. <br><br>
  d. Each key plays only once per tap – release before playing again.<br><br>
  e. Save a json to reload settings into this app. Save a .tun or .scl to load into other synths.<br>
`;

// The scale
let scaleDegrees = [
  { fractionText: "1/1", floatVal: 1.0, selected: false },
  { fractionText: "2/1", floatVal: 2.0, selected: false }
];
let tonic = 261.63;

// Particles
let particles = [];

let viewMode = "scale";
let isZoomed = false;
let lastTouchTime = 0;

// Canvas + geometry
const canvas = document.getElementById("scale-canvas");
const ctx = canvas.getContext("2d");
let LEFT_X = 0, RIGHT_X = 0, MID_Y = 0, WIDTH = 0;

// For dragging
let draggingMarker = null;

// For clickable labels
let clickableRegions = [];

// For snapping
const MAX_DEN = 16;
const SNAP_THRESHOLD_CENTS = 10;
let snapCandidates = [];

/**************************************************************************
 * 2) Main Initialization
 **************************************************************************/
window.addEventListener("DOMContentLoaded", init);

function init() {
  const noteSelect = document.getElementById("noteSelect");
  const tonicInput = document.getElementById("tonicInput");
  tonic = parseFloat(noteSelect.value);
  tonicInput.value = noteSelect.value;

  noteSelect.addEventListener("change", () => {
    tonic = parseFloat(noteSelect.value);
    tonicInput.value = noteSelect.value;
  });

  const instructionsEl = document.querySelector(".instructions");
  // Set the initial instructions text for scale view:
  instructionsEl.innerHTML = scaleInstructions;

  const zoomBtn = document.getElementById("zoomToggleBtn");
  const canvasContainer = document.getElementById("canvas-container");

  zoomBtn.addEventListener("click", () => {
    isZoomed = !isZoomed;

    // Update button label
    zoomBtn.textContent = isZoomed ? "Shrink View" : "Expand View";

    // Toggle a class on the container (for scroll behavior)
    if (isZoomed) {
      canvasContainer.classList.add("zoomed");
    } else {
      canvasContainer.classList.remove("zoomed");
    }

    // Recalculate canvas pixel size for the new zoom
    resizeCanvas();
  });

  document.getElementById("toggleViewBtn").addEventListener("click", () => {
    if (viewMode === "scale") {
      viewMode = "keyboard";
      document.getElementById("toggleViewBtn").innerText = "Show Scale";
      instructionsEl.innerHTML = keyboardInstructions;
    } else {
      viewMode = "scale";
      document.getElementById("toggleViewBtn").innerText = "Show Keyboard";
      instructionsEl.innerHTML = scaleInstructions;
    }
  });

  const waveformSelect = document.getElementById("waveformSelect");
  if (waveformSelect) {
    // set initial waveform from current UI value
    setWaveform(waveformSelect.value);

    waveformSelect.addEventListener("change", () => {
      setWaveform(waveformSelect.value);
    });
  }

  document.getElementById("setTonicBtn").addEventListener("click", () => {
    let val = parseFloat(tonicInput.value);
    if (!isFinite(val) || val <= 0) {
      alert("Tonic must be positive.");
      return;
    }
    tonic = val;
  });

  const intervalInput = document.getElementById("intervalInput");
  document.getElementById("addIntervalBtn").addEventListener("click", () => {
    let text = intervalInput.value.trim();
    if (!text) {
      alert("Enter ratio, e.g. 3/2 or 1.414");
      return;
    }
    let r = parseFractionOrDecimal(text);
    if (!isFinite(r) || r <= 1 || r >= 2) {
      alert("Ratio must be >1 and <2");
      return;
    }
    // add the new interval
    let exist = scaleDegrees.some(d => Math.abs(d.floatVal - r) < 1e-7);
    if (!exist) {
      scaleDegrees.push({ fractionText: text, floatVal: r, selected: false });
      scaleDegrees.sort((a, b) => a.floatVal - b.floatVal);
    }
  });

  document.getElementById("clearAllBtn").addEventListener("click", () => {
    // keep only 1/1 and 2/1
    scaleDegrees = scaleDegrees.filter(d => d.floatVal === 1 || d.floatVal === 2);
  });

  // "Play Scale" button handler with audio unlock
  document.getElementById("playScaleBtn").addEventListener("click", async () => {
    await unlockAudio(); // call our unlocking function

    if (isPlaying) return;
    isPlaying = true;
    setControlsEnabled(false);
    await playScaleOnce();
    setControlsEnabled(true);
    isPlaying = false;
  });

  document.getElementById("saveBtn").addEventListener("click", doSave);
  document.getElementById("loadBtn").addEventListener("click", () => {
    document.getElementById("fileInput").click();
  });
  document.getElementById("fileInput").addEventListener("change", evt => {
    doLoad(evt.target.files);
    evt.target.value = "";
  });

  document.getElementById("presetSelect").addEventListener("change", applyPresetSelection);

  initSnapCandidates();
  resizeCanvas();
  canvas.addEventListener("mousedown", onCanvasMouseDown);
  canvas.addEventListener("mousemove", onCanvasMouseMove);
  canvas.addEventListener("mouseup", () => {
    draggingMarker = null;
    if (viewMode === "keyboard") {
      // Reset the keyboardActive state on all notes.
      scaleDegrees.forEach(note => { note.keyboardActive = false; });
    }
  });

  canvas.addEventListener("mouseleave", () => { draggingMarker = null; });

  canvas.addEventListener("touchstart", onCanvasTouchStart, { passive: false });
  canvas.addEventListener("touchmove", onCanvasTouchMove, { passive: false });
  canvas.addEventListener("touchend", onCanvasTouchEnd, { passive: false });
  canvas.addEventListener("touchcancel", onCanvasTouchEnd, { passive: false });

  window.addEventListener("orientationchange", function () {
    setTimeout(function () {
      window.scrollTo(0, 0);
    }, 200);
  });

  // Start the render loop
  requestAnimationFrame(animate);
  window.addEventListener("resize", resizeCanvas);

  const formatSelect = document.getElementById("formatSelect");
  const midiControls = document.getElementById("midiControls");

  function toggleMidiControls() {
    if (formatSelect.value === "json") {
      midiControls.style.display = "none";
    } else {
      midiControls.style.display = "flex";
    }
  }

  formatSelect.addEventListener("change", toggleMidiControls);
  toggleMidiControls();
}

/**************************************************************************
 * 3) Animation Loop
 **************************************************************************/
function animate() {
  requestAnimationFrame(animate);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateParticles();
  drawParticles();

  if (viewMode === "scale") {
    renderScale();
  } else if (viewMode === "keyboard") {
    renderKeyboard();
  }
}

/**************************************************************************
 * 4) Particle System (Original Glow + Distribution + Global Cap)
 **************************************************************************/
function createParticlesGaussian(deg, count = DEFAULT_PARTICLE_COUNT, laplaceScale = 10) {
  const now = performance.now();
  if (particles.length >= GLOBAL_PARTICLE_CAP) return;
  let available = GLOBAL_PARTICLE_CAP - particles.length;
  if (count > available) count = available;
  if (count < 1) return;

  const centerX = ratioToX(deg.floatVal, LEFT_X, WIDTH);
  const centerY = MID_Y;
  const sigmaY = 30;
  const hue = ratioToHue(deg.floatVal);

  for (let i = 0; i < count; i++) {
    const offsetX = sampleLaplace(laplaceScale);
    const x = centerX + offsetX;
    const y = centerY + sampleNormal(0, sigmaY);
    const vx = (Math.random() * 2 - 1) * PARTICLE_VELOCITY_SCALE;
    const vy = (Math.random() * 2 - 1) * PARTICLE_VELOCITY_SCALE;
    const lifetime = PARTICLE_LIFETIME_BASE + Math.random() * PARTICLE_LIFETIME_RND;

    particles.push({
      x,
      y,
      vx,
      vy,
      lifetime,
      born: now,
      color: `hsl(${hue},100%,60%)`
    });
  }
}
function sampleLaplace(scale) {
  let u = Math.random() - 0.5;
  return Math.sign(u) * scale * Math.log(1 - 2 * Math.abs(u));
}
function sampleNormal(mean, stdev) {
  const u1 = Math.random(), u2 = Math.random();
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return mean + stdev * r * Math.cos(theta);
}
function updateParticles() {
  let now = performance.now();
  particles = particles.filter(p => (now - p.born) < p.lifetime);
  for (let p of particles) {
    p.x += p.vx;
    p.y += p.vy;
  }
}
function drawParticles() {
  ctx.globalCompositeOperation = 'lighter';
  let now = performance.now();
  for (let p of particles) {
    let age = now - p.born;
    let lifeFrac = age / p.lifetime;
    if (lifeFrac > 1) lifeFrac = 1;
    let alpha = 1 - lifeFrac;
    let sizeStart = 1.5, sizeEnd = 1;
    let size = sizeStart + (sizeEnd - sizeStart) * lifeFrac;
    ctx.save();
    let glowFactor = 2.0;
    let gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * glowFactor);
    gradient.addColorStop(0, p.color.replace(')', `, ${alpha})`).replace('hsl', 'hsla'));
    gradient.addColorStop(0.5, p.color.replace(')', `, ${alpha * 0.5})`).replace('hsl', 'hsla'));
    gradient.addColorStop(1, p.color.replace(')', `, 0)`).replace('hsl', 'hsla'));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/**************************************************************************
 * 5) Render the Scale
 **************************************************************************/
function resizeCanvas() {
  // 1x width normally, 2x width when zoomed
  const scale = isZoomed ? 2 : 1;

  // Make the canvas wider in CSS so it can scroll horizontally
  canvas.style.width = (scale * 100) + "%";

  // Match the internal resolution to the displayed size
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}

function renderScale() {
  clickableRegions = [];
  LEFT_X = 0.05 * canvas.width;
  RIGHT_X = 0.95 * canvas.width;
  MID_Y = canvas.height / 2;
  WIDTH = RIGHT_X - LEFT_X;

  // Draw main horizontal line
  ctx.strokeStyle = cssVars.getPropertyValue("--color-line").trim() || "#35313f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(LEFT_X, MID_Y);
  ctx.lineTo(RIGHT_X, MID_Y);
  ctx.stroke();

  scaleDegrees.sort((a, b) => a.floatVal - b.floatVal);

  // Draw interval labels
  ctx.font = "20px JetBrains Mono";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let placedLabels = [];
  for (let i = 0; i < scaleDegrees.length - 1; i++) {
    let leftVal = scaleDegrees[i].floatVal;
    let rightVal = scaleDegrees[i + 1].floatVal;
    let gap = rightVal / leftVal;
    let mid = 0.5 * (leftVal + rightVal);
    let midX = ratioToX(mid, LEFT_X, WIDTH);
    let gapStr = fractionStringApprox(gap);
    ctx.fillStyle = cssVars.getPropertyValue("--color-line").trim() || "#fffbcc";
    let lbl = positionLabel(midX, MID_Y - 50, gapStr, "interval", placedLabels);
    drawLabel(lbl);
  }

  // For each scale degree, render marker, labels, etc.
  for (let deg of scaleDegrees) {
    let x = ratioToX(deg.floatVal, LEFT_X, WIDTH);
    ctx.strokeStyle = cssVars.getPropertyValue("--color-line").trim() || "#35313f";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, MID_Y - 70);
    ctx.lineTo(x, MID_Y + 70);
    ctx.stroke();

    // If dragging or pulsing, add glow (unchanged code)
    if (draggingMarker === deg) {
      let hue = ratioToHue(deg.floatVal);
      ctx.save();
      ctx.strokeStyle = `hsla(${hue}, 100%, 60%, 1)`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x, MID_Y - 70);
      ctx.lineTo(x, MID_Y + 70);
      ctx.stroke();
      ctx.restore();
    } else if (deg.pulse && deg.pulse.start) {
      let pulseDuration = 1500;
      let elapsed = performance.now() - deg.pulse.start;
      let alpha = 1 - elapsed / pulseDuration;
      if (alpha > 0) {
        let hue = ratioToHue(deg.floatVal);
        ctx.save();
        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${alpha})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, MID_Y - 70);
        ctx.lineTo(x, MID_Y + 70);
        ctx.stroke();
        ctx.restore();
      } else {
        deg.pulse = null;
      }
    }

    // Draw ratio label (clickable for deletion)
    ctx.fillStyle = cssVars.getPropertyValue("--color-accent2").trim() || "#ff00cc";
    let ratioLbl = positionLabel(x, MID_Y - 90, deg.fractionText, "ratio", placedLabels);
    ratioLbl.degree = deg;
    drawLabel(ratioLbl);

    // Draw frequency label (clickable to play sound)
    ctx.fillStyle = cssVars.getPropertyValue("--color-accent3").trim() || "#00ffff";
    let freqVal = deg.floatVal * tonic;
    let freqStr = freqVal.toFixed(2) + " Hz";
    let freqLbl = positionLabel(x, MID_Y + 90, freqStr, "freq", placedLabels, true);
    freqLbl.degree = deg;
    drawLabel(freqLbl);

    // Draw selection checkbox (unchanged)
    let checkBoxSize = 20;
    let checkBoxX = x - checkBoxSize / 2;
    let checkBoxY = ratioLbl.y - 30;
    registerClickable(checkBoxX, checkBoxY, checkBoxSize, checkBoxSize, () => {
      deg.selected = !deg.selected;
    });
    ctx.save();
    ctx.strokeStyle = cssVars.getPropertyValue("--color-accent2").trim() || "#ff00cc";
    ctx.lineWidth = 2;
    ctx.strokeRect(checkBoxX, checkBoxY, checkBoxSize, checkBoxSize);
    if (deg.selected) {
      ctx.beginPath();
      ctx.moveTo(checkBoxX, checkBoxY);
      ctx.lineTo(checkBoxX + checkBoxSize, checkBoxY + checkBoxSize);
      ctx.moveTo(checkBoxX + checkBoxSize, checkBoxY);
      ctx.lineTo(checkBoxX, checkBoxY + checkBoxSize);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function renderKeyboard() {
  // Clear any clickable regions before drawing the keys
  clickableRegions = [];

  // Determine the number of keys based on the scaleDegrees array
  let keysCount = scaleDegrees.length;
  if (keysCount < 1) return; // Safety check

  // Calculate dimensions for keys
  let keyWidth = canvas.width / keysCount;
  let keyHeight = canvas.height * 0.8;
  let y = (canvas.height - keyHeight) / 2; // Center vertically

  // Loop through each key
  for (let i = 0; i < keysCount; i++) {
    let x = i * keyWidth;
    let note = scaleDegrees[i];

    // Compute the rainbow hue using your existing logic:
    let hue = ratioToHue(note.floatVal);
    // Use hsl with the global saturation and lightness constants:
    ctx.fillStyle = `hsl(${hue}, ${KEY_RAINBOW_SATURATION}, ${KEY_RAINBOW_LIGHTNESS})`;
    ctx.fillRect(x, y, keyWidth, keyHeight);
    ctx.strokeStyle = "#333333"; // you can still use a fixed outline color or add a constant if desired
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, keyWidth, keyHeight);

    // Draw the labels on the key, using a fixed text color:
    ctx.fillStyle = "#000000";
    ctx.font = "16px JetBrains Mono";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let freq = (note.floatVal * tonic).toFixed(2);
    ctx.fillText(note.fractionText, x + keyWidth / 2, y + keyHeight / 3);
    ctx.fillText(freq + " Hz", x + keyWidth / 2, y + (2 * keyHeight) / 3);

    // If the key has a pulse active, overlay it with the pulse color
    if (note.pulse && note.pulse.start) {
      let elapsed = performance.now() - note.pulse.start;
      let alpha = 1 - (elapsed / KEY_PULSE_DURATION);
      if (alpha > 0) {
        // Here we use the constant pulse color (nearly white) with the computed alpha.
        ctx.fillStyle = hexToRgba(KEY_PULSE_COLOR, alpha);
        ctx.fillRect(x, y, keyWidth, keyHeight);
      } else {
        note.pulse = null;
      }
    }

    // Register the clickable region for the key.
      // Register the clickable region for the key.
    registerClickable(x, y, keyWidth, keyHeight, async () => {
      if (viewMode !== "keyboard") return;

      await unlockAudio();
      note.pulse = { start: performance.now() };
      playNotesSimult([note.floatVal * tonic]);
    });
  }
}

function ratioToX(r, leftX, width) {
  let t = (r - 1) / (2 - 1);
  return leftX + t * width;
}
function positionLabel(cx, cy, text, kind, placedLabels, below = false) {
  let metrics = ctx.measureText(text);
  let textWidth = metrics.width;
  let textHeight = 24;
  let labelY = cy;
  let step = below ? 5 : -5;
  let attempts = 40;
  for (let i = 0; i < attempts; i++) {
    let x0 = cx - textWidth / 2;
    let y0 = labelY - textHeight / 2;
    if (x0 < 0) x0 = 0;
    if (x0 + textWidth > canvas.width) x0 = canvas.width - textWidth;
    let box = { x: x0, y: y0, w: textWidth, h: textHeight };
    if (!collides(box, placedLabels)) {
      placedLabels.push(box);
      return { x: x0, y: y0, w: textWidth, h: textHeight, text, kind };
    }
    labelY += step;
  }
  let x0 = cx - textWidth / 2;
  let y0 = cy - textHeight / 2;
  placedLabels.push({ x: x0, y: y0, w: textWidth, h: textHeight });
  return { x: x0, y: y0, w: textWidth, h: textHeight, text, kind };
}

function collides(box, boxes) {
  for (let b of boxes) {
    if (!(box.x + box.w < b.x || box.x > b.x + b.w ||
      box.y + box.h < b.y || box.y > b.y + b.h)) {
      return true;
    }
  }
  return false;
}

function drawLabel(label) {
  let { x, y, w, h, text, kind } = label;
  let cx = x + w / 2;
  let cy = y + h / 2;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy);
  ctx.restore();

  if (kind === "ratio") {
    registerClickable(x, y, w, h, () => {
      if (label.degree.floatVal === 1 || label.degree.floatVal === 2) return;
      if (confirm(`Delete "${label.degree.fractionText}"?`)) {
        scaleDegrees = scaleDegrees.filter(d => d !== label.degree);
      }
    });
  }
  else if (kind === "freq") {
    registerClickable(x, y, w, h, async () => {
      // Unlock audio if frequency label is tapped first
      await unlockAudio();

      let baseDeg = label.degree;
      baseDeg.pulse = { start: performance.now() };
      createParticlesGaussian(baseDeg, DEFAULT_PARTICLE_COUNT);
      let others = scaleDegrees.filter(d => d.selected && d !== baseDeg);
      others.forEach(o => {
        o.pulse = { start: performance.now() };
        createParticlesGaussian(o, DEFAULT_PARTICLE_COUNT);
      });
      let freq = baseDeg.floatVal * tonic;
      let allFreqs = [freq, ...others.map(o => o.floatVal * tonic)];
      playNotesSimult(allFreqs);
    });
  }
}
function onCanvasTouchStart(e) {
  // mark that a touch just happened so we can ignore the synthetic mouse event
  lastTouchTime = Date.now();

  const rect = canvas.getBoundingClientRect();

  if (viewMode === "scale") {
    // SCALE VIEW: only block scroll if we actually hit a marker or label
    let handled = false;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const mx = t.clientX - rect.left;
      const my = t.clientY - rect.top;

      // 1) Try to grab a draggable marker
      const marker = getMarkerAtPosition(mx, my);
      if (marker) {
        draggingMarker = marker;
        handled = true;
        continue;
      }

      // 2) Otherwise, see if we hit any clickable region (ratio, Hz, checkbox)
      for (let j = clickableRegions.length - 1; j >= 0; j--) {
        const r = clickableRegions[j];
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
          r.callback(t);
          handled = true;
          break;
        }
      }
    }

    if (handled) {
      // We interacted with something in the scale → stop page / container scroll
      e.preventDefault();
    }
  } else if (viewMode === "keyboard") {
    // KEYBOARD VIEW: fire notes immediately on touch down if we’re on a key.
    let handled = false;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const mx = t.clientX - rect.left;
      const my = t.clientY - rect.top;

      for (let j = clickableRegions.length - 1; j >= 0; j--) {
        const r = clickableRegions[j];
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
          r.callback(t);   // key callback plays the note
          handled = true;
          break;
        }
      }
    }

    if (handled) {
      // We actually hit a key → prevent synthetic mouse/click from double-firing.
      e.preventDefault();
    }
    // If not handled, we don’t preventDefault → horizontal scroll stays possible.
  }
}


function onCanvasTouchMove(e) {
  const rect = canvas.getBoundingClientRect();

  if (viewMode === "scale") {
    // Only block scroll when we’re actually dragging a marker
    if (!draggingMarker) {
      return; // finger is just panning the zoomed view → let browser handle it
    }

    e.preventDefault();

    // Use the first active touch to drive the marker
    const t = e.touches[0];
    if (!t) return;

    const mx = t.clientX - rect.left;
    let newRatio = xToRatio(mx, LEFT_X, WIDTH);
    newRatio = Math.max(1.0001, Math.min(newRatio, 1.9999));
    const snapped = maybeSnap(newRatio);
    draggingMarker.floatVal = snapped;
    draggingMarker.fractionText = fractionStringApprox(snapped);
  } else if (viewMode === "keyboard") {
    // No special handling for move in keyboard view (for now).
    // If you later want slide-to-other-key, we can add it here.
  }
}



function onCanvasTouchEnd(e) {
  // mark that a touch just finished (extra safety for ignoring synthetic mouse)
  lastTouchTime = Date.now();

  // Clear any keyboardActive flags for ended touches (even though we’re not
  // currently using keyboardActive anywhere, this is harmless cleanup).
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i];
    scaleDegrees.forEach(note => {
      if (note.keyboardActive === t.identifier) {
        note.keyboardActive = undefined;
      }
    });
  }

  if (viewMode === "scale") {
    // Stop dragging when last touch ends
    if (e.touches.length === 0 && draggingMarker) {
      draggingMarker = null;
      e.preventDefault();
    }

    // clean up any touchStartData you might still have lying around
    for (let i = 0; i < e.changedTouches.length; i++) {
      touchStartData.delete(e.changedTouches[i].identifier);
    }
  } else if (viewMode === "keyboard") {
    // We already played the note on touchstart. Nothing else to do here,
    // beyond clearing any touchStartData.
    for (let i = 0; i < e.changedTouches.length; i++) {
      touchStartData.delete(e.changedTouches[i].identifier);
    }
  }
}

/**************************************************************************
 * Mouse events for dragging
 **************************************************************************/
function onCanvasMouseDown(evt) {
  // If a touch just happened, ignore the synthetic mouse event
  if (Date.now() - lastTouchTime < 500) {
    return;
  }

  let rect = canvas.getBoundingClientRect();
  let mx = evt.clientX - rect.left;
  let my = evt.clientY - rect.top;

  // Only allow dragging if the view mode is scale.
  if (viewMode === "scale") {
    let marker = getMarkerAtPosition(mx, my);
    if (marker) {
      draggingMarker = marker;
      return;
    }
  }

  // Process clickable regions regardless of the view mode.
  for (let i = clickableRegions.length - 1; i >= 0; i--) {
    let r = clickableRegions[i];
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
      r.callback(evt);
      break;
    }
  }
}

function onCanvasMouseMove(evt) {
  // Only execute dragging if we are in scale view and a marker is being dragged.
  if (!draggingMarker || viewMode !== "scale") return;
  let rect = canvas.getBoundingClientRect();
  let mx = evt.clientX - rect.left;
  let newRatio = xToRatio(mx, LEFT_X, WIDTH);
  newRatio = Math.max(1.0001, Math.min(newRatio, 1.9999));
  let snapped = maybeSnap(newRatio);
  draggingMarker.floatVal = snapped;
  draggingMarker.fractionText = fractionStringApprox(snapped);
}

function getMarkerAtPosition(mx, my) {
  for (let deg of scaleDegrees) {
    if (deg.floatVal === 1 || deg.floatVal === 2) continue;
    let lineX = ratioToX(deg.floatVal, LEFT_X, WIDTH);
    let top = MID_Y - 70, bot = MID_Y + 70;
    if (my >= top && my <= bot && Math.abs(mx - lineX) <= DRAG_TOLERANCE_PX) {
      return deg;
    }
  }
  return null;
}
function xToRatio(mx, leftX, width) {
  let t = (mx - leftX) / width;
  return 1 + t * (2 - 1);
}
function registerClickable(x, y, w, h, callback) {
  clickableRegions.push({ x, y, w, h, callback });
}

/**************************************************************************
 * Play the scale notes
 **************************************************************************/
async function playScaleOnce() {
  let sorted = [...scaleDegrees].sort((a, b) => a.floatVal - b.floatVal);
  let noteDur = 0.5;
  for (let deg of sorted) {
    deg.pulse = { start: performance.now() };
    createParticlesGaussian(deg, DEFAULT_PARTICLE_COUNT);
    let freq = deg.floatVal * tonic;
    await playOneNoteSequential(freq, noteDur);
  }
}

/**************************************************************************
 * Snap & Preset Logic
 **************************************************************************/

function initSnapCandidates() {
  snapCandidates = [];
  for (let d = 1; d <= MAX_DEN; d++) {
    for (let n = 1; n < 2 * d; n++) {
      let ratio = n / d;
      if (ratio <= 1 || ratio >= 2) continue;
      if (gcd(n, d) === 1) {
        snapCandidates.push({ ratio, num: n, den: d });
      }
    }
  }
  snapCandidates.sort((a, b) => a.ratio - b.ratio);
}
function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}
function maybeSnap(ratio) {
  let best = ratio;
  let bestDiff = Infinity;
  for (let cand of snapCandidates) {
    let centsDiff = 1200 * Math.abs(Math.log2(ratio / cand.ratio));
    if (centsDiff < SNAP_THRESHOLD_CENTS && centsDiff < bestDiff) {
      best = cand.ratio;
      bestDiff = centsDiff;
    }
  }
  return best;
}
function applyPresetSelection() {
  let val = document.getElementById("presetSelect").value;
  let [type, numStr] = val.split("-");
  if (!type) return;
  if (type === "custom") {
    alert("Custom preset is not yet implemented. Coming soon!");
    return;
  }
  if (!confirm("This will overwrite current intervals. Continue?")) return;
  scaleDegrees = [
    { fractionText: "1/1", floatVal: 1.0, selected: false },
    { fractionText: "2/1", floatVal: 2.0, selected: false }
  ];
  let n = parseInt(numStr, 10);
  if (type === "harmonic") {
    for (let i = n + 1; i <= 2 * n; i++) {
      let valf = i / n;
      if (Math.abs(valf - 1) < 1e-7 || Math.abs(valf - 2) < 1e-7) continue;
      scaleDegrees.push({ fractionText: i + "/" + n, floatVal: valf, selected: false });
    }
  } else if (type === "equal") {
    for (let k = 1; k < n; k++) {
      let valf = Math.pow(2, k / n);
      if (Math.abs(valf - 1) < 1e-7 || Math.abs(valf - 2) < 1e-7) continue;
      scaleDegrees.push({ fractionText: `2^(${k}/${n})`, floatVal: valf, selected: false });
    }
  }
  scaleDegrees.sort((a, b) => a.floatVal - b.floatVal);
}

function doSave() {
  const formatSelect = document.getElementById("formatSelect");
  let format = formatSelect.value;
  const refMidi = parseInt(document.getElementById("refMidiNoteInput").value, 10) || 60;
  const refFreq = parseFloat(document.getElementById("refFreqInput").value) || 261.63;
  const lowestMidi = parseInt(document.getElementById("lowestNoteInput").value, 10) || 0;
  const highestMidi = parseInt(document.getElementById("highestNoteInput").value, 10) || 127;
  let fileContent = "", fileExtension = "";
  if (format === "json") {
    let data = {
      tonic: tonic,
      scaleDegrees: scaleDegrees.map(d => ({
        fractionText: d.fractionText,
        floatVal: d.floatVal,
        selected: d.selected
      }))
    };
    fileContent = JSON.stringify(data, null, 2);
    fileExtension = "json";
    downloadFile(fileContent, fileExtension);
  }
  else if (format === "scl") {
    fileContent = generateSclFileContent("My Scale", scaleDegrees);
    fileExtension = "scl";
    downloadFile(fileContent, fileExtension);
  }
  else if (format === "scl_kbm") {
    let sclContent = generateSclFileContent("My Scale", scaleDegrees);
    let kbmContent = generateKbmFileContent("My Scale Mapping", scaleDegrees, refMidi, refFreq, lowestMidi, highestMidi);
    downloadFile(sclContent, "scl");
    setTimeout(() => downloadFile(kbmContent, "kbm"), 500);
  }
  else if (format === "tun") {
    fileContent = generateTunFileContent(scaleDegrees, refMidi, refFreq);
    fileExtension = "tun";
    downloadFile(fileContent, fileExtension);
  }
}

function downloadFile(content, extension) {
  let now = new Date();
  let YYYY = now.getFullYear();
  let MM = String(now.getMonth() + 1).padStart(2, "0");
  let DD = String(now.getDate()).padStart(2, "0");
  let hh = String(now.getHours()).padStart(2, "0");
  let mm = String(now.getMinutes()).padStart(2, "0");
  let userCount = scaleDegrees.length - 2;
  let fileName = `scale-${YYYY}${MM}${DD}-${hh}${mm}-${userCount}.${extension}`;
  let blob = new Blob([content], { type: "text/plain" });
  let url = URL.createObjectURL(blob);
  let a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function doLoad(fileList) {
  if (!fileList || fileList.length < 1) return;
  let file = fileList[0];
  let reader = new FileReader();
  reader.onload = e => {
    try {
      let data = JSON.parse(e.target.result);
      if (!data.scaleDegrees || !Array.isArray(data.scaleDegrees)) {
        alert("Invalid file format: no scaleDegrees array found.");
        return;
      }
      if (!confirm("Loading will overwrite current intervals. Continue?")) return;
      tonic = data.tonic || 261.63;
      scaleDegrees = data.scaleDegrees.map(d => ({
        fractionText: d.fractionText,
        floatVal: d.floatVal,
        selected: !!d.selected
      }));
      scaleDegrees.sort((a, b) => a.floatVal - b.floatVal);
    } catch (err) {
      alert("Error parsing JSON: " + err);
      console.error(err);
    }
  };
  reader.readAsText(file);
}

/**************************************************************************
 * Helpers
 **************************************************************************/
function setControlsEnabled(enabled) {
  document.querySelectorAll(".controls button, .controls input, .controls select")
    .forEach(el => { el.disabled = !enabled; });
}

