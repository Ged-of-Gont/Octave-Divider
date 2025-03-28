import sys
import math
import numpy as np
import sounddevice as sd
from fractions import Fraction

from PyQt5.QtWidgets import (
    QApplication, QWidget, QLineEdit, QPushButton,
    QVBoxLayout, QHBoxLayout, QLabel, QMessageBox,
    QComboBox, QFrame
)
from PyQt5.QtCore import Qt

# Matplotlib imports for embedding into PyQt
from matplotlib.backends.backend_qt5agg import FigureCanvasQTAgg
from matplotlib.figure import Figure

###############################################################################
# Utility Functions
###############################################################################

def generate_sine_wave(freq, duration=1.0, sample_rate=44100):
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    waveform = np.sin(2 * np.pi * freq * t)
    return waveform

def midi_to_freq(midi_note):
    """Standard conversion: A4 (MIDI 69) = 440 Hz."""
    return 440.0 * 2.0 ** ((midi_note - 69) / 12.0)

def fraction_str(value):
    """
    Given a float like 1.3333, return a simplified fraction (e.g. "4/3").
    If it can't find a nice fraction, just return the float in short format.
    """
    try:
        frac = Fraction(value).limit_denominator(32)  # You can adjust the denominator limit
        return f"{frac.numerator}/{frac.denominator}"
    except:
        return f"{value:.3f}"

###############################################################################
# Main Canvas for Plot
###############################################################################
class ScaleCanvas(FigureCanvasQTAgg):
    """
    A Matplotlib canvas that draws the scale from 1.0 to 2.0 along the x-axis,
    with vertical ticks for each scale degree, interval labels, and frequency labels.
    """
    def __init__(self, parent=None, width=5, height=3, dpi=100):
        fig = Figure(figsize=(width, height), dpi=dpi)
        self.axes = fig.add_subplot(111)
        super().__init__(fig)
        self.setParent(parent)

    def plot_scale(self, scale_degrees, tonic_freq):
        """
        scale_degrees: sorted list of floats between 1.0 and 2.0 (inclusive).
                       e.g. [1.0, 1.25, 1.5, 2.0]
        tonic_freq: float, e.g. 261.63 for middle C
        """
        self.axes.clear()
        
        # Basic plot settings
        self.axes.set_xlim(0.95, 2.05)  # just a bit beyond 1.0 and 2.0
        self.axes.set_ylim(-0.5, 0.5)   # just a small vertical range for text
        self.axes.axhline(0, color='white', linewidth=1)  # x-axis line
        
        # Plot each scale degree as a vertical line
        for x in scale_degrees:
            self.axes.axvline(x, color='gray', linestyle='-', linewidth=1)

        # Label intervals between adjacent degrees
        for i in range(len(scale_degrees) - 1):
            left = scale_degrees[i]
            right = scale_degrees[i+1]
            gap = right / left  # e.g. 1.5/1.25 = 1.2 => 6/5
            mid_x = (left + right) / 2.0
            
            # Interval label above the axis
            self.axes.text(mid_x, 0.15, fraction_str(gap),
                           ha='center', va='bottom', color='white', fontsize=12)

        # Label each degree: ratio above, frequency below
        for x in scale_degrees:
            ratio_label = fraction_str(x)  # fraction vs. unison
            freq = x * tonic_freq
            freq_label = f"{freq:.4g} Hz"  # ~4 significant figures

            # ratio text above x-axis
            self.axes.text(x, 0.35, ratio_label,
                           ha='center', va='bottom', color='cyan', fontsize=10)
            # freq text below x-axis
            self.axes.text(x, -0.35, freq_label,
                           ha='center', va='top', color='yellow', fontsize=9)

        # Hide standard x and y ticks
        self.axes.set_xticks([])
        self.axes.set_yticks([])
        self.axes.set_facecolor("#2C2C2C")
        self.axes.spines["top"].set_visible(False)
        self.axes.spines["bottom"].set_visible(False)
        self.axes.spines["left"].set_visible(False)
        self.axes.spines["right"].set_visible(False)

        self.draw()

