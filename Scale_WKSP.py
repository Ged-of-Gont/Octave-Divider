import sys
import math
import numpy as np
import sounddevice as sd
from fractions import Fraction
from PyQt5.QtWidgets import (
    QApplication, QWidget, QComboBox, QLineEdit, QPushButton,
    QVBoxLayout, QHBoxLayout, QLabel, QMessageBox
)

# Total visual width for the entire octave bar (pixels).
TOTAL_WIDTH = 600
# Fixed width for each note button (pixels).
NOTE_BUTTON_WIDTH = 80

def generate_sine_wave(freq, duration=1.0, sample_rate=44100):
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    waveform = np.sin(2 * np.pi * freq * t)
    return waveform

def midi_to_freq(midi_note):
    # Standard conversion: A4 (MIDI 69) = 440 Hz.
    return 440 * 2 ** ((midi_note - 69) / 12)

def midi_to_note_name(midi_note):
    note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    octave = (midi_note // 12) - 1
    note = note_names[midi_note % 12]
    return f"{note}{octave}"

class SynthApp(QWidget):
    def __init__(self):
        super().__init__()
        
        # List of interval ratios (as Fractions), e.g. [3/2, 5/4, ...].
        self.intervals = []
        # The current tonic frequency (float).
        self.tonic_freq = None
        # Default tonic = Middle C (MIDI 60).
        self.default_tonic = midi_to_freq(60)
        
        self.initUI()
        
    def initUI(self):
        main_layout = QVBoxLayout()

        # --- Tonic Selection Section ---
        self.note_combo = QComboBox(self)
        # Generate 48 tones from MIDI 48 (C3) to MIDI 95 (B6).
        self.midi_notes = list(range(48, 96))
        for midi_note in self.midi_notes:
            note_name = midi_to_note_name(midi_note)
            freq = midi_to_freq(midi_note)
            self.note_combo.addItem(f"{note_name} - {freq:.2f} Hz", freq)
        
        self.freqInput = QLineEdit(self)
        self.freqInput.setPlaceholderText("Enter frequency manually (Hz)")
        
        self.playTonicButton = QPushButton("Play Tonic", self)
        self.playTonicButton.clicked.connect(self.play_tonic)

        tonic_layout = QVBoxLayout()
        tonic_layout.addWidget(QLabel("Select Tonic:"))
        tonic_layout.addWidget(self.note_combo)
        tonic_layout.addWidget(self.freqInput)
        tonic_layout.addWidget(self.playTonicButton)
        
        main_layout.addLayout(tonic_layout)
        
        # --- Interval Addition Section ---
        self.intervalInput = QLineEdit(self)
        self.intervalInput.setPlaceholderText("Enter interval ratio (e.g., 3/2)")
        self.addIntervalButton = QPushButton("Add Interval", self)
        self.addIntervalButton.clicked.connect(self.add_interval)
        
        self.intervalFreqLabel = QLabel("Interval Frequency: N/A", self)
        
        interval_layout = QVBoxLayout()
        interval_layout.addWidget(QLabel("Enter Interval Ratio:"))
        interval_layout.addWidget(self.intervalInput)
        interval_layout.addWidget(self.addIntervalButton)
        interval_layout.addWidget(self.intervalFreqLabel)
        
        main_layout.addLayout(interval_layout)
        
        # --- Scale Visual Display Section (Horizontal) ---
        self.scaleLabel = QLabel("Scale:", self)
        main_layout.addWidget(self.scaleLabel)
        
        # We'll put the scale in one horizontal layout,
        # but we’ll rebuild that layout each time we update.
        self.scaleLayout = QHBoxLayout()
        main_layout.addLayout(self.scaleLayout)
        
        # --- Reset Button Section ---
        self.resetButton = QPushButton("Reset Scale", self)
        self.resetButton.clicked.connect(self.reset_scale)
        main_layout.addWidget(self.resetButton)
        
        self.setLayout(main_layout)
        self.setWindowTitle("Scale Workshop")
        
        # Initialize with default tonic (Middle C).
        self.tonic_freq = self.default_tonic
        # Set combo box to Middle C (MIDI 60 => index 12 since 48 is index 0).
        self.note_combo.setCurrentIndex(12)
        
        # Build the initial display (no intervals).
        self.update_scale_visual()
        self.show()
        
    def get_tonic_frequency(self):
        """Get the frequency from manual input or combo box."""
        try:
            freq = float(self.freqInput.text())
            return freq
        except ValueError:
            return self.note_combo.currentData()

    def play_tonic(self):
        """Set and play the tonic without resetting intervals."""
        freq = self.get_tonic_frequency()
        self.tonic_freq = freq
        waveform = generate_sine_wave(freq)
        sd.play(waveform, 44100)
        # Refresh the display to reflect the new tonic.
        self.update_scale_visual()
        
    def play_frequency(self, freq):
        """Play a note at the given frequency."""
        waveform = generate_sine_wave(freq)
        sd.play(waveform, 44100)
        
    def add_interval(self):
        """Add a new interval ratio (if it won’t exceed the octave)."""
        if self.tonic_freq is None:
            self.tonic_freq = self.get_tonic_frequency()
        ratio_text = self.intervalInput.text().strip()
        if not ratio_text:
            QMessageBox.warning(self, "Input Error", "Please enter an interval ratio.")
            return
        try:
            new_ratio = (
                Fraction(ratio_text) 
                if '/' in ratio_text else Fraction(float(ratio_text)).limit_denominator(1000)
            )
        except Exception:
            QMessageBox.warning(self, "Input Error", "Invalid ratio format.")
            return
        
        # Check if adding this interval would exceed 2/1 in total.
        total_product = self.get_total_interval_product()
        if total_product * new_ratio > 2:
            QMessageBox.warning(self, "Input Error", "Adding this interval would exceed the octave (2/1).")
            return
        
        self.intervals.append(new_ratio)
        self.update_scale_visual()
        
    def interval_changed(self, idx, text):
        """Called when an interval text field is edited."""
        try:
            new_ratio = (
                Fraction(text) 
                if '/' in text else Fraction(float(text)).limit_denominator(1000)
            )
        except Exception:
            QMessageBox.warning(self, "Input Error", "Invalid ratio format in interval field.")
            self.update_scale_visual()
            return
        
        # Check if changing this interval would exceed 2/1 in total.
        old_ratio = self.intervals[idx]
        self.intervals[idx] = new_ratio
        total_product = self.get_total_interval_product()
        if total_product > 2:
            # Revert if it exceeds the octave.
            QMessageBox.warning(self, "Input Error", "This change would exceed the octave (2/1). Reverting.")
            self.intervals[idx] = old_ratio
        self.update_scale_visual()
        
    def reset_scale(self):
        """Reset everything to the default tonic (Middle C) and no intervals."""
        self.tonic_freq = self.default_tonic
        self.note_combo.setCurrentIndex(12)  # Middle C index.
        self.freqInput.clear()
        self.intervals = []
        self.intervalFreqLabel.setText("Interval Frequency: N/A")
        self.update_scale_visual()
        # Optionally play the tonic after resetting.
        waveform = generate_sine_wave(self.tonic_freq)
        sd.play(waveform, 44100)
        
    def get_total_interval_product(self):
        """Return the product of all intervals so far (as a float)."""
        product_fraction = Fraction(1)
        for r in self.intervals:
            product_fraction *= r
        return float(product_fraction)
        
    def update_scale_visual(self):
        """
        Rebuild the horizontal layout so that:
         1) The tonic button is on the left (fixed width).
         2) Each interval is shown as [variable-width text field | fixed-width note button].
         3) Finally, a variable-width leftover region plus the final (octave) note button if under an octave.
        """
        # Clear any existing widgets in self.scaleLayout.
        while self.scaleLayout.count():
            child = self.scaleLayout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        
        # The total width available for everything is TOTAL_WIDTH.
        # We have (N intervals + 1 final) note buttons, plus the 1 tonic button = N+2 note buttons total.
        # Each note button is NOTE_BUTTON_WIDTH wide => total button width = (N+2)*NOTE_BUTTON_WIDTH
        # The leftover is allocated among the N interval text fields + 1 final "remainder" field = N+1 fields.

        N = len(self.intervals)
        total_button_width = (N + 2) * NOTE_BUTTON_WIDTH
        # The space for the intervals + remainder text fields:
        total_text_width = TOTAL_WIDTH - total_button_width
        if total_text_width < 0:
            total_text_width = 0  # If there's not enough room, clamp to 0.

        # Compute how much of the octave we've used up so far.
        sum_logs = 0.0
        for r in self.intervals:
            sum_logs += math.log2(float(r))
        # sum_logs <= 1 if we haven't exceeded an octave.
        
        # Tonic button (far left).
        tonic_btn = QPushButton(f"{self.tonic_freq:.2f} Hz")
        tonic_btn.setFixedWidth(NOTE_BUTTON_WIDTH)
        tonic_btn.clicked.connect(lambda _, f=self.tonic_freq: self.play_frequency(f))
        self.scaleLayout.addWidget(tonic_btn)
        
        # Build up intervals in a left-to-right manner.
        current_product = 1.0
        for idx, ratio in enumerate(self.intervals):
            # fraction_of_logs = log2(ratio)/sum_logs if sum_logs>0 else 0
            # but to preserve relative widths, we do:
            this_log = math.log2(float(ratio))
            
            if sum_logs > 0:
                fraction_of_total = this_log / sum_logs
            else:
                # If we have no logs yet (N=0) or ratio is 1.0,
                # just keep them equal or at least some minimal fraction.
                fraction_of_total = 0
            
            # The actual pixel width for this interval text field.
            interval_field_width = max(0, int(round(total_text_width * fraction_of_total)))
            
            # Create the interval text field
            interval_edit = QLineEdit(str(ratio))
            interval_edit.setFixedWidth(interval_field_width if interval_field_width > 30 else 30)
            interval_edit.editingFinished.connect(
                lambda idx=idx, w=interval_edit: self.interval_changed(idx, w.text())
            )
            self.scaleLayout.addWidget(interval_edit)
            
            # Now the note button after applying this interval
            current_product *= float(ratio)
            note_freq = self.tonic_freq * current_product
            note_btn = QPushButton(f"{note_freq:.2f} Hz")
            note_btn.setFixedWidth(NOTE_BUTTON_WIDTH)
            note_btn.clicked.connect(lambda _, f=note_freq: self.play_frequency(f))
            self.scaleLayout.addWidget(note_btn)
        
        # Final remainder field + final octave button
        product_so_far = self.get_total_interval_product()
        if product_so_far < 2:
            # There's some leftover from product_so_far to 2.  
            # leftover in log-space = 1 - sum_logs
            leftover_logs = 1.0 - sum_logs
            # fraction_of_total for leftover = leftover_logs / sum_logs??? Actually we want it relative to the entire 1.0
            # but effectively, leftover_logs is the fraction of the total octave. So:
            if sum_logs < 1.0:
                fraction_of_total = leftover_logs  # if sum_logs + leftover_logs = 1
            else:
                fraction_of_total = 0
            
            leftover_field_width = max(0, int(round(total_text_width * fraction_of_total)))
            leftover_edit = QLineEdit("...")
            leftover_edit.setReadOnly(True)
            leftover_edit.setFixedWidth(leftover_field_width if leftover_field_width > 30 else 30)
            self.scaleLayout.addWidget(leftover_edit)
        else:
            # If we are exactly or above an octave, leftover is 0 or negative, so just put a minimal leftover field.
            leftover_edit = QLineEdit("...")
            leftover_edit.setReadOnly(True)
            leftover_edit.setFixedWidth(30)
            self.scaleLayout.addWidget(leftover_edit)
        
        # Finally, the octave button.
        octave_freq = self.tonic_freq * 2
        octave_btn = QPushButton(f"{octave_freq:.2f} Hz\n(Octave)")
        octave_btn.setFixedWidth(NOTE_BUTTON_WIDTH)
        octave_btn.clicked.connect(lambda _, f=octave_freq: self.play_frequency(f))
        self.scaleLayout.addWidget(octave_btn)
        
        # Update the label for the last interval frequency if there is one.
        # If no intervals, the last frequency is just the tonic.
        if self.intervals:
            last_freq = self.tonic_freq
            for r in self.intervals:
                last_freq *= float(r)
            self.intervalFreqLabel.setText(f"Interval Frequency: {last_freq:.2f} Hz")
        else:
            self.intervalFreqLabel.setText("Interval Frequency: N/A")

###############################################################################

if __name__ == "__main__":
    app = QApplication(sys.argv)
    ex = SynthApp()
    sys.exit(app.exec_())
