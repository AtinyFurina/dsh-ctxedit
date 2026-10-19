"""生成 22 秒环境垫音（低音量，避免喧宾夺主）。"""
import math
import struct
import wave

RATE = 44100
SECONDS = 22.0

with wave.open("docs/promo/video/code/pad.wav", "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    frames = bytearray()
    for i in range(int(RATE * SECONDS)):
        t = i / RATE
        env = min(1.0, t / 1.5) * min(1.0, (SECONDS - t) / 2.0)
        v = 0.5 * math.sin(2 * math.pi * 110 * t)
        v += 0.3 * math.sin(2 * math.pi * 165 * t + 0.5)
        v += 0.18 * math.sin(2 * math.pi * 220 * t + 1.1)
        trem = 0.85 + 0.15 * math.sin(2 * math.pi * 0.16 * t)
        val = int(max(-1.0, min(1.0, v * trem * env * 0.22)) * 32767)
        frames += struct.pack("<h", val)
    w.writeframes(bytes(frames))
print("saved docs/promo/video/code/pad.wav")
