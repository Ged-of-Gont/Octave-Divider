import sys
import numpy as np
import sounddevice as sd
from PyQt5.QtWidgets import (
    QApplication, QWidget, QComboBox, QLineEdit, QPushButton,
    QVBoxLayout, QHBoxLayout, QLabel, QMessageBox
)
from fractions import Fraction

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
        self.intervals = []  # List to store interval ratios as Fraction objects.
        self.tonic_freq = None  # Will store the tonic frequency.
        self.default_tonic = midi_to_freq(60)  # Middle C (MIDI 60).
        self.initUI()
        
    def initUI(self):
        main_layout = QVBoxLayout()

        # --- Tonic Section ---
        self.note_combo = QComboBox(self)
        # Generate 48 tones from MIDI 48 (C3) to MIDI 95 (B6)
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
        
        # --- Scale Display Section (Horizontal) ---
        self.scaleLayout = QHBoxLayout()
        self.scaleLabel = QLabel("Scale:", self)
        main_layout.addWidget(self.scaleLabel)
        main_layout.addLayout(self.scaleLayout)
        
        # --- Reset Button Section ---
        self.resetButton = QPushButton("Reset Scale", self)
        self.resetButton.clicked.connect(self.reset_scale)
        main_layout.addWidget(self.resetButton)
        
        self.setLayout(main_layout)
        self.setWindowTitle("Scale Workshop")
        
        # Initialize with default tonic (middle C)
        self.tonic_freq = self.default_tonic
        # Set note_combo to middle C (MIDI 60, which is index 60 - 48 = 12)
        self.note_combo.setCurrentIndex(12)
        self.update_scale_display()
        self.show()
        
    def get_tonic_frequency(self):
        # Try to get the frequency from manual input first; if not provided, use the combo box.
        try:
            freq = float(self.freqInput.text())
            return freq
        except ValueError:
            freq = self.note_combo.currentData()
            return freq

    def play_tonic(self):
        # Play the tonic and update the scale display without resetting intervals.
        freq = self.get_tonic_frequency()
        waveform = generate_sine_wave(freq)
        sd.play(waveform, 44100)
        self.tonic_freq = freq
        self.update_scale_display()
        
    def play_frequency(self, freq):
        waveform = generate_sine_wave(freq)
        sd.play(waveform, 44100)
        
    def add_interval(self):
        if self.tonic_freq is None:
            self.tonic_freq = self.get_tonic_frequency()
        ratio_text = self.intervalInput.text().strip()
        if not ratio_text:
            QMessageBox.warning(self, "Input Error", "Please enter an interval ratio.")
            return
        try:
            # Parse the ratio while preserving fractional notation.
            if '/' in ratio_text:
                new_ratio = Fraction(ratio_text)
            else:
                new_ratio = Fraction(float(ratio_text)).limit_denominator(1000)
        except Exception:
            QMessageBox.warning(self, "Input Error", "Invalid ratio format.")
            return
        
        self.intervals.append(new_ratio)
        
        # Compute the new frequency for display (cumulative product of intervals)
        new_freq = self.tonic_freq
        for interval in self.intervals:
            new_freq *= float(interval)
        self.intervalFreqLabel.setText(f"Interval Frequency: {new_freq:.2f} Hz")
        
        self.update_scale_display()
        
    def update_scale_display(self):
        # Clear the existing scale layout.
        while self.scaleLayout.count():
            child = self.scaleLayout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
                
        # Start with the tonic button.
        freq = self.tonic_freq if self.tonic_freq is not None else self.get_tonic_frequency()
        tonic_btn = QPushButton(f"{freq:.2f} Hz", self)
        tonic_btn.clicked.connect(lambda _, f=freq: self.play_frequency(f))
        self.scaleLayout.addWidget(tonic_btn)
        
        # Compute and display subsequent notes with editable interval fields.
        cumulative_freq = freq
        for idx, interval in enumerate(self.intervals):
            # Create an editable field for the interval ratio, preserving fractional notation.
            interval_edit = QLineEdit(self)
            interval_edit.setFixedWidth(60)
            interval_edit.setText(str(interval))
            interval_edit.editingFinished.connect(
                lambda idx=idx, widget=interval_edit: self.interval_changed(idx, widget.text())
            )
            self.scaleLayout.addWidget(interval_edit)
            
            # Compute the new frequency by applying the interval.
            cumulative_freq *= float(interval)
            note_btn = QPushButton(f"{cumulative_freq:.2f} Hz", self)
            note_btn.clicked.connect(lambda _, f=cumulative_freq: self.play_frequency(f))
            self.scaleLayout.addWidget(note_btn)
            
    def interval_changed(self, idx, text):
        # Called when an interval edit is changed.
        try:
            if '/' in text:
                new_ratio = Fraction(text)
            else:
                new_ratio = Fraction(float(text)).limit_denominator(1000)
        except Exception:
            QMessageBox.warning(self, "Input Error", "Invalid ratio format in interval field.")
            return
        
        self.intervals[idx] = new_ratio
        self.update_scale_display()
        
    def reset_scale(self):
        # Reset the program to its default state (tonic = middle C and intervals cleared).
        self.tonic_freq = self.default_tonic
        self.note_combo.setCurrentIndex(12)  # Middle C.
        self.freqInput.clear()
        self.intervals = []
        self.intervalFreqLabel.setText("Interval Frequency: N/A")
        self.update_scale_display()
        waveform = generate_sine_wave(self.tonic_freq)
        sd.play(waveform, 44100)
        
if __name__ == "__main__":
    app = QApplication(sys.argv)
    ex = SynthApp()
    sys.exit(app.exec_())
