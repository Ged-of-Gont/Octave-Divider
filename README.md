 ▗▄▄▖ ▗▄▄▖ ▗▄▖ ▗▖   ▗▄▄▄▖    ▗▖ ▗▖▗▖ ▗▖ ▗▄▄▖▗▄▄▖ 
▐▌   ▐▌   ▐▌ ▐▌▐▌   ▐▌       ▐▌ ▐▌▐▌▗▞▘▐▌   ▐▌ ▐▌
 ▝▀▚▖▐▌   ▐▛▀▜▌▐▌   ▐▛▀▀▘    ▐▌ ▐▌▐▛▚▖  ▝▀▚▖▐▛▀▘ 
▗▄▄▞▘▝▚▄▄▖▐▌ ▐▌▐▙▄▄▖▐▙▄▄▖    ▐▙█▟▌▐▌ ▐▌▗▄▄▞▘▐▌                                                                                    
                                                           

 This is a JavaScript-based microtonal scale workshop for exploring and playing custom tunings, intervals, and sonic experiments in the browser.

## Features

- **Add & Remove Intervals**  
  Create your own scale steps by entering ratios, fractions, or decimal values.

- **Drag Markers**  
  Click-and-drag scale degrees along the octave axis to reshape your scale.

- **Snap to Just Ratios**  
  Markers can optionally “stick” to nearby low-limit ratios (e.g., 3/2, 5/4).

- **Audio Playback**  
  Hear each tone sequentially or play chords by selecting multiple intervals.

- **Presets**  
  Load built-in harmonic or equal-temperament scales (e.g. 12-TET, 19-TET, etc.).

- **Save & Load**  
  Save your custom scale to a JSON file, or load it back later.









TWEAKING NOTES::


How to Customize the Snapping

    MAX_DEN (currently 16) – Increase this if you want to include more fractions, e.g. 99 for truly “double-digit denominator.” But be aware, that’s a big list, so if you notice slowdown, you can limit it to 31 or 49, etc.

    SNAP_THRESHOLD_CENTS – Currently 10, so if the dragged ratio is within ~10 cents of a candidate ratio, it snaps there. You can lower to 5 if you want tighter snapping or raise it to 15 for “stickier” snapping.

    Updating Fraction Text – Notice in onCanvasMouseMove(), we do:

    draggingMarker.fractionText = fractionStringApprox(snapped);

    That means the textual label changes to your best rational approximation. You can remove or tweak that line if you prefer a different labeling scheme.

