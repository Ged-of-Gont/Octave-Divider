/**************************************************************************
 * 1) Variables + Setup
 **************************************************************************/
const cssVars = getComputedStyle(document.documentElement);

const DRAG_TOLERANCE_PX = parseFloat(cssVars.getPropertyValue("--drag-tolerance-px")) || 10;
const DEFAULT_PARTICLE_COUNT = parseFloat(cssVars.getPropertyValue("--default-particle-count")) || 250;
const PARTICLE_STDEV = parseFloat(cssVars.getPropertyValue("--particle-stdev")) || 6;
const PARTICLE_VELOCITY_SCALE = parseFloat(cssVars.getPropertyValue("--particle-velocity-scale")) || 0.02;
const PARTICLE_LIFETIME_BASE = parseFloat(cssVars.getPropertyValue("--particle-lifetime-base")) || 1000;
const PARTICLE_LIFETIME_RND = parseFloat(cssVars.getPropertyValue("--particle-lifetime-random")) || 100;
const GLOBAL_PARTICLE_CAP = parseInt(cssVars.getPropertyValue("--particle-global-cap")) || 2000;

// Create AudioContext
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isPlaying = false;

// The scale
let scaleDegrees = [
  { fractionText: "1/1", floatVal: 1.0, selected: false },
  { fractionText: "2/1", floatVal: 2.0, selected: false }
];
let tonic = 261.63;

// Particles
let particles = [];

