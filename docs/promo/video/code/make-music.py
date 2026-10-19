"""用 MIDI 音符序列生成 24 秒配乐：写出 music.mid，并用 numpy 合成 music.wav。

不依赖 fluidsynth：音符数据是 MIDI 事件，音频由同一份序列在本机合成（pad + 琶音 + 贝斯 + 鼓）。
"""
import math
import struct
import wave

import numpy as np

SR = 44100
BPM = 96.0
BEAT = 60.0 / BPM
BAR = BEAT * 4
DUR = 24.0
N = int(SR * DUR)


def note(name):
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    pitch, octave = name[:-1], int(name[-1])
    return 12 * (octave + 1) + names[pitch]


def freq(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


CHORDS = [
    ("Am", ["A2", "C3", "E3"], "A2"),
    ("F", ["F2", "A2", "C3"], "F2"),
    ("C", ["C3", "E3", "G3"], "C3"),
    ("G", ["G2", "B2", "D3"], "G2"),
]

# ---------- MIDI 文件 ----------
def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def track(events):
    data = b"".join(vlq(dt) + msg for dt, msg in events) + vlq(0) + b"\xff\x2f\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + data


def write_midi(path):
    ticks = 480
    tempo = int(60_000_000 / BPM)
    conductor = [(0, b"\xff\x51\x03" + tempo.to_bytes(3, "big")), (0, b"\xff\x58\x04\x04\x02\x18\x08")]
    pad, arp, bass, drums = [], [], [], []

    def add(track, t, msg):
        track.append((int(t * ticks), msg))

    # 和弦垫：每小节一个和弦，循环
    t = 0.0
    for rep in range(3):
        for name, notes, root in CHORDS:
            if t >= DUR:
                break
            length = min(BAR, DUR - t)
            for nm in notes:
                p = note(nm)
                add(pad, t, bytes([0x90, p, 52]))
                add(pad, t + length - 0.05, bytes([0x80, p, 0]))
            # 贝斯：每小节根音
            add(bass, t, bytes([0x90, note(root) - 12, 78]))
            add(bass, t + length - 0.08, bytes([0x80, note(root) - 12, 0]))
            t += length

    # 琶音：八分音符
    t = 0.0
    step = BEAT / 2
    idx = 0
    while t < DUR - 0.1:
        chord = CHORDS[int(t // BAR) % 4]
        notes = [note(n) for n in chord[1]]
        p = notes[idx % len(notes)] + (12 if idx % 4 == 3 else 0)
        add(arp, t, bytes([0x90, p, 64]))
        add(arp, t + step * 0.9, bytes([0x80, p, 0]))
        idx += 1
        t += step

    # 鼓：底鼓 1/3 拍，闭镲反拍
    t = 0.0
    while t < DUR - 0.1:
        add(drums, t, bytes([0x99, 36, 96]))
        add(drums, t + 0.12, bytes([0x89, 36, 0]))
        add(drums, t + BEAT / 2, bytes([0x99, 42, 44]))
        add(drums, t + BEAT / 2 + 0.03, bytes([0x89, 42, 0]))
        t += BEAT

    tracks = [track(conductor), track(pad), track(arp), track(bass), track(drums)]
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), ticks)
    with open(path, "wb") as f:
        f.write(header + b"".join(tracks))


# ---------- 合成 ----------
def env(n, attack, decay, sustain, release, total):
    a = min(int(attack * n), n)
    d = min(int(decay * n), n - a)
    r = min(int(release * n), n - a - d)
    e = np.full(n, sustain, dtype=np.float64)
    if a > 0:
        e[:a] = np.linspace(0, 1, a)
    if d > 0:
        e[a:a + d] = np.linspace(1, sustain, d)
    if r > 0:
        e[-r:] *= np.linspace(1, 0, r)
    return e


buf = np.zeros((N, 2), dtype=np.float64)


def place(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    l = math.sqrt((1 - pan) / 2)
    r = math.sqrt((1 + pan) / 2)
    buf[i:i + len(sig), 0] += sig * l
    buf[i:i + len(sig), 1] += sig * r


def pad_tone(midi, dur, gain):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = freq(midi)
    sig = np.sin(2 * np.pi * f * t) + 0.18 * np.sin(2 * np.pi * f * 2.001 * t)
    sig += 0.06 * np.sin(2 * np.pi * f * 3.002 * t)
    sig *= env(n, 0.5, 0.8, 0.7, 1.2, dur)
    # 一阶低通
    alpha = 0.03
    out = np.empty_like(sig)
    acc = 0.0
    for k in range(n):
        acc += alpha * (sig[k] - acc)
        out[k] = acc
    return out * gain


def pluck(midi, gain):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = freq(midi)
    sig = np.sin(2 * np.pi * f * t) * np.exp(-7 * t)
    sig += 0.35 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-9 * t)
    return sig * gain


def bass_tone(midi, dur, gain):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = freq(midi)
    sig = np.sin(2 * np.pi * f * t) * env(n, 0.02, 0.2, 0.8, 0.3, dur)
    sig += 0.2 * np.sin(2 * np.pi * f * 2 * t) * env(n, 0.02, 0.2, 0.6, 0.3, dur)
    return sig * gain


def kick(gain):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    f = 120 * np.exp(-18 * t) + 45
    sig = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-9 * t)
    return sig * gain


