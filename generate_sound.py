"""Generate a short ping sound as a WAV file (no dependencies needed)."""
import math
import struct
import wave

FILENAME = "static/ping.wav"
SAMPLE_RATE = 44100
DURATION = 0.15  # seconds
FREQ = 880  # Hz (A5 — a nice crisp ping)

num_samples = int(SAMPLE_RATE * DURATION)
samples = []
for i in range(num_samples):
    t = i / SAMPLE_RATE
    # Sine wave with quick exponential decay
    envelope = math.exp(-t * 30)
    value = envelope * math.sin(2 * math.pi * FREQ * t)
    samples.append(int(value * 32767))

with wave.open(FILENAME, "w") as f:
    f.setnchannels(1)
    f.setsampwidth(2)
    f.setframerate(SAMPLE_RATE)
    f.writeframes(struct.pack(f"<{len(samples)}h", *samples))

print(f"Generated {FILENAME}")
