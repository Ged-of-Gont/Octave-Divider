# Oktavia — Microtonal Scale Workshop

Oktavia is a browser-based microtonal **scale workshop** for exploring and playing custom tunings, intervals, and sonic experiments. It runs entirely client-side in JavaScript, with a canvas-based UI and Web Audio–driven sound.

---

## What You Can Do

### Build & Edit Custom Scales

- **Add intervals** by typing:
  - Ratios: `3/2`, `5/4`, `7/6`, etc.
  - Decimals: `1.414`, `1.2599`, etc.
  - Simple exponent forms like `2^(1/12)` (via the parser).
- **Delete intervals** by clicking the **pink ratio label** and confirming.
- **Reset to endpoints** with **Clear All**, which keeps only `1/1` and `2/1`.

### Drag & Snap Scale Degrees

- Drag the **vertical bars** on the main line to reshape your scale visually.
- Markers **snap** to nearby “nice” rational ratios within a threshold (in cents).
- The label updates to a best-guess fraction using continued-fraction approximation.

### Two Views: Scale & Keyboard

- **Scale view**
  - Shows 1/1–2/1 as a horizontal “octave line”.
  - Vertical markers for each scale degree.
  - Interval labels between adjacent scale degrees.
  - Particles and colored pulses when you play notes.

- **Keyboard view**
  - Each scale degree becomes a vertical “key,” rainbow-colored by ratio.
  - Tap or click keys to hear pitches based on the current tonic.
  - Touch handling prevents stuck notes on mobile by tracking touches per key.

Use the **“Show Keyboard / Show Scale”** toggle to switch between views. The instructions text under the controls changes accordingly.

### Hear the Scale

- **Click the turquoise Hz labels** to hear individual tones.
- **Toggle pink checkboxes** to mark degrees as part of a chord.
- When you click a Hz label with other degrees selected:
  - The base note and all selected notes play together as a chord.
  - Each played degree gets a brief particle burst and pulse effect.
- **Play Scale** button:
  - Plays all scale degrees between 1/1 and 2/1 **sequentially** from low to high.
  - Shows pulses and particles as it steps through the notes.

### Presets

The **Preset** dropdown can overwrite your current scale with:

- **Harmonic series fragments**, e.g. `harmonic-8`, `harmonic-12`, etc.
- **Equal divisions of the octave**, e.g. `equal-12`, `equal-19`, etc.

Under the hood:

- `harmonic-N` adds ratios `i/N` from `i = N+1` to `2N`, skipping exact `1/1` and `2/1`.
- `equal-N` uses powers of 2: `2^(k/N)` for `k = 1 … N-1`.

A **Custom** option is reserved for future expansion.

> **Note:** Loading a preset replaces the current intervals (after a confirmation dialog).

### Save & Load Tunings

Use the **Format** dropdown and **Save** button to export your current tuning:

- **JSON**
  - Full internal state: `tonic` and `scaleDegrees` (ratio text, float value, selection flags).
  - Best for working inside Oktavia and saving experiments.
- **SCL**
  - Standard `.scl` (Scala scale) file: cents values from 1/1 up to just below 2/1.
- **SCL + KBM**
  - Writes a `.scl` plus a `.kbm` (keyboard mapping) file.
  - Uses reference MIDI note / reference frequency / lowest & highest MIDI fields.
- **TUN**
  - Exports a `.tun` table with cents values and tuning metadata.

The filename embeds a timestamp and the number of user-defined scale degrees.

Use **Load** to read a previously saved JSON scale file back into the app.

---

## Snapping Behavior (Tweaking Notes)

Snapping to “nice” just ratios is controlled by a few constants in the code:

- `MAX_DEN` (currently 16)  
  The largest allowed denominator for candidate fractions.  
  Raising this (e.g. to 31 or 49) increases the pool of possible snap ratios but also increases the search cost. Very large values (like 99) may slow things down.

