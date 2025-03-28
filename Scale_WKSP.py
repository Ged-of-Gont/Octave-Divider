import sys
import math
import numpy as np
import sounddevice as sd
from fractions import Fraction

from PyQt5.QtWidgets import (
    QApplication, QWidget, QLineEdit, QPushButton,
    QVBoxLayout, QHBoxLayout, QLabel, QMessageBox,
    QComboBox
)
from PyQt5.QtCore import Qt, QTimer

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
    """Return a simplified fraction string for a float value (e.g. 1.333 -> '4/3')."""
    try:
        frac = Fraction(value).limit_denominator(32)
        return f"{frac.numerator}/{frac.denominator}"
    except:
        return f"{value:.3f}"

###############################################################################
# Matplotlib Canvas
###############################################################################
class ScaleCanvas(FigureCanvasQTAgg):
    """
    A Matplotlib canvas that draws the scale from 1.0 to 2.0 along the x-axis,
    with vertical ticks for each scale degree, interval labels, and frequency labels.
    We connect 'button_press_event' to handle right-click removal of intervals.
    """
    def __init__(self, parent=None, width=8, height=4, dpi=100):
        self.fig = Figure(figsize=(width, height), dpi=dpi)
        super().__init__(self.fig)
        self.setParent(parent)
        
        self.axes = self.fig.add_subplot(111)
        
        # This callback will be set by the main app so we can pass click events to it
        self.click_callback = None
        # Connect the Matplotlib event
        self.mpl_connect("button_press_event", self._on_click)

    def _on_click(self, event):
        """Internal method that relays matplotlib clicks to the provided callback."""
        if self.click_callback is not None:
            self.click_callback(event)
        
    def set_click_callback(self, cb):
        self.click_callback = cb

    def plot_scale(self, scale_degrees, tonic_freq):
        """
        scale_degrees: sorted list of floats in [1.0, 2.0].
        tonic_freq: float
        """
        self.axes.clear()
        
        # Basic axis range
        self.axes.set_xlim(0.95, 2.05)
        self.axes.set_ylim(-0.5, 0.5)
        
        # Horizontal line for the "x-axis"
        self.axes.axhline(0, color='white', linewidth=1)
        
        # Vertical lines for each scale degree
        for x in scale_degrees:
            self.axes.axvline(x, color='gray', linestyle='-', linewidth=1)
        
        # Interval labels between adjacent degrees
        for i in range(len(scale_degrees) - 1):
            left = scale_degrees[i]
            right = scale_degrees[i + 1]
            gap = right / left
            mid_x = (left + right) / 2.0
            self.axes.text(mid_x, 0.15, fraction_str(gap),
                           ha='center', va='bottom', color='white', fontsize=12)
        
        # Each scale degree: ratio above, freq below
        for x in scale_degrees:
            ratio_label = fraction_str(x)
            freq_val = x * tonic_freq
            freq_label = f"{freq_val:.4g} Hz"
            self.axes.text(x, 0.35, ratio_label,
                           ha='center', va='bottom', color='cyan', fontsize=10)
            self.axes.text(x, -0.35, freq_label,
                           ha='center', va='top', color='yellow', fontsize=9)
        
        self.axes.set_xticks([])
        self.axes.set_yticks([])
        self.axes.set_facecolor("#2C2C2C")
        for spine in self.axes.spines.values():
            spine.set_visible(False)
        
        self.draw()