def hat(gain):
    n = int(0.06 * SR)
    sig = np.random.default_rng(7).normal(0, 1, n) * np.exp(-55 * np.linspace(0, 1, n))
    return sig * gain


# 铺底
t = 0.0
for rep in range(3):
    for name, notes, root in CHORDS:
        if t >= DUR:
            break
        length = min(BAR, DUR - t)
        for nm in notes:
            place(pad_tone(note(nm), length, 0.16), t, 1.0, 0.0)
        t += length

# 琶音
t = 0.0
idx = 0
step = BEAT / 2
while t < DUR - 0.1:
    chord = CHORDS[int(t // BAR) % 4]
    notes = [note(n) for n in chord[1]]
    p = notes[idx % len(notes)] + (12 if idx % 4 == 3 else 0)
    place(pluck(p, 0.16), t, 1.0, -0.25)
    idx += 1
    t += step

# 贝斯
t = 0.0
for rep in range(3):
    for name, notes, root in CHORDS:
        if t >= DUR:
            break
        length = min(BAR, DUR - t)
        place(bass_tone(note(root) - 12, length, 0.25), t, 1.0, 0.0)
        t += length

# 鼓
t = 0.0
while t < DUR - 0.1:
    place(kick(0.42), t, 1.0, 0.0)
    place(hat(0.05), t + BEAT / 2, 1.0, 0.3)
    t += BEAT

# 简易混响（梳状 + 全通）
def comb(x, delay, fb):
    d = int(delay * SR)
    y = np.zeros_like(x)
    for k in range(d, len(x)):
        y[k] = x[k] + fb * y[k - d]
    return y


def allpass(x, delay, g):
    d = int(delay * SR)
    y = np.zeros_like(x)
    for k in range(len(x)):
        v = x[k] + g * (y[k - d] if k >= d else 0)
        y[k] = -g * v + (x[k - d] if k >= d else 0)
    return y


wet = np.zeros_like(buf)
for ch in range(2):
    s = buf[:, ch]
    c = sum(comb(s, d, 0.72) for d in (0.029, 0.037, 0.041, 0.043)) / 4
    c = allpass(c, 0.005, 0.7)
    wet[:, ch] = c
mix = buf * 0.8 + wet * 0.22

# 淡入淡出 + 归一
fade = int(1.2 * SR)
mix[:fade] *= np.linspace(0, 1, fade)[:, None]
mix[-int(0.8 * SR):] *= np.linspace(1, 0, int(0.8 * SR))[:, None]
peak = np.max(np.abs(mix))
mix = mix / peak * 0.88

pcm = (mix * 32767).astype(np.int16)
with wave.open("docs/promo/video/code/music.wav", "w") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

write_midi("docs/promo/video/code/music.mid")
print("saved music.mid + music.wav")