- `SNAP_THRESHOLD_CENTS` (currently 10)  
  The maximum distance (in cents) between the current dragged ratio and a candidate ratio for snapping to kick in.  
  - Lower values (e.g. 5) make the snapping **less eager** but more precise.
  - Higher values (e.g. 15) make markers **“stickier”** to nearby nice ratios.

- When a marker is dragged and snapped, its label is updated to a rational approximation:

  ```js
  draggingMarker.fractionText = fractionStringApprox(snapped);
  ```

  That function uses continued fractions to generate a simplified `num/den` representation. You can change or remove this behavior if you prefer different labeling (e.g. always decimals, or mixed forms).

---

## Audio Implementation

Oktavia uses the Web Audio API via a small dedicated module:

- **Lazy AudioContext**
  - The context is only created when first needed (`getAudioCtx()`), which helps keep iOS browsers happy about “user-gesture–triggered” audio.
- **unlockAudio()**
  - Called at the start of any interaction that might produce sound.
  - Resumes the AudioContext (if suspended) and plays an ultra-short, almost-silent beep to fully “unlock” audio on mobile browsers.
- **playOneNoteSequential(freq, duration)**
  - Plays a single note with a shaped amplitude envelope, and resolves a promise when done. Used for the “Play Scale” sweep and the audio test beep.
- **playNotesSimult(freqArray)**
  - Plays multiple oscillators at once for simple chords.
  - Uses a shared amplitude helper so chords don’t clip too hard even with several voices.

Each oscillator uses a triangle wave by default and runs through a simple gain envelope.

> If audio doesn’t work on mobile, check:
> - Browser settings for “Allow website audio” / bell icon.
> - That you’ve actually tapped somewhere in the app first (iOS can block autoplay).

---

## Visuals & Particle System

- When you play a note (or chord), the app creates **colored particle bursts** centered over the corresponding scale degree.
- Particle color is derived from `ratioToHue(ratio)`, mapping 1/1–2/1 to a 0–360° hue range.
- The particle system uses:
  - A **Laplace distribution** in X for a long-tailed horizontal spread.
  - A **Gaussian distribution** in Y for a softer vertical spread.
  - A global **particle cap** to avoid runaway performance issues.
- Keyboard keys use a **rainbow HSL mapping** with adjustable saturation and lightness constants.

Pulses on markers and keys use a short-lived alpha fade, creating a subtle “flash” without overwhelming the canvas.

---

## File / Module Structure (Simplified)

The project is organized roughly as:

- **HTML / CSS**
  - Main layout, controls, buttons, and instructions text.
  - The canvas element for drawing the scale or keyboard.
  - CSS variables (`:root`) control colors and particle settings.

- **`app.js`**
  - Overall application logic.
  - Manages:
    - Scale data (`scaleDegrees`, `tonic`).
    - Canvas rendering (scale and keyboard views).
    - Drag-and-snap behavior.
    - UI wiring for buttons, inputs, and presets.
    - Particle creation and animation loop.
    - Save / load workflow and format-specific options.

- **`js modules/audio.js`**
  - All Web Audio handling:
    - `getAudioCtx()`, `unlockAudio()`.
    - `playOneNoteSequential()` and `playNotesSimult()`.
    - Amplitude scaling (`ampForFreq`) to keep levels in a safe range.

- **`js modules/math-utils.js`**
  - `fractionStringApprox` and related utilities for rational approximations.
  - `parseFractionOrDecimal` for flexible ratio input.
  - `ratioToHue`, `hexToRgba`, and small helpers used during rendering.

- **`js modules/tuning-export.js`**
  - Functions to generate `.scl`, `.kbm`, and `.tun` file contents from the current scale.

This modular split keeps audio, math, and export logic separated from the main UI + canvas code.

---

## Ideas for Future Enhancements

- Velocity / dynamic controls per note or chord.
- Multiple octaves or multi-octave keyboard layout.
- Polyphonic recording / sequencer mode.
- Visual overlays for standard tuning systems (12-TET, meantone, etc.).
- User-definable color themes and particle styles.
- More preset families (overtone / undertone series, CPS sets, etc.).

---

## License

TBD — add your preferred license here (MIT, Apache-2.0, etc.).