###############################################################################
# Main Application Class
###############################################################################
class ScaleWorkshop(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Scale Workshop (Interactive)")
        self.setMinimumSize(1200, 800)
        
        # Default tonic = Middle C
        self.default_tonic = 261.63
        self.tonic_freq = self.default_tonic
        
        # Scale degrees: always [1.0, 2.0] plus user-defined
        self.scale_degrees = [1.0, 2.0]
        
        self.initUI()
        
    def initUI(self):
        main_layout = QVBoxLayout(self)
        
        # --- Tonic & Interval Input ---
        input_layout = QHBoxLayout()
        
        # Tonic
        self.tonicInput = QLineEdit()
        self.tonicInput.setPlaceholderText("Tonic Frequency (Hz)")
        self.tonicInput.setText(f"{self.default_tonic}")
        
        self.note_combo = QComboBox()
        midi_notes = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72]
        for m in midi_notes:
            f = midi_to_freq(m)
            self.note_combo.addItem(f"MIDI {m} ~ {f:.2f} Hz", f)
        # Middle C is MIDI 60
        if 60 in midi_notes:
            self.note_combo.setCurrentIndex(midi_notes.index(60))
        
        self.note_combo.currentIndexChanged.connect(self.combo_to_lineedit)
        
        self.setTonicBtn = QPushButton("Set Tonic")
        self.setTonicBtn.clicked.connect(self.set_tonic)
        
        input_layout.addWidget(QLabel("Tonic:"))
        input_layout.addWidget(self.tonicInput)
        input_layout.addWidget(self.note_combo)
        input_layout.addWidget(self.setTonicBtn)
        
        # Interval
        self.intervalInput = QLineEdit()
        self.intervalInput.setPlaceholderText("Ratio >1 & <2 (e.g. 3/2)")
        self.addIntervalBtn = QPushButton("Add Interval")
        self.addIntervalBtn.clicked.connect(self.add_interval)
        
        input_layout.addWidget(QLabel("New Interval:"))
        input_layout.addWidget(self.intervalInput)
        input_layout.addWidget(self.addIntervalBtn)
        
        main_layout.addLayout(input_layout)
        
        # --- The Plot ---
        self.canvas = ScaleCanvas(self, width=8, height=4, dpi=100)
        main_layout.addWidget(self.canvas)
        
        # Let the canvas call us back on clicks
        self.canvas.set_click_callback(self.handle_canvas_click)
        
        # --- Bottom: Frequency Buttons ---
        self.freqButtonsLayout = QHBoxLayout()
        main_layout.addLayout(self.freqButtonsLayout)
        
        self.update_plot()

    ############################################################################
    # Tonic & Interval Input
    ############################################################################
    def combo_to_lineedit(self):
        """When user picks from combo, put that freq in the line edit."""
        freq = self.note_combo.currentData()
        self.tonicInput.setText(f"{freq:.2f}")
        
    def set_tonic(self):
        """Set the tonic frequency from the line edit (fallback to combo if invalid)."""
        try:
            freq = float(self.tonicInput.text())
        except ValueError:
            freq = self.note_combo.currentData()
        if freq <= 0:
            QMessageBox.warning(self, "Input Error", "Tonic must be > 0.")
            return
        self.tonic_freq = freq
        self.update_plot()
        
    def add_interval(self):
        """Add a new ratio between 1.0 and 2.0, if valid."""
        text = self.intervalInput.text().strip()
        if not text:
            QMessageBox.warning(self, "Input Error", "Please enter a ratio.")
            return
        try:
            if '/' in text:
                val = float(Fraction(text))
            else:
                val = float(text)
        except:
            QMessageBox.warning(self, "Input Error", "Invalid ratio format.")
            return
        
        if val <= 1.0 or val >= 2.0:
            QMessageBox.warning(self, "Range Error", "Ratio must be > 1.0 and < 2.0.")
            return
        
        if val not in self.scale_degrees:
            self.scale_degrees.append(val)
            self.scale_degrees.sort()
        self.update_plot()

    ############################################################################
    # Plot & Frequency Buttons
    ############################################################################
    def update_plot(self):
        """Redraw the scale on the canvas and rebuild the freq buttons."""
        self.canvas.plot_scale(self.scale_degrees, self.tonic_freq)
        self.build_freq_buttons()
        
    def build_freq_buttons(self):
        """Recreate the row of freq buttons for each scale degree."""
        while self.freqButtonsLayout.count():
            child = self.freqButtonsLayout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        for deg in self.scale_degrees:
            freq_val = deg * self.tonic_freq
            btn = QPushButton(f"{freq_val:.4g} Hz")
            btn.clicked.connect(lambda _, f=freq_val: self.play_frequency(f))
            self.freqButtonsLayout.addWidget(btn)
            
    def play_frequency(self, freq):
        """Play a short sine wave at freq."""
        wave = generate_sine_wave(freq, duration=1.0)
        sd.play(wave, samplerate=44100)

    ############################################################################
    # Right-Click Deletion - With QTimer Scheduling
    ############################################################################
    def handle_canvas_click(self, event):
        """
        Called on every mouse click in the plot.
        We only act if:
         - It's a right-click (button=3)
         - The xdata is close to a scale degree (except 1.0 and 2.0)
         - We schedule the "confirm deletion" after we leave the event callback
        """
        if event.button != 3 or event.xdata is None:
            return
        
        tol = 0.03
        clicked_deg = None
        for deg in self.scale_degrees:
            if deg in (1.0, 2.0):
                continue
            if abs(event.xdata - deg) < tol:
                clicked_deg = deg
                break
        
        if clicked_deg is not None:
            # Instead of prompting right now, schedule a prompt after we exit this callback
            QTimer.singleShot(0, lambda d=clicked_deg: self._confirm_delete_degree(d))
    
    def _confirm_delete_degree(self, deg):
        """Show the confirmation message box and remove the degree if user says yes."""
        response = QMessageBox.question(
            self,
            "Delete Interval?",
            f"Delete scale degree {fraction_str(deg)}?",
            QMessageBox.Yes | QMessageBox.No
        )
        if response == QMessageBox.Yes:
            self.scale_degrees.remove(deg)
            self.update_plot()

###############################################################################
# Run the App
###############################################################################
if __name__ == "__main__":
    app = QApplication(sys.argv)
    
    window = ScaleWorkshop()
    window.show()
    sys.exit(app.exec_())