###############################################################################
# Main Application Class
###############################################################################
class ScaleWorkshop(QWidget):
    def __init__(self):
        super().__init__()
        
        self.setWindowTitle("Scale Workshop (Graphical)")
        self.setMinimumSize(1200, 800)
        
        # Default = Middle C
        self.default_tonic = 261.63
        self.tonic_freq = self.default_tonic
        
        # Store a sorted list of scale degrees (floats), always including 1.0 and 2.0
        self.scale_degrees = [1.0, 2.0]  # unison and octave
        
        self.initUI()

    def initUI(self):
        main_layout = QVBoxLayout(self)
        
        # ----------- Top: Tonic & Ratio Input -----------
        input_layout = QHBoxLayout()
        
        # Tonic Frequency
        self.tonicInput = QLineEdit()
        self.tonicInput.setPlaceholderText("Tonic Frequency (Hz)")
        self.tonicInput.setText(f"{self.default_tonic}")
        
        # For convenience, also allow a combo to select common notes
        self.note_combo = QComboBox()
        # A quick selection of MIDI notes around Middle C
        midi_notes = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72]
        for midi_note in midi_notes:
            freq = midi_to_freq(midi_note)
            self.note_combo.addItem(f"MIDI {midi_note} ~ {freq:.2f} Hz", freq)
        # Middle C is MIDI 60
        self.note_combo.setCurrentIndex(midi_notes.index(60))
        # When the combo changes, we update the line edit with that frequency
        self.note_combo.currentIndexChanged.connect(self.combo_to_lineedit)
        
        self.setTonicBtn = QPushButton("Set Tonic")
        self.setTonicBtn.clicked.connect(self.set_tonic)
        
        input_layout.addWidget(QLabel("Tonic:"))
        input_layout.addWidget(self.tonicInput)
        input_layout.addWidget(self.note_combo)
        input_layout.addWidget(self.setTonicBtn)
        
        # Interval input
        self.intervalInput = QLineEdit()
        self.intervalInput.setPlaceholderText("Add scale degree ratio > 1.0 & < 2.0 (e.g. 3/2 or 1.414)")
        
        self.addIntervalBtn = QPushButton("Add Interval")
        self.addIntervalBtn.clicked.connect(self.add_interval)
        
        input_layout.addWidget(QLabel("New Interval:"))
        input_layout.addWidget(self.intervalInput)
        input_layout.addWidget(self.addIntervalBtn)
        
        main_layout.addLayout(input_layout)
        
        # ----------- Middle: The Plot -----------
        self.canvas = ScaleCanvas(self, width=8, height=4, dpi=100)
        main_layout.addWidget(self.canvas)
        
        # ----------- Bottom: Play Buttons -----------
        # We'll show a row of frequency buttons for each scale degree
        self.freqButtonsLayout = QHBoxLayout()
        main_layout.addLayout(self.freqButtonsLayout)
        
        self.update_plot()

    def combo_to_lineedit(self):
        """Whenever the user picks a note from the combo, put that frequency into the line edit."""
        freq = self.note_combo.currentData()
        self.tonicInput.setText(f"{freq:.2f}")
        
    def set_tonic(self):
        """Set the tonic frequency from the line edit. If invalid, revert to the combo value."""
        try:
            freq = float(self.tonicInput.text())
        except ValueError:
            freq = self.note_combo.currentData()
        if freq <= 0:
            QMessageBox.warning(self, "Input Error", "Tonic must be a positive number.")
            return
        self.tonic_freq = freq
        self.update_plot()

    def add_interval(self):
        """Insert a new ratio between 1.0 and 2.0 (excluded). Then re-sort."""
        text = self.intervalInput.text().strip()
        if not text:
            QMessageBox.warning(self, "Input Error", "Please enter a ratio (e.g. 3/2, 1.414).")
            return
        try:
            # parse fraction or float
            if '/' in text:
                val = float(Fraction(text))
            else:
                val = float(text)
        except Exception:
            QMessageBox.warning(self, "Input Error", "Invalid ratio format.")
            return
        
        if val <= 1.0 or val >= 2.0:
            QMessageBox.warning(self, "Range Error", "Ratio must be > 1.0 and < 2.0.")
            return
        
        # Insert into scale_degrees (excluding duplicates)
        if val not in self.scale_degrees:
            self.scale_degrees.append(val)
            self.scale_degrees.sort()
        
        self.update_plot()

    def update_plot(self):
        """Redraw the scale with the current scale degrees and tonic."""
        # Plot
        self.canvas.plot_scale(self.scale_degrees, self.tonic_freq)
        # Rebuild frequency buttons
        self.build_freq_buttons()

    def build_freq_buttons(self):
        """Recreate the row of frequency buttons for each scale degree."""
        # Clear old buttons
        while self.freqButtonsLayout.count():
            child = self.freqButtonsLayout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        
        # Create a button for each scale degree
        for deg in self.scale_degrees:
            freq = deg * self.tonic_freq
            btn = QPushButton(f"{freq:.4g} Hz")
            btn.clicked.connect(lambda _, f=freq: self.play_frequency(f))
            self.freqButtonsLayout.addWidget(btn)

    def play_frequency(self, freq):
        """Play a short sine wave of the given frequency."""
        wave = generate_sine_wave(freq, duration=1.0)
        sd.play(wave, samplerate=44100)


###############################################################################
# Run the App
###############################################################################
if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = ScaleWorkshop()
    window.show()
    sys.exit(app.exec_())
