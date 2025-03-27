import sys
import math
import numpy as np
import sounddevice as sd
from fractions import Fraction
from PyQt5.QtWidgets import (
    QApplication, QWidget, QComboBox, QLineEdit, QPushButton,
    QVBoxLayout, QHBoxLayout, QLabel, QMessageBox, QScrollArea,
    QFrame
)
from PyQt5.QtCore import Qt

###############################################################################
# Utility Functions
###############################################################################

def generate_sine_wave(freq, duration=1.0, sample_rate=44100):
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    waveform = np.sin(2 * np.pi * freq * t)
    return waveform

def midi_to_freq(midi_note):
    # Standard conversion: A4 (MIDI 69) = 440 Hz
    return 440 * 2 ** ((midi_note - 69) / 12)

def midi_to_note_name(midi_note):
    note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    octave = (midi_note // 12) - 1
    note = note_names[midi_note % 12]
    return f"{note}{octave}"

###############################################################################
# Main Application Class
###############################################################################

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
        """
        Set up the main window, color scheme, and all widgets/layouts.
        """
        # -----------------
        # Window setup
        # -----------------
        self.setWindowTitle("Scale Workshop")
        # A larger minimum size so nothing is cramped
        self.setMinimumSize(1200, 700)
        
        # -----------------
        # Dark Mode Styling
        # -----------------
        self.setStyleSheet("""
            /* Overall dark background, light text, modern sans-serif font */
            QWidget {
                background-color: #2C2C2C;
                color: #EEEEEE;
                font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
                font-size: 15px;
            }
            /* Slightly lighter line edit background, subtle border */
            QLineEdit {
                background-color: #424242;
                border: 1px solid #555;
                border-radius: 4px;
                padding: 6px;
                margin: 4px;
                color: #EEEEEE;
            }
            /* Accent color for buttons, with hover effect */
            QPushButton {
                background-color: #E91E63;
                color: #FFFFFF;
                border: none;
                border-radius: 6px;
                padding: 8px 14px;
                margin: 4px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #C2185B;
            }
            /* Labels have small margins */
            QLabel {
                margin: 4px;
            }
        """)

        # -----------------
        # Main Layout
        # -----------------
        main_layout = QVBoxLayout(self)
        self.setLayout(main_layout)

        # --- Tonic Selection Section ---
        tonic_layout = QVBoxLayout()
        tonic_label = QLabel("Select Tonic:")
        tonic_layout.addWidget(tonic_label)
        
        self.note_combo = QComboBox()
        # Generate 48 tones from MIDI 48 (C3) to MIDI 95 (B6)
        for midi_note in range(48, 96):
            note_name = midi_to_note_name(midi_note)
            freq = midi_to_freq(midi_note)
            self.note_combo.addItem(f"{note_name} - {freq:.2f} Hz", freq)
        tonic_layout.addWidget(self.note_combo)
        
        self.freqInput = QLineEdit()
        self.freqInput.setPlaceholderText("Enter frequency manually (Hz)")
        tonic_layout.addWidget(self.freqInput)
        
        self.playTonicButton = QPushButton("Play Tonic")
        self.playTonicButton.clicked.connect(self.play_tonic)
        tonic_layout.addWidget(self.playTonicButton)
        
        main_layout.addLayout(tonic_layout)
        
        # --- Interval Addition Section ---
        interval_input_layout = QVBoxLayout()
        
        interval_label = QLabel("Enter Interval Ratio:")
        interval_input_layout.addWidget(interval_label)
        
        self.intervalInput = QLineEdit()
        self.intervalInput.setPlaceholderText("e.g., 3/2 or 1.5")
        interval_input_layout.addWidget(self.intervalInput)
        
        self.addIntervalButton = QPushButton("Add Interval")
        self.addIntervalButton.clicked.connect(self.add_interval)
        interval_input_layout.addWidget(self.addIntervalButton)
        
        self.intervalFreqLabel = QLabel("Interval Frequency: N/A")
        interval_input_layout.addWidget(self.intervalFreqLabel)
        
        main_layout.addLayout(interval_input_layout)
        
        # --- Scale Display in a Scroll Area ---
        # We wrap a horizontal layout in a scroll area so it never overflows the window.
        self.scale_scroll = QScrollArea()
        self.scale_scroll.setWidgetResizable(True)
        self.scale_scroll.setStyleSheet("QScrollArea { border: none; }")
        
        # This frame will hold the actual horizontal layout
        self.scale_frame = QFrame()
        self.scale_frame.setStyleSheet("background-color: #2C2C2C;")
        
        self.scaleLayout = QHBoxLayout(self.scale_frame)
        self.scaleLayout.setContentsMargins(10, 10, 10, 10)
        self.scaleLayout.setSpacing(30)  # spacing between interval blocks

        # Put the frame inside the scroll area
        self.scale_scroll.setWidget(self.scale_frame)
        
        # Add a label "Scale:" above the scroll area
        scale_label = QLabel("Scale:")
        main_layout.addWidget(scale_label)
        # Then add the scroll area
        main_layout.addWidget(self.scale_scroll)
        
        # --- Reset Button Section ---
        self.resetButton = QPushButton("Reset Scale")
        self.resetButton.clicked.connect(self.reset_scale)
        main_layout.addWidget(self.resetButton, alignment=Qt.AlignLeft)

        # Initialize with default tonic (Middle C).
        self.tonic_freq = self.default_tonic
        # Set combo box to Middle C (MIDI 60 => index 12, since 48 is index 0).
        self.note_combo.setCurrentIndex(12)
        
        # Build the initial display (no intervals yet).
        self.update_scale_visual()

    ############################################################################
    # Event Handlers
    ############################################################################
    
    def get_tonic_frequency(self):
        """Get the frequency from manual input or the combo box."""
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
        """Add a new interval ratio, if it won’t exceed 2/1 in total."""
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
        
        old_ratio = self.intervals[idx]
        self.intervals[idx] = new_ratio
        
        # Check if changing this interval would exceed 2/1 in total.
        total_product = self.get_total_interval_product()
        if total_product > 2:
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

    ############################################################################
    # Core Logic
    ############################################################################

    def get_total_interval_product(self):
        """Return the product of all intervals so far (as a float)."""
        product_fraction = Fraction(1)
        for r in self.intervals:
            product_fraction *= r
        return float(product_fraction)
        
    def update_scale_visual(self):
        """
        Rebuild the horizontal layout in self.scale_frame:
          - Tonic block on the left
          - Then each interval in a vertical block:
              [Fraction Label]
              [QLineEdit]
              [Frequency Button]
          - Finally an Octave block at the end
        """
        # Clear any existing widgets in self.scaleLayout.
        while self.scaleLayout.count():
            child = self.scaleLayout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        
        # 1) Tonic block
        tonic_block = QVBoxLayout()
        tonic_block.setContentsMargins(0,0,0,0)
        
        tonic_lbl = QLabel("Tonic")
        tonic_lbl.setAlignment(Qt.AlignHCenter)
        tonic_block.addWidget(tonic_lbl)
        
        tonic_btn = QPushButton(f"{self.tonic_freq:.2f} Hz")
        # Typically about 100px wide
        tonic_btn.clicked.connect(lambda _, f=self.tonic_freq: self.play_frequency(f))
        tonic_block.addWidget(tonic_btn, alignment=Qt.AlignHCenter)
        
        tonic_container = QFrame()
        tonic_container.setLayout(tonic_block)
        self.scaleLayout.addWidget(tonic_container)
        
        # 2) Interval blocks
        product_so_far = 1.0
        for idx, ratio in enumerate(self.intervals):
            val = float(ratio)
            product_so_far *= val
            freq = self.tonic_freq * product_so_far
            
            # Build a vertical block with label, editable ratio, and freq button
            block_layout = QVBoxLayout()
            block_layout.setContentsMargins(0,0,0,0)
            
            ratio_lbl = QLabel(str(ratio))  # shows fraction (e.g. "3/2")
            ratio_lbl.setAlignment(Qt.AlignHCenter)
            block_layout.addWidget(ratio_lbl)
            
            ratio_edit = QLineEdit(str(ratio))
            ratio_edit.editingFinished.connect(
                lambda idx=idx, w=ratio_edit: self.interval_changed(idx, w.text())
            )
            block_layout.addWidget(ratio_edit)
            
            freq_btn = QPushButton(f"{freq:.2f} Hz")
            freq_btn.clicked.connect(lambda _, fr=freq: self.play_frequency(fr))
            block_layout.addWidget(freq_btn, alignment=Qt.AlignHCenter)
            
            block_container = QFrame()
            block_container.setLayout(block_layout)
            self.scaleLayout.addWidget(block_container)
        
        # 3) Octave block
        # Always a final block for the note "tonic * 2"
        octave_block = QVBoxLayout()
        octave_block.setContentsMargins(0,0,0,0)
        
        octave_lbl = QLabel("Octave")
        octave_lbl.setAlignment(Qt.AlignHCenter)
        octave_block.addWidget(octave_lbl)
        
        octave_freq = self.tonic_freq * 2
        octave_btn = QPushButton(f"{octave_freq:.2f} Hz")
        octave_btn.clicked.connect(lambda _, fr=octave_freq: self.play_frequency(fr))
        octave_block.addWidget(octave_btn, alignment=Qt.AlignHCenter)
        
        octave_container = QFrame()
        octave_container.setLayout(octave_block)
        self.scaleLayout.addWidget(octave_container)
        
        # Update the label for the "Interval Frequency"
        if self.intervals:
            self.intervalFreqLabel.setText(
                f"Interval Frequency: {(self.tonic_freq * product_so_far):.2f} Hz"
            )
        else:
            self.intervalFreqLabel.setText("Interval Frequency: N/A")

###############################################################################
# Run the App
###############################################################################
if __name__ == "__main__":
    app = QApplication(sys.argv)
    ex = SynthApp()
    ex.show()
    sys.exit(app.exec_())
