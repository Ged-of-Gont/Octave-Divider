import sys
import numpy as np
import sounddevice as sd
from PyQt5.QtWidgets import QApplication, QWidget, QComboBox, QLineEdit, QPushButton, QVBoxLayout, QLabel

def generate_sine_wave(freq, duration=1.0, sample_rate=44100):
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    waveform = np.sin(2 * np.pi * freq * t)
    return waveform

class SynthApp(QWidget):
    def __init__(self):
        super().__init__()
        self.initUI()
        
    def initUI(self):
        # Combo box for 48 tones over 4 octaves
        self.combo = QComboBox(self)
        notes = []
        for octave in range(3, 7):  # Using octaves 3 to 6
            for i in range(12):
                # Calculate semitone offset from A4 (which is at 440 Hz)
                # Here, we approximate by treating A as the 10th note (index 9) in a 0-indexed scale starting at C.
                n = (octave - 4) * 12 + i - 9
                freq = 440 * (2 ** (n / 12))
                notes.append(f"{octave}:{i} - {freq:.2f} Hz")
        self.combo.addItems(notes)
        
        # Frequency input field (manual entry)
        self.freqInput = QLineEdit(self)
        self.freqInput.setPlaceholderText("Enter frequency manually (Hz)")
        
        # Button to play the base tone
        self.playButton = QPushButton("Play Base Tone", self)
        self.playButton.clicked.connect(self.play_tone)
        
        # Interval ratio input
        self.intervalInput = QLineEdit(self)
        self.intervalInput.setPlaceholderText("Enter interval ratio (e.g., 3/2)")
        
        # Button to play the interval tone
        self.addIntervalButton = QPushButton("Play Interval Tone", self)
        self.addIntervalButton.clicked.connect(self.play_interval_tone)
        
        # Layout setup
        layout = QVBoxLayout()
        layout.addWidget(QLabel("Select Tonic:"))
        layout.addWidget(self.combo)
        layout.addWidget(self.freqInput)
        layout.addWidget(self.playButton)
        layout.addWidget(QLabel("Enter Interval Ratio:"))
        layout.addWidget(self.intervalInput)
        layout.addWidget(self.addIntervalButton)
        
        self.setLayout(layout)
        self.setWindowTitle("Simple Audio Synth")
        self.show()
        
    def play_tone(self):
        # Get frequency either from manual input or the combo box selection
        try:
            freq = float(self.freqInput.text())
        except ValueError:
            index = self.combo.currentIndex()
            text = self.combo.itemText(index)
            # Assumes the frequency is the second-to-last element when splitting the string.
            freq = float(text.split()[-2])
        waveform = generate_sine_wave(freq)
        sd.play(waveform, 44100)
        
    def play_interval_tone(self):
        # Use the base frequency from manual input or combo box selection
        try:
            base_freq = float(self.freqInput.text())
        except ValueError:
            index = self.combo.currentIndex()
            text = self.combo.itemText(index)
            base_freq = float(text.split()[-2])
        ratio_text = self.intervalInput.text()
        try:
            if '/' in ratio_text:
                num, den = ratio_text.split('/')
                ratio = float(num) / float(den)
            else:
                ratio = float(ratio_text)
        except ValueError:
            ratio = 1.0  # Fallback to unison if parsing fails
        new_freq = base_freq * ratio
        waveform = generate_sine_wave(new_freq)
        sd.play(waveform, 44100)
        
if __name__ == "__main__":
    app = QApplication(sys.argv)
    ex = SynthApp()
    sys.exit(app.exec_())