let viewMode = "scale"; 

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

  // Reference the silent audio element (must be present in your HTML)
  const silentAudio = document.getElementById('unlockSound');

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

  // NEW/UPDATED: "Play Scale" button handler with audio unlock
  document.getElementById("playScaleBtn").addEventListener("click", async () => {
    await unlockAudio(); // call our unlocking function

    if (isPlaying) return;
    isPlaying = true;
    setControlsEnabled(false);
    await playScaleOnce();
    setControlsEnabled(true);
    isPlaying = false;
  });

  document.getElementById("toggleViewBtn").addEventListener("click", () => {
    if (viewMode === "scale") {
      viewMode = "keyboard";
      document.getElementById("toggleViewBtn").innerText = "Show Scale";
    } else {
      viewMode = "scale";
      document.getElementById("toggleViewBtn").innerText = "Show Keyboard";
    }
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
 * NEW/UPDATED: Reusable unlockAudio() function
 **************************************************************************/
async function unlockAudio() {
  const silentAudio = document.getElementById('unlockSound');
  if (!silentAudio) return;
  try {
    await silentAudio.play();
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    // Optionally, pause after a short delay
    setTimeout(() => {
      silentAudio.pause();
      silentAudio.currentTime = 0;
    }, 200);
  } catch (err) {
    console.warn("Silent track failed to play:", err);
  }
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
  
  // Clear the canvas (optional if already cleared in animate())
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Determine the number of keys based on the scaleDegrees array
  let keysCount = scaleDegrees.length;
  if (keysCount < 1) return; // Safety check
  
  // Calculate the dimensions of each key
  let keyWidth = canvas.width / keysCount;
  let keyHeight = canvas.height * 0.8;
  let y = (canvas.height - keyHeight) / 2; // Center the keys vertically

  // Loop through the scaleDegrees to draw each key
  for (let i = 0; i < keysCount; i++) {
    let x = i * keyWidth;
    
    // Draw the key rectangle
    ctx.fillStyle = "#ccc"; // Base fill color for keys
    ctx.strokeStyle = "#333"; 
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, keyWidth, keyHeight);
    ctx.strokeRect(x, y, keyWidth, keyHeight);
    
    // Get the note information for labeling
    let note = scaleDegrees[i];
    let freq = note.floatVal * tonic;
    
    // Draw the labels on the key (for ratio and frequency)
    ctx.fillStyle = "#000"; 
    ctx.font = "16px JetBrains Mono";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    
    // You might split the text into two lines: ratio on top, frequency on bottom
    ctx.fillText(note.fractionText, x + keyWidth / 2, y + keyHeight / 3);
    ctx.fillText(freq.toFixed(2) + " Hz", x + keyWidth / 2, y + (2 * keyHeight) / 3);
    
    // Register clickable region for the entire key so that clicking plays its note
    registerClickable(x, y, keyWidth, keyHeight, async (trigger) => {
      // When triggered via touch, trigger will be the touch object.
      // When triggered by mouse, it will be an event, which won’t have an identifier.
      if (viewMode === "keyboard") {
        // Only for keyboard view: if this note is already active (i.e. triggered by the same touch),
        // then do nothing.
        if (note.keyboardActive !== undefined) return;
        // If trigger has an identifier, set it.
        if (trigger && trigger.identifier !== undefined) {
          note.keyboardActive = trigger.identifier;
        }
        await unlockAudio();
        // Provide visual feedback.
        note.pulse = { start: performance.now() };
        createParticlesGaussian(note, DEFAULT_PARTICLE_COUNT);
        
        // Play only this key's note (no chord-logic).
        playNotesSimult([ note.floatVal * tonic ]);
      } else {
        // In scale view, use the original behavior with chord and selected notes.
        await unlockAudio();
        note.pulse = { start: performance.now() };
        createParticlesGaussian(note, DEFAULT_PARTICLE_COUNT);
    
        let others = scaleDegrees.filter(d => d.selected && d !== note);
        others.forEach(o => {
          o.pulse = { start: performance.now() };
          createParticlesGaussian(o, DEFAULT_PARTICLE_COUNT);
        });
        
        let freqValue = note.floatVal * tonic;
        let allFreqs = [freqValue, ...others.map(o => o.floatVal * tonic)];
        playNotesSimult(allFreqs);
      }
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
      // NEW/UPDATED: unlock audio if frequency label is tapped first
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
/**************************************************************************
 * Touch Events for Dragging (NEW)
 **************************************************************************/
function onCanvasTouchStart(e) {
  e.preventDefault(); // Prevent scrolling
  let rect = canvas.getBoundingClientRect();

  // Use changedTouches to process only new touches
  for (let i = 0; i < e.changedTouches.length; i++) {
    let t = e.changedTouches[i];
    let mx = t.clientX - rect.left;
    let my = t.clientY - rect.top;

    // In scale view, check for draggable markers.
    if (viewMode === "scale") {
      let marker = getMarkerAtPosition(mx, my);
      if (marker) {
        draggingMarker = marker;
        continue;
      }
    }
    
    // Check through clickable regions for new touch.
    for (let j = clickableRegions.length - 1; j >= 0; j--) {
      let r = clickableRegions[j];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        // Pass the individual touch object (t) to the callback.
        r.callback(t);
        break;
      }
    }
  }
}


function onCanvasTouchMove(e) {
  e.preventDefault();
  let rect = canvas.getBoundingClientRect();
  
  // Only process dragging in scale view
  if (viewMode === "scale" && draggingMarker) {
    for (let i = 0; i < e.touches.length; i++) {
      let t = e.touches[i];
      let mx = t.clientX - rect.left;
      let newRatio = xToRatio(mx, LEFT_X, WIDTH);
      newRatio = Math.max(1.0001, Math.min(newRatio, 1.9999));
      let snapped = maybeSnap(newRatio);
      draggingMarker.floatVal = snapped;
      draggingMarker.fractionText = fractionStringApprox(snapped);
    }
  }
}

function onCanvasTouchEnd(e) {
  // Iterate over the touches that ended
  for (let i = 0; i < e.changedTouches.length; i++) {
    let t = e.changedTouches[i];
    // Clear the keyboardActive flag for any note that was triggered by this touch.
    scaleDegrees.forEach(note => {
      if (note.keyboardActive === t.identifier) {
        note.keyboardActive = undefined;
      }
    });
  }
  // In case there are no more touches, clear dragging marker.
  if (e.touches.length === 0) {
    draggingMarker = null;
  }
  e.preventDefault();
}


/**************************************************************************
 * Mouse events for dragging
 **************************************************************************/
function onCanvasMouseDown(evt) {
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
function playOneNoteSequential(freq, duration) {
  return new Promise(async resolve => {
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);
    let baseAmp = 0.2;
    let freqWeight = Math.sqrt(440 / freq);
    let finalAmp = baseAmp * freqWeight;
    if (finalAmp > 0.8) finalAmp = 0.8;
    gain.gain.setValueAtTime(finalAmp, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.onended = () => resolve();
    osc.start(now);
    osc.stop(now + duration);
  });
}
async function playNotesSimult(freqArray) {
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
  const now = audioCtx.currentTime;
  const duration = 1.0;
  let n = freqArray.length;
  if (n < 1) return;
  for (let freq of freqArray) {
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);
    let baseAmp = 0.2 / n;
    let freqWeight = Math.sqrt(440 / freq);
    let finalAmp = baseAmp * freqWeight;
    if (finalAmp > 0.8) finalAmp = 0.8;
    gain.gain.setValueAtTime(finalAmp, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }
}

/**************************************************************************
 * Snap & SCL / KBM / TUN functions
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
function generateSclFileContent(scaleName, scaleDegrees) {
  let sorted = [...scaleDegrees].sort((a, b) => a.floatVal - b.floatVal);
  let relevant = sorted.filter(d => d.floatVal < 2.000001);
  let numIntervals = relevant.length - 1;
  if (numIntervals < 1) numIntervals = 1;
  let lines = [];
  lines.push(`! ${scaleName}`);
  lines.push(`${scaleName}`);
  lines.push(`${numIntervals}`);
  lines.push("!");
  for (let i = 1; i < relevant.length; i++) {
    let ratio = relevant[i].floatVal;
    let cents = 1200 * Math.log2(ratio);
    lines.push(cents.toFixed(5));
  }
  return lines.join("\n") + "\n";
}
function generateKbmFileContent(comment, scaleDegrees, refMidi, refFreq, lowestMidi, highestMidi) {
  let lines = [];
  lines.push(`! ${comment}`);
  lines.push("!");
  const mapSize = (highestMidi - lowestMidi) + 1;
  lines.push(`${mapSize}`);
  lines.push(`${lowestMidi}`);
  lines.push(`${highestMidi}`);
  lines.push(`${refMidi}`);
  lines.push("0");
  lines.push(`! Reference frequency for MIDI note ${refMidi} = ${refFreq.toFixed(3)} Hz`);
  let sorted = [...scaleDegrees].sort((a, b) => a.floatVal - b.floatVal);
  const scaleCount = sorted.length;
  for (let k = lowestMidi; k <= highestMidi; k++) {
    let cycleLen = scaleCount - 1;
    if (cycleLen < 1) cycleLen = 1;
    let indexInScale = (k - lowestMidi) % cycleLen;
    lines.push(`${indexInScale}`);
  }
  return lines.join("\n") + "\n";
}
function generateTunFileContent(scaleDegrees, refMidi, refFreq) {
  let sorted = [...scaleDegrees].sort((a, b) => a.floatVal - b.floatVal);
  let lines = [];
  lines.push("! Generated by Scale WKSP");
  lines.push("table begin");
  for (let i = 0; i < sorted.length; i++) {
    let ratio = sorted[i].floatVal;
    let cents = 1200 * Math.log2(ratio);
    lines.push(` ${i + 1}) ${cents.toFixed(5)}`);
  }
  lines.push("table end");
  lines.push("octave 1200.0");
  lines.push(`middle note ${refMidi}`);
  lines.push(`base freq ${refFreq.toFixed(5)}`);
  return lines.join("\n") + "\n";
}

/**************************************************************************
 * Helpers
 **************************************************************************/
function setControlsEnabled(enabled) {
  document.querySelectorAll(".controls button, .controls input, .controls select")
    .forEach(el => { el.disabled = !enabled; });
}
function fractionStringApprox(x) {
  let [num, den] = bestRationalApproximation(x, 100000);
  let approx = num / den;
  let err = Math.abs(x - approx);
  let label = `${num}/${den}`;
  if (err > 0.01) label = "~" + label;
  return label;
}
function bestRationalApproximation(x, maxDen) {
  let pPrevPrev = 0, pPrev = 1;
  let qPrevPrev = 1, qPrev = 0;
  let fraction = x;
  let a = Math.floor(fraction);
  let p = a * pPrev + pPrevPrev;
  let q = a * qPrev + qPrevPrev;
  while (true) {
    let remainder = fraction - a;
    if (Math.abs(remainder) < 1e-12) break;
    fraction = 1 / remainder;
    a = Math.floor(fraction);
    let pNext = a * p + pPrev;
    let qNext = a * q + qPrev;
    if (qNext > maxDen) break;
    pPrevPrev = pPrev;
    qPrevPrev = qPrev;
    pPrev = p;
    qPrev = q;
    p = pNext;
    q = qNext;
  }
  return [p, q];
}
function parseFractionOrDecimal(s) {
  s = s.trim();
  if (!s) return NaN;
  if (s.includes("^")) {
    let match = s.match(/^(.+)\^(.+)$/);
    if (!match) return NaN;
    let baseStr = match[1].replace(/^\(+/, "").replace(/\)+$/, "");
    let expStr = match[2].replace(/^\(+/, "").replace(/\)+$/, "");
    let baseVal = parseFractionOrDecimal(baseStr);
    let expVal = parseFractionOrDecimal(expStr);
    if (!isFinite(baseVal) || !isFinite(expVal)) return NaN;
    return Math.pow(baseVal, expVal);
  }
  if (s.includes("/")) {
    let parts = s.split("/");
    if (parts.length !== 2) return NaN;
    let num = parseFloat(parts[0]);
    let den = parseFloat(parts[1]);
    if (!isFinite(num) || !isFinite(den) || den === 0) return NaN;
    return num / den;
  }
  return parseFloat(s);
}
function ratioToHue(ratio) {
  let t = ratio - 1;
  return 360 * t;
}
