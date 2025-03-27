import sys
import numpy as np
import sounddevice as sd
from PyQt5.QtWidgets import (QApplication, QWidget, QComboBox, QLineEdit, 
                             QPushButton, QVBoxLayout, QHBoxLayout, QLabel, QMessageBox)

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
        self.scale_notes = []  # will store the frequencies for the built scale
        self.initUI()
        
    def initUI(self):
        main_layout = QVBoxLayout()

        # --- Base Tone Section ---
        self.note_combo = QComboBox(self)
        # Generate 48 tones from MIDI 48 (C3) to MIDI 95 (B6)
        self.midi_notes = list(range(48, 96))
        for midi_note in self.midi_notes:
            note_name = midi_to_note_name(midi_note)
            freq = midi_to_freq(midi_note)
            self.note_combo.addItem(f"{note_name} - {freq:.2f} Hz", freq)
        
        self.freqInput = QLineEdit(self)
        self.freqInput.setPlaceholderText("Enter frequency manually (Hz)")
        
        self.playBaseButton = QPushButton("Play Tonic", self)
        self.playBaseButton.clicked.connect(self.play_base_tone)

        base_layout = QVBoxLayout()
        base_layout.addWidget(QLabel("Select Tonic:"))
        base_layout.addWidget(self.note_combo)
        base_layout.addWidget(self.freqInput)
        base_layout.addWidget(self.playBaseButton)
        
        main_layout.addLayout(base_layout)
        
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
        
        self.setLayout(main_layout)
        self.setWindowTitle("Scale Workshop")
        self.show()
        
    def get_base_frequency(self):
        # Try to get the frequency from manual input first; if not provided, use the combo box.
        try:
            freq = float(self.freqInput.text())
            return freq
        except ValueError:
            # Use the frequency stored in the combo box item data
            freq = self.note_combo.currentData()
            return freq

    def play_base_tone(self):
        freq = self.get_base_frequency()
        waveform = generate_sine_wave(freq)
        sd.play(waveform, 44100)
        # Reset the scale to start with the base frequency
        self.scale_notes = [freq]
        # Clear any previous scale buttons
        while self.scaleLayout.count():
            child = self.scaleLayout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        # Add a button for the tonic in the horizontal scale display
        btn = QPushButton(f"{freq:.2f} Hz", self)
        btn.clicked.connect(lambda _, f=freq: self.play_frequency(f))
        self.scaleLayout.addWidget(btn)
        self.intervalFreqLabel.setText("Interval Frequency: N/A")
        
    def play_frequency(self, freq):
        waveform = generate_sine_wave(freq)
        sd.play(waveform, 44100)
        
    def add_interval(self):
        # Ensure there's a tonic to build on.
        if not self.scale_notes:
            base_freq = self.get_base_frequency()
            self.scale_notes = [base_freq]
            btn = QPushButton(f"{base_freq:.2f} Hz", self)
            btn.clicked.connect(lambda _, f=base_freq: self.play_frequency(f))
            self.scaleLayout.addWidget(btn)
        last_freq = self.scale_notes[-1]
        ratio_text = self.intervalInput.text().strip()
        if not ratio_text:
            QMessageBox.warning(self, "Input Error", "Please enter an interval ratio.")
            return
        try:
            if '/' in ratio_text:
                num, den = ratio_text.split('/')
                ratio = float(num) / float(den)
            else:
                ratio = float(ratio_text)
        except ValueError:
            QMessageBox.warning(self, "Input Error", "Invalid ratio format.")
            return
        new_freq = last_freq * ratio
        self.scale_notes.append(new_freq)
        # Update the label to display the new frequency
        self.intervalFreqLabel.setText(f"Interval Frequency: {new_freq:.2f} Hz")
        # Create a new button for the new note and add it horizontally
        btn = QPushButton(f"{new_freq:.2f} Hz", self)
        btn.clicked.connect(lambda _, f=new_freq: self.play_frequency(f))
        self.scaleLayout.addWidget(btn)
        
if __name__ == "__main__":
    app = QApplication(sys.argv)
    ex = SynthApp()
    sys.exit(app.exec_())
