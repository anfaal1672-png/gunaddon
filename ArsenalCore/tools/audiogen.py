"""
ARSENAL CORE — 効果音の手続き合成
銃声・機構音・爆発・UI 音をすべて numpy/scipy で合成し、ffmpeg で OGG Vorbis に変換する。
（外部素材を一切使わないオリジナル音源。RP/sounds/arsenal/ 以下の同名 .ogg を差し替えれば好きな音に変えられる）
"""
import os
import subprocess
import tempfile
import wave
import numpy as np
from scipy import signal

SR = 44100


def _t(dur):
    return np.arange(int(SR * dur)) / SR


def env_exp(dur, tau, attack=0.0005):
    t = _t(dur)
    e = np.exp(-t / max(tau, 1e-4))
    if attack > 0:
        a = np.clip(t / attack, 0, 1)
        e = e * a
    return e


def noise(dur, rng):
    return rng.standard_normal(int(SR * dur))


def bandpass(x, lo, hi, order=2):
    lo = max(20, lo)
    hi = min(SR / 2 - 100, hi)
    sos = signal.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lowpass(x, f, order=2):
    sos = signal.butter(order, min(f, SR / 2 - 100), btype="low", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def highpass(x, f, order=2):
    sos = signal.butter(order, max(20, f), btype="high", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def sweep(dur, f0, f1, tau, rng=None, shape="sin"):
    t = _t(dur)
    f = f1 + (f0 - f1) * np.exp(-t / max(tau * 0.6, 1e-4))
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) if shape == "sin" else signal.sawtooth(ph)
    return fade_out(s * env_exp(dur, tau), min(0.04, dur * 0.3))


def pad(x, dur):
    n = int(SR * dur)
    if len(x) >= n:
        return x[:n]
    return np.concatenate([x, np.zeros(n - len(x))])


def mix(*parts, dur=None):
    n = max(len(p) for p in parts) if dur is None else int(SR * dur)
    out = np.zeros(n)
    for p in parts:
        m = min(len(p), n)
        out[:m] += p[:m]
    return out


def at(x, t0, total):
    out = np.zeros(int(SR * total))
    i = int(SR * t0)
    m = min(len(x), len(out) - i)
    if m > 0:
        out[i:i + m] += x[:m]
    return out


def reverb(x, decay=0.4, wet=0.25, rng=None, pre=0.012):
    rng = rng or np.random.default_rng(1)
    n = int(SR * decay * 1.5)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * decay / 4.0))
    ir = lowpass(ir, 3500)
    ir[: int(SR * pre)] = 0
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    y = signal.fftconvolve(x, ir)
    xx = np.concatenate([x, np.zeros(len(y) - len(x))])
    return xx * (1 - wet) + y * wet * 3.0


def soft_clip(x, drive=1.5):
    return np.tanh(x * drive) / np.tanh(drive)


def normalize(x, peak=0.92):
    m = np.max(np.abs(x)) + 1e-9
    return x / m * peak


def fade_out(x, dur=0.02):
    n = min(len(x), int(SR * dur))
    x = x.copy()
    x[-n:] *= np.linspace(1, 0, n)
    return x


def trim_silence(x, thr=0.0015):
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x
    return fade_out(x[: idx[-1] + int(SR * 0.01)], 0.01)


# ---------------------------------------------------------------------------
#  銃声
# ---------------------------------------------------------------------------
GUN_PROFILES = {
    #          body_tau crack  thump_f thump_amp  lp     tail   tail_amp  mech
    "pistol": (0.030, 0.55, 150, 0.8, 7000, 0.35, 0.18, 0.05),
    "magnum": (0.055, 0.60, 95, 1.2, 6000, 0.55, 0.28, 0.0),
    "smg": (0.022, 0.45, 170, 0.6, 8000, 0.25, 0.14, 0.035),
    "smg_heavy": (0.030, 0.5, 130, 0.8, 7000, 0.3, 0.18, 0.04),
    "rifle": (0.040, 0.8, 110, 0.9, 8500, 0.5, 0.22, 0.045),
    "rifle_heavy": (0.050, 0.85, 95, 1.0, 8000, 0.55, 0.25, 0.05),
    "battle": (0.060, 0.9, 85, 1.2, 8000, 0.7, 0.28, 0.06),
    "sniper": (0.085, 1.0, 70, 1.5, 9000, 1.1, 0.36, 0.0),
    "antimat": (0.14, 1.0, 48, 2.2, 7000, 1.6, 0.5, 0.0),
    "shotgun": (0.080, 0.5, 72, 1.6, 6000, 0.9, 0.34, 0.0),
    "lmg": (0.045, 0.8, 100, 1.0, 8000, 0.5, 0.24, 0.0),
    "lmg_heavy": (0.058, 0.9, 85, 1.2, 7500, 0.6, 0.28, 0.0),
    "rotary": (0.018, 0.5, 140, 0.7, 7000, 0.2, 0.12, 0.0),
    # 2.0
    "hmg": (0.075, 0.95, 62, 1.8, 7000, 0.9, 0.36, 0.0),
}


def gunshot(profile, seed, distant=False, indoor=False):
    rng = np.random.default_rng(seed)
    tau, crack, tf, ta, lp, tail, tail_amp, mech = GUN_PROFILES[profile]
    dur = 0.25 + tail * 1.2
    # 超音速クラック
    c = highpass(noise(0.006, rng), 2500) * env_exp(0.006, 0.0012) * crack
    # 本体の破裂音
    b = bandpass(noise(dur, rng), 90, lp) * env_exp(dur, tau, 0.0004)
    b2 = bandpass(noise(dur, rng), 400, 2500) * env_exp(dur, tau * 1.8, 0.001) * 0.35
    # 低音の衝撃
    th = sweep(0.25, tf * 2.2, tf, 0.025 + tau * 0.7) * ta
    # 残響テール
    tl = lowpass(noise(dur, rng), 1400) * env_exp(dur, tail * 0.28, 0.02) * tail_amp * 0.55
    s = mix(c, b, b2, th, tl, dur=dur)
    if mech > 0 and not distant:
        click = mech_click(rng, 3200 + rng.random() * 800, 0.012) * 0.25
        s = s + at(click, mech + 0.01, dur)
    s = soft_clip(s * 1.1, 1.3)
    if distant:
        s = lowpass(s, 900, 2) * 0.6 + lowpass(tl, 600) * 1.2
        s = reverb(s, decay=tail * 1.6 + 0.4, wet=0.55, rng=rng, pre=0.04)
    elif indoor:
        # 屋内：短く密な初期反射と、こもった残響
        s = reverb(s, decay=0.18 + tail * 0.25, wet=0.45, rng=rng, pre=0.004)
        s = mix(s, lowpass(s, 1800) * 0.35)
    else:
        s = reverb(s, decay=tail + 0.2, wet=0.1, rng=rng)
    return normalize(trim_silence(s))


def suppressed(seed, heavy=False):
    rng = np.random.default_rng(seed)
    dur = 0.35
    p = bandpass(noise(dur, rng), 300, 2600) * env_exp(dur, 0.028 if not heavy else 0.05)
    th = sweep(0.2, 260, 110, 0.04) * (0.5 if not heavy else 0.8)
    ck = mech_click(rng, 3000, 0.01) * 0.6
    s = mix(p, th, at(ck, 0.012, dur), at(mech_click(rng, 2400, 0.012) * 0.45, 0.05, dur), dur=dur)
    s = reverb(s, 0.25, 0.12, rng)
    return normalize(trim_silence(s), 0.8)


def mech_click(rng, freq, dur=0.02, decay=0.004):
    t = _t(dur)
    tr = highpass(noise(dur, rng), 1500) * env_exp(dur, 0.0008)
    ring = np.sin(2 * np.pi * freq * t) * env_exp(dur, decay) * 0.6
    ring2 = np.sin(2 * np.pi * freq * 1.63 * t) * env_exp(dur, decay * 0.7) * 0.3
    return fade_out(tr + ring + ring2, min(0.004, dur * 0.3))


def scrape(rng, dur, lo, hi, rate=40):
    n = bandpass(noise(dur, rng), lo, hi)
    t = _t(dur)
    am = 0.6 + 0.4 * np.sin(2 * np.pi * rate * t + rng.random() * 6)
    return n * am * np.hanning(len(t))


def launcher_thump(seed):
    rng = np.random.default_rng(seed)
    dur = 0.7
    th = sweep(0.4, 180, 55, 0.12) * 1.4
    pop = bandpass(noise(0.2, rng), 150, 1800) * env_exp(0.2, 0.03)
    tl = lowpass(noise(dur, rng), 700) * env_exp(dur, 0.18) * 0.3
    s = mix(th, pop, tl, at(mech_click(rng, 1800, 0.02) * 0.3, 0.02, dur), dur=dur)
    return normalize(trim_silence(reverb(soft_clip(s, 1.4), 0.5, 0.2, rng)))


def rocket_launch(seed):
    rng = np.random.default_rng(seed)
    dur = 1.6
    t = _t(dur)
    boom = sweep(0.5, 140, 45, 0.15) * 1.2
    wh = noise(dur, rng)
    cutoff = 600 + 3500 * np.exp(-t / 0.35)
    out = np.zeros_like(wh)
    # 可変カットオフ（区間ごとにフィルタ）
    seg = int(SR * 0.05)
    for i in range(0, len(wh), seg):
        fc = float(cutoff[min(i, len(cutoff) - 1)])
        out[i:i + seg] = lowpass(wh[max(0, i - 256):i + seg], fc)[-len(wh[i:i + seg]):]
    out = out * (np.clip(t / 0.03, 0, 1) * np.exp(-t / 0.6)) * 0.9
    s = mix(boom, out, dur=dur)
    return normalize(trim_silence(reverb(soft_clip(s, 1.3), 0.8, 0.25, rng)))


def energy_shot(seed, base=900, kind="pulse"):
    rng = np.random.default_rng(seed)
    if kind == "pulse":
        dur = 0.32
        t = _t(dur)
        f = base * 2.4 * np.exp(-t / 0.05) + base * 0.5
        ph = 2 * np.pi * np.cumsum(f) / SR
        s = (np.sin(ph) + 0.4 * signal.square(ph * 0.5)) * env_exp(dur, 0.07)
        s = mix(s, highpass(noise(dur, rng), 3000) * env_exp(dur, 0.01) * 0.3)
        s = mix(s, sweep(0.2, 220, 70, 0.04) * 0.5)
        return normalize(trim_silence(reverb(s, 0.3, 0.2, rng)))
    if kind == "arc":
        dur = 0.6
        t = _t(dur)
        buzz = signal.sawtooth(2 * np.pi * 110 * t) * 0.35 + signal.sawtooth(2 * np.pi * 173 * t) * 0.25
        imp = np.zeros_like(t)
        for _ in range(60):
            i = int(rng.random() * len(t) * 0.8)
            imp[i:i + 60] += rng.standard_normal(min(60, len(t) - i)) * rng.random()
        crackle = highpass(imp, 1500) * 1.4
        s = (buzz + crackle) * env_exp(dur, 0.18, 0.005)
        s = mix(s, sweep(0.3, 400, 90, 0.05) * 0.6)
        return normalize(trim_silence(reverb(s, 0.3, 0.2, rng)))
    if kind == "cryo":
        dur = 0.7
        t = _t(dur)
        s = np.zeros_like(t)
        for k, f in enumerate((2200, 2800, 3500, 4400)):
            s = mix(s, np.sin(2 * np.pi * f * t * (1 + 0.02 * np.sin(2 * np.pi * (5 + k) * t))) * env_exp(dur, 0.12 + k * 0.03, 0.002) * 0.25)
        s = mix(s, bandpass(noise(dur, rng), 3000, 9000) * env_exp(dur, 0.06) * 0.6)
        s = mix(s, sweep(0.25, 500, 180, 0.05) * 0.4)
        return normalize(trim_silence(reverb(s, 0.5, 0.3, rng)))
    if kind == "rail":
        dur = 1.4
        t = _t(dur)
        boom = sweep(0.6, 260, 40, 0.2) * 1.4
        zap = (np.sin(2 * np.pi * (3000 * np.exp(-t / 0.08) + 200) * t)) * env_exp(dur, 0.12) * 0.6
        crack = highpass(noise(0.02, rng), 2000) * env_exp(0.02, 0.003) * 1.2
        tail = lowpass(noise(dur, rng), 1200) * env_exp(dur, 0.35, 0.02) * 0.4
        s = mix(boom, zap, crack, tail, dur=dur)
        return normalize(trim_silence(reverb(soft_clip(s, 1.6), 1.2, 0.3, rng)))
    return np.zeros(100)


def grapple_shot(seed):
    rng = np.random.default_rng(seed)
    dur = 0.9
    t = _t(dur)
    twang = sweep(0.3, 900, 300, 0.06) * 0.7
    reel = bandpass(noise(dur, rng), 1500, 5000) * (0.5 + 0.5 * signal.square(2 * np.pi * 38 * t)) * env_exp(dur, 0.4, 0.05) * 0.4
    click = mech_click(rng, 2600, 0.02)
    s = mix(twang, reel, click, dur=dur)
    return normalize(trim_silence(s))


def flare_shot(seed):
    rng = np.random.default_rng(seed)
    dur = 1.2
    pop = mix(sweep(0.2, 400, 120, 0.03), bandpass(noise(0.1, rng), 300, 3000) * env_exp(0.1, 0.02))
    hiss = bandpass(noise(dur, rng), 2000, 8000) * env_exp(dur, 0.5, 0.05) * 0.35
    s = mix(pop, hiss, dur=dur)
    return normalize(trim_silence(reverb(s, 0.5, 0.2, rng)))


# ---------------------------------------------------------------------------
#  機構音
# ---------------------------------------------------------------------------
def mag_out(seed):
    rng = np.random.default_rng(seed)
    dur = 0.35
    s = at(mech_click(rng, 2100, 0.03, 0.006), 0.0, dur) + at(scrape(rng, 0.12, 800, 4000, 60) * 0.5, 0.03, dur)
    s = mix(s, at(mech_click(rng, 900, 0.05, 0.015) * 0.5, 0.16, dur))
    return normalize(trim_silence(s), 0.8)


def mag_in(seed):
    rng = np.random.default_rng(seed)
    dur = 0.35
    s = at(scrape(rng, 0.08, 800, 4000, 80) * 0.5, 0.0, dur)
    s = mix(s, at(mech_click(rng, 2400, 0.04, 0.008) * 1.2, 0.08, dur))
    s = mix(s, at(sweep(0.08, 300, 150, 0.02) * 0.4, 0.08, dur))
    return normalize(trim_silence(s), 0.85)


def bolt_back(seed):
    rng = np.random.default_rng(seed)
    dur = 0.3
    s = at(mech_click(rng, 3000, 0.02), 0, dur) + at(scrape(rng, 0.09, 1200, 6000, 90) * 0.6, 0.02, dur)
    s = mix(s, at(mech_click(rng, 2200, 0.03, 0.008) * 0.8, 0.12, dur))
    return normalize(trim_silence(s), 0.8)


def bolt_forward(seed):
    rng = np.random.default_rng(seed)
    dur = 0.3
    s = at(scrape(rng, 0.06, 1200, 6000, 90) * 0.5, 0, dur) + at(mech_click(rng, 2600, 0.04, 0.01) * 1.2, 0.06, dur)
    s = mix(s, at(sweep(0.06, 500, 200, 0.015) * 0.3, 0.06, dur))
    return normalize(trim_silence(s), 0.85)


def shell_insert(seed):
    rng = np.random.default_rng(seed)
    dur = 0.2
    s = at(scrape(rng, 0.05, 600, 3000, 50) * 0.4, 0, dur) + at(mech_click(rng, 1600, 0.04, 0.01), 0.05, dur)
    return normalize(trim_silence(s), 0.75)


def pump(seed):
    rng = np.random.default_rng(seed)
    dur = 0.45
    s = at(scrape(rng, 0.1, 500, 3500, 50) * 0.6, 0, dur) + at(mech_click(rng, 1400, 0.05, 0.012) * 1.2, 0.1, dur)
    s = mix(s, at(scrape(rng, 0.1, 500, 3500, 50) * 0.6, 0.2, dur) + at(mech_click(rng, 1900, 0.05, 0.012) * 1.3, 0.3, dur))
    return normalize(trim_silence(s), 0.9)


def break_open(seed):
    rng = np.random.default_rng(seed)
    dur = 0.4
    s = at(mech_click(rng, 1200, 0.06, 0.02) * 1.2, 0, dur) + at(scrape(rng, 0.12, 300, 2000, 30) * 0.5, 0.05, dur)
    s = mix(s, at(mech_click(rng, 3400, 0.02) * 0.4, 0.2, dur) + at(mech_click(rng, 3100, 0.02) * 0.4, 0.24, dur))
    return normalize(trim_silence(s), 0.85)


def break_close(seed):
    rng = np.random.default_rng(seed)
    dur = 0.3
    s = at(scrape(rng, 0.06, 300, 2000, 30) * 0.4, 0, dur) + at(mech_click(rng, 1100, 0.07, 0.025) * 1.4, 0.06, dur)
    return normalize(trim_silence(s), 0.9)


def cell_swap(seed, insert=True):
    rng = np.random.default_rng(seed)
    dur = 0.5
    t = _t(dur)
    whir = np.sin(2 * np.pi * (600 + (900 if insert else -300) * t) * t) * env_exp(dur, 0.2, 0.02) * 0.4
    s = whir + at(mech_click(rng, 2800, 0.03), 0.02 if insert else 0.0, dur)
    if insert:
        s = mix(s, at(np.sin(2 * np.pi * 1760 * _t(0.08)) * 0.3 * env_exp(0.08, 0.03), 0.3, dur))
        s = mix(s, at(np.sin(2 * np.pi * 2349 * _t(0.1)) * 0.3 * env_exp(0.1, 0.04), 0.38, dur))
    return normalize(trim_silence(s), 0.8)


def belt(seed):
    rng = np.random.default_rng(seed)
    dur = 0.8
    s = np.zeros(int(SR * dur))
    for i in range(10):
        s = mix(s, at(mech_click(rng, 3000 + rng.random() * 1500, 0.02, 0.003) * (0.3 + rng.random() * 0.4), 0.05 + i * 0.05, dur))
    s = mix(s, at(mech_click(rng, 1200, 0.06, 0.02), 0.62, dur))
    return normalize(trim_silence(s), 0.8)


def heavy_load(seed):
    rng = np.random.default_rng(seed)
    dur = 0.6
    s = at(scrape(rng, 0.25, 200, 1500, 20) * 0.6, 0, dur) + at(mech_click(rng, 700, 0.1, 0.04) * 1.5, 0.28, dur)
    s = mix(s, at(sweep(0.15, 180, 80, 0.04) * 0.6, 0.28, dur))
    return normalize(trim_silence(s), 0.9)


def revolver_spin(seed):
    rng = np.random.default_rng(seed)
    dur = 0.6
    s = np.zeros(int(SR * dur))
    for i in range(12):
        s = mix(s, at(mech_click(rng, 4200, 0.01, 0.002) * (0.6 - i * 0.04), i * 0.035, dur))
    s = mix(s, at(mech_click(rng, 1500, 0.05, 0.015), 0.46, dur))
    return normalize(trim_silence(s), 0.8)


def dry_fire(seed):
    rng = np.random.default_rng(seed)
    return normalize(trim_silence(mech_click(rng, 3600, 0.05, 0.006)), 0.7)


def mode_switch(seed):
    rng = np.random.default_rng(seed)
    s = mix(mech_click(rng, 4000, 0.03, 0.004), at(mech_click(rng, 3000, 0.03, 0.004) * 0.7, 0.05, 0.1))
    return normalize(trim_silence(s), 0.7)


def equip(seed):
    rng = np.random.default_rng(seed)
    dur = 0.4
    s = at(scrape(rng, 0.15, 400, 3000, 30) * 0.4, 0, dur) + at(mech_click(rng, 2000, 0.05, 0.01) * 0.7, 0.14, dur)
    return normalize(trim_silence(s), 0.6)


def jam(seed):
    rng = np.random.default_rng(seed)
    dur = 0.4
    s = at(mech_click(rng, 900, 0.1, 0.02) * 1.2, 0, dur) + at(scrape(rng, 0.2, 300, 1500, 12) * 0.6, 0.05, dur)
    return normalize(trim_silence(s), 0.8)


# ---------------------------------------------------------------------------
#  フィードバック・UI
# ---------------------------------------------------------------------------
def tone(freqs, dur, tau, amp=0.5, shape="sin"):
    t = _t(dur)
    s = np.zeros_like(t)
    for f in freqs:
        s = mix(s, (np.sin(2 * np.pi * f * t) if shape == "sin" else signal.square(2 * np.pi * f * t) * 0.4))
    return s * env_exp(dur, tau, 0.002) * amp / len(freqs)


def hitmarker(seed):
    rng = np.random.default_rng(seed)
    s = mix(highpass(noise(0.015, rng), 3000) * env_exp(0.015, 0.003), tone([2600], 0.06, 0.015, 0.6))
    return normalize(trim_silence(s), 0.7)


def headshot(seed):
    s = mix(tone([1800, 2700, 4050], 0.35, 0.09, 1.0), tone([900], 0.05, 0.01, 0.4))
    return normalize(trim_silence(s), 0.75)


def killconfirm(seed):
    s = mix(tone([1320], 0.12, 0.05, 0.8), at(tone([1980], 0.2, 0.08, 0.8), 0.08, 0.35))
    return normalize(trim_silence(s), 0.75)


def beep(freq, dur=0.08):
    return normalize(tone([freq], dur, dur * 0.8, 1.0, "square"), 0.5)


def lock_on():
    s = mix(tone([1600], 0.4, 1.0, 1.0, "square"))
    return normalize(fade_out(s, 0.03), 0.5)


def charge_hum():
    dur = 1.5
    t = _t(dur)
    f = 200 + 900 * (t / dur) ** 1.5
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = (np.sin(ph) + 0.3 * np.sin(ph * 2.01)) * np.clip(t / 0.1, 0, 1) * 0.6
    return normalize(fade_out(s, 0.05), 0.6)


def heat_vent(seed):
    rng = np.random.default_rng(seed)
    dur = 0.9
    s = bandpass(noise(dur, rng), 1500, 9000) * env_exp(dur, 0.3, 0.02)
    return normalize(trim_silence(s), 0.7)


def overheat(seed):
    s = mix(tone([880, 890], 0.15, 0.1, 1.0, "square"), at(tone([660, 668], 0.2, 0.12, 1.0, "square"), 0.16, 0.4))
    return normalize(trim_silence(s), 0.6)


def explosion(seed, distant=False):
    rng = np.random.default_rng(seed)
    dur = 2.4 if not distant else 3.0
    t = _t(dur)
    boom = sweep(1.0, 120, 32, 0.35) * 2.0
    body = lowpass(noise(dur, rng), 2500) * env_exp(dur, 0.35, 0.002) * 1.2
    crack = highpass(noise(0.03, rng), 1500) * env_exp(0.03, 0.006) * 1.2
    debris = np.zeros_like(t)
    for _ in range(40):
        i = int((0.1 + rng.random() * 1.2) * SR)
        c = mech_click(rng, 800 + rng.random() * 2500, 0.03, 0.005) * rng.random() * 0.15
        debris[i:i + len(c)] += c[: len(debris) - i]
    s = mix(boom, body, crack, debris, dur=dur)
    s = soft_clip(s, 2.2)
    if distant:
        s = lowpass(s, 500, 2)
        s = reverb(s, 2.0, 0.6, rng, 0.08)
    else:
        s = reverb(s, 1.2, 0.3, rng)
    return normalize(trim_silence(s))


def grenade_pin(seed):
    rng = np.random.default_rng(seed)
    s = mix(mech_click(rng, 4500, 0.04, 0.012), at(tone([5200, 7800], 0.25, 0.08, 0.5), 0.02, 0.3))
    return normalize(trim_silence(s), 0.7)


def bounce(seed):
    rng = np.random.default_rng(seed)
    s = mix(mech_click(rng, 1400 + rng.random() * 400, 0.08, 0.02), sweep(0.05, 260, 120, 0.015) * 0.4)
    return normalize(trim_silence(s), 0.7)


def flash_ring():
    dur = 4.0
    t = _t(dur)
    s = np.sin(2 * np.pi * 5200 * t) * 0.6 + np.sin(2 * np.pi * 5210 * t) * 0.4
    s *= np.clip(t / 0.05, 0, 1) * np.exp(-t / 1.6)
    return normalize(s, 0.45)


def flash_bang(seed):
    rng = np.random.default_rng(seed)
    dur = 1.2
    s = mix(highpass(noise(dur, rng), 800) * env_exp(dur, 0.08) * 1.4, sweep(0.5, 200, 60, 0.12) * 1.2)
    return normalize(trim_silence(reverb(soft_clip(s, 2.0), 0.9, 0.3, rng)))


def smoke_hiss(seed):
    rng = np.random.default_rng(seed)
    dur = 3.0
    t = _t(dur)
    s = bandpass(noise(dur, rng), 1500, 7000) * (np.clip(t / 0.1, 0, 1) * np.exp(-t / 1.4))
    return normalize(s, 0.6)


def glass_break(seed):
    rng = np.random.default_rng(seed)
    dur = 0.8
    s = highpass(noise(dur, rng), 3000) * env_exp(dur, 0.04)
    for _ in range(25):
        s = mix(s, at(tone([3000 + rng.random() * 5000], 0.1, 0.03, rng.random() * 0.5), rng.random() * 0.4, dur))
    return normalize(trim_silence(s), 0.8)


def fire_whoosh(seed):
    rng = np.random.default_rng(seed)
    dur = 1.4
    t = _t(dur)
    s = lowpass(noise(dur, rng), 1200) * (np.clip(t / 0.15, 0, 1) * np.exp(-t / 0.5)) * 1.2
    cr = np.zeros_like(t)
    for _ in range(80):
        i = int(rng.random() * len(t) * 0.9)
        cr[i:i + 40] += rng.standard_normal(min(40, len(t) - i)) * rng.random() * 0.3
    return normalize(trim_silence(s + highpass(cr, 2000)), 0.8)


def impact_block(seed):
    rng = np.random.default_rng(seed)
    s = mix(bandpass(noise(0.12, rng), 300, 4000) * env_exp(0.12, 0.015), sweep(0.08, 400, 150, 0.02) * 0.4)
    return normalize(trim_silence(s), 0.7)


def impact_flesh(seed):
    rng = np.random.default_rng(seed)
    s = mix(lowpass(noise(0.12, rng), 1200) * env_exp(0.12, 0.02), sweep(0.1, 180, 80, 0.03) * 0.6)
    return normalize(trim_silence(s), 0.7)


def ricochet(seed):
    rng = np.random.default_rng(seed)
    dur = 0.6
    t = _t(dur)
    f0 = 3500 + rng.random() * 1500
    f = f0 * np.exp(-t / 0.5)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * env_exp(dur, 0.18, 0.004) * 0.6
    s = mix(s, highpass(noise(0.02, rng), 2000) * env_exp(0.02, 0.003))
    return normalize(trim_silence(s), 0.6)


def whizz(seed):
    rng = np.random.default_rng(seed)
    dur = 0.25
    t = _t(dur)
    env = np.exp(-((t - 0.08) ** 2) / (2 * 0.03 ** 2))
    s = bandpass(noise(dur, rng), 1500, 6000) * env
    s = mix(s, np.sin(2 * np.pi * (1800 - 1200 * t / dur) * t) * env * 0.3)
    return normalize(trim_silence(s), 0.6)


def casing(seed):
    rng = np.random.default_rng(seed)
    dur = 0.4
    s = at(tone([5200 + rng.random() * 800, 7600], 0.08, 0.02, 0.6), 0, dur)
    s = mix(s, at(tone([4800, 7000], 0.06, 0.015, 0.35), 0.11, dur) + at(tone([4600], 0.05, 0.01, 0.2), 0.19, dur))
    return normalize(trim_silence(s), 0.45)


def breath(seed, inhale=True):
    rng = np.random.default_rng(seed)
    dur = 0.8
    t = _t(dur)
    e = np.sin(np.pi * t / dur) ** 2
    s = bandpass(noise(dur, rng), 500 if inhale else 300, 3000 if inhale else 1800) * e * 0.5
    return normalize(s, 0.4)


def craft(seed):
    rng = np.random.default_rng(seed)
    dur = 0.7
    s = np.zeros(int(SR * dur))
    for i, f in enumerate((1800, 2400, 1500, 2900)):
        s = mix(s, at(mech_click(rng, f, 0.05, 0.012), i * 0.12, dur))
    s = mix(s, at(tone([1046, 1568], 0.3, 0.12, 0.5), 0.45, dur))
    return normalize(trim_silence(s), 0.75)


def repair(seed):
    rng = np.random.default_rng(seed)
    dur = 0.8
    s = np.zeros(int(SR * dur))
    for i in range(4):
        s = mix(s, at(mech_click(rng, 1200 + i * 150, 0.06, 0.02), i * 0.15, dur))
    return normalize(trim_silence(s), 0.75)


def c4_beep():
    return beep(2100, 0.06)


def mine_arm():
    s = mix(tone([1200], 0.08, 0.05, 1, "square"), at(tone([1800], 0.1, 0.06, 1, "square"), 0.1, 0.25))
    return normalize(trim_silence(s), 0.5)


def spin(seed, up=True):
    rng = np.random.default_rng(seed)
    dur = 0.8
    t = _t(dur)
    f = (80 + 260 * (t / dur)) if up else (340 - 260 * (t / dur))
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = signal.sawtooth(ph) * 0.3 + bandpass(noise(dur, rng), 800, 3000) * 0.15 * (t / dur if up else 1 - t / dur)
    s *= np.clip(t / 0.05, 0, 1) * (1 if up else np.exp(-t / 0.4))
    return normalize(fade_out(s, 0.05), 0.55)


# ---------------------------------------------------------------------------
#  2.0：新しい射撃音・近接・防具・乗り物・ボス・UI
# ---------------------------------------------------------------------------
def flamer_burst(seed):
    rng = np.random.default_rng(seed)
    dur = 0.9
    t = _t(dur)
    roar = lowpass(noise(dur, rng), 900) * (np.clip(t / 0.06, 0, 1) * np.exp(-t / 0.55))
    crackle = np.zeros_like(t)
    for _ in range(50):
        i = int(rng.random() * len(t) * 0.9)
        crackle[i:i + 30] += rng.standard_normal(min(30, len(t) - i)) * rng.random() * 0.4
    hiss = bandpass(noise(dur, rng), 1500, 5000) * np.exp(-t / 0.4) * 0.25
    s = mix(roar * 1.2, highpass(crackle, 1500), hiss, sweep(0.2, 120, 60, 0.08) * 0.4, dur=dur)
    return normalize(trim_silence(s), 0.85)


def beam_hum(seed):
    rng = np.random.default_rng(seed)
    dur = 0.6
    t = _t(dur)
    f = 330 + 30 * np.sin(2 * np.pi * 7 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = (np.sin(ph) * 0.5 + signal.sawtooth(ph * 2) * 0.2 + bandpass(noise(dur, rng), 2500, 7000) * 0.15)
    s *= np.clip(t / 0.04, 0, 1) * np.clip((dur - t) / 0.08, 0, 1)
    return normalize(s, 0.7)


def gravity_warp(seed):
    rng = np.random.default_rng(seed)
    dur = 0.9
    t = _t(dur)
    f = 60 + 500 * np.exp(-t / 0.25)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * env_exp(dur, 0.35, 0.003) + np.sin(ph * 1.5) * env_exp(dur, 0.2) * 0.4
    s = mix(s, lowpass(noise(dur, rng), 400) * env_exp(dur, 0.3) * 0.6)
    return normalize(trim_silence(reverb(s, 0.6, 0.3, rng)))


def plasma_bolt(seed):
    rng = np.random.default_rng(seed)
    dur = 0.4
    t = _t(dur)
    f = 220 + 900 * np.exp(-t / 0.04)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = (np.sin(ph) + 0.5 * np.sin(ph * 2.01)) * env_exp(dur, 0.09)
    s = mix(s, lowpass(noise(dur, rng), 1200) * env_exp(dur, 0.05) * 0.5)
    return normalize(trim_silence(reverb(s, 0.3, 0.2, rng)))


def needle_tick(seed):
    rng = np.random.default_rng(seed)
    dur = 0.3
    t = _t(dur)
    s = np.sin(2 * np.pi * 4200 * t) * env_exp(dur, 0.015) * 0.6 + np.sin(2 * np.pi * 6100 * t) * env_exp(dur, 0.01) * 0.3
    s = mix(s, highpass(noise(dur, rng), 3000) * env_exp(dur, 0.006) * 0.6, sweep(0.2, 1800, 600, 0.05) * 0.3)
    return normalize(trim_silence(s), 0.75)


def sonic_thump(seed):
    rng = np.random.default_rng(seed)
    dur = 0.8
    s = mix(sweep(0.6, 90, 30, 0.2) * 1.6, lowpass(noise(dur, rng), 300) * env_exp(dur, 0.12) * 0.8,
            sweep(0.3, 900, 200, 0.05) * 0.2, dur=dur)
    return normalize(trim_silence(reverb(soft_clip(s, 1.5), 0.5, 0.2, rng)))


def mortar_thunk(seed):
    rng = np.random.default_rng(seed)
    dur = 0.9
    s = mix(sweep(0.4, 200, 70, 0.08) * 1.2, bandpass(noise(0.3, rng), 150, 1500) * env_exp(0.3, 0.05), at(mech_click(rng, 800, 0.05, 0.02), 0.0, dur), dur=dur)
    return normalize(trim_silence(reverb(soft_clip(s, 1.3), 0.7, 0.3, rng)))


def swing(seed, heavy=False):
    rng = np.random.default_rng(seed)
    dur = 0.35 if not heavy else 0.5
    t = _t(dur)
    e = np.exp(-((t - dur * 0.4) ** 2) / (2 * (dur * 0.15) ** 2))
    s = bandpass(noise(dur, rng), 400 if heavy else 800, 3000 if heavy else 5000) * e
    return normalize(s, 0.55)


def melee_hit(seed, metal=False):
    rng = np.random.default_rng(seed)
    dur = 0.3
    s = mix(lowpass(noise(dur, rng), 1500) * env_exp(dur, 0.03), sweep(0.15, 160, 60, 0.04) * 0.8)
    if metal:
        s = mix(s, tone([2300, 3400], 0.25, 0.05, 0.4))
    return normalize(trim_silence(s), 0.8)


def zap(seed):
    rng = np.random.default_rng(seed)
    dur = 0.35
    t = _t(dur)
    s = (signal.square(2 * np.pi * 120 * t) * 0.3 + highpass(noise(dur, rng), 2000) * 0.5) * env_exp(dur, 0.1, 0.002)
    return normalize(trim_silence(s), 0.7)


def plate_hit(seed, broken=False):
    rng = np.random.default_rng(seed)
    dur = 0.45 if broken else 0.25
    s = mix(highpass(noise(dur, rng), 1800) * env_exp(dur, 0.04 if not broken else 0.12), tone([1900, 2700, 3900], dur, 0.05, 0.35))
    if broken:
        for k in range(6):
            s = mix(s, at(highpass(noise(0.03, rng), 3000) * env_exp(0.03, 0.006) * 0.5, 0.05 + k * 0.04, dur))
    return normalize(trim_silence(s), 0.8)


def velcro(seed):
    rng = np.random.default_rng(seed)
    dur = 0.5
    t = _t(dur)
    s = bandpass(noise(dur, rng), 1500, 7000) * (0.5 + 0.5 * signal.square(2 * np.pi * 90 * t)) * np.hanning(len(t))
    return normalize(mix(s, at(mech_click(rng, 1600, 0.04, 0.01), 0.42, dur)), 0.6)


def engine(seed, rev=False):
    rng = np.random.default_rng(seed)
    dur = 1.0
    t = _t(dur)
    f = 38 + (30 * t / dur if rev else 0) + 3 * np.sin(2 * np.pi * 3 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = signal.sawtooth(ph) * 0.5 + signal.sawtooth(ph * 2) * 0.25 + lowpass(noise(dur, rng), 500) * 0.3
    s = lowpass(s, 900)
    return normalize(s * np.clip(t / 0.05, 0, 1) * np.clip((dur - t) / 0.05, 0, 1), 0.7)


def growl(seed, pitch=1.0, dur=1.3):
    """ボスの声：鋸歯状波の声帯＋フォルマント帯域"""
    rng = np.random.default_rng(seed)
    t = _t(dur)
    f0 = (95 + 25 * np.sin(2 * np.pi * 2.5 * t) + rng.standard_normal(len(t)) * 3) * pitch
    ph = 2 * np.pi * np.cumsum(f0) / SR
    src = signal.sawtooth(ph) + 0.3 * noise(dur, rng)
    s = bandpass(src, 300, 900) * 0.8 + bandpass(src, 1100, 2400) * 0.4 + lowpass(src, 250) * 0.6
    s *= np.clip(t / 0.08, 0, 1) * np.clip((dur - t) / 0.3, 0, 1)
    return normalize(trim_silence(reverb(soft_clip(s, 1.8), 0.6, 0.3, rng)), 0.9)


def servo(seed):
    rng = np.random.default_rng(seed)
    dur = 0.6
    t = _t(dur)
    f = 400 + 300 * np.sin(np.pi * t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = (signal.square(ph) * 0.2 + bandpass(noise(dur, rng), 1000, 4000) * 0.2) * np.hanning(len(t))
    return normalize(s, 0.6)


def whine(rise=True, dur=1.2):
    t = _t(dur)
    f = (300 + 2500 * (t / dur) ** 2) if rise else (2800 - 2500 * (t / dur))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return normalize(np.sin(ph) * 0.5 * np.clip(t / 0.05, 0, 1) * np.clip((dur - t) / 0.05, 0, 1), 0.6)


def jet_flyby(seed):
    rng = np.random.default_rng(seed)
    dur = 2.4
    t = _t(dur)
    e = np.exp(-((t - 1.1) ** 2) / (2 * 0.35 ** 2))
    s = lowpass(noise(dur, rng), 1500) * e + bandpass(noise(dur, rng), 2000, 6000) * e * 0.4
    return normalize(s, 0.85)


def whistle_fall(dur=1.2):
    t = _t(dur)
    f = 1800 - 1100 * (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return normalize(np.sin(ph) * 0.4 * np.clip(t / 0.05, 0, 1), 0.5)


def klaxon():
    dur = 1.4
    t = _t(dur)
    f = np.where((t * 2.5) % 1 < 0.5, 540, 420)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = signal.square(ph) * 0.3
    return normalize(lowpass(s, 2200) * np.clip((dur - t) / 0.1, 0, 1), 0.6)


def horn(seed):
    rng = np.random.default_rng(seed)
    dur = 1.6
    t = _t(dur)
    ph = 2 * np.pi * 110 * t
    s = (signal.sawtooth(ph) + 0.6 * signal.sawtooth(ph * 1.5)) * np.clip(t / 0.1, 0, 1) * np.clip((dur - t) / 0.3, 0, 1)
    return normalize(trim_silence(reverb(lowpass(s, 1400), 0.9, 0.35, rng)), 0.8)


def arpeggio(freqs, step=0.08, tau=0.12):
    dur = step * len(freqs) + 0.4
    s = np.zeros(int(SR * dur))
    for i, f in enumerate(freqs):
        s = mix(s, at(tone([f, f * 2], 0.4, tau, 0.5), i * step, dur))
    return normalize(trim_silence(s), 0.7)


def coin():
    return arpeggio([1318, 1976], 0.06, 0.08)


def radio(seed):
    rng = np.random.default_rng(seed)
    dur = 0.5
    s = mix(bandpass(noise(0.25, rng), 800, 3500) * env_exp(0.25, 0.06), at(tone([1500], 0.08, 0.05, 0.4, "square"), 0.2, dur), at(tone([1000], 0.08, 0.05, 0.4, "square"), 0.3, dur), dur=dur)
    return normalize(trim_silence(s), 0.6)


def heartbeat():
    dur = 1.0
    s = mix(at(sweep(0.12, 90, 50, 0.04), 0.0, dur), at(sweep(0.12, 80, 45, 0.04) * 0.7, 0.22, dur))
    return normalize(trim_silence(s), 0.7)


def sonar():
    dur = 1.2
    t = _t(dur)
    s = np.sin(2 * np.pi * 1400 * t) * env_exp(dur, 0.25, 0.003) * 0.6
    return normalize(s, 0.6)


def buzz_loop(seed):
    rng = np.random.default_rng(seed)
    dur = 0.8
    t = _t(dur)
    s = (signal.sawtooth(2 * np.pi * 180 * t) * 0.3 + signal.sawtooth(2 * np.pi * 183 * t) * 0.3 + bandpass(noise(dur, rng), 1500, 4000) * 0.1)
    return normalize(lowpass(s, 2500) * np.clip(t / 0.05, 0, 1) * np.clip((dur - t) / 0.05, 0, 1), 0.5)


# ---------------------------------------------------------------------------
#  書き出し
# ---------------------------------------------------------------------------
def _write_wav(path, x):
    x = np.clip(x, -1, 1)
    data = (x * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def write_ogg(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        tmp = tf.name
    _write_wav(tmp, x)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-ar", str(SR), "-c:a", "libvorbis", "-q:a", "4", path], check=True)
    os.remove(tmp)


def _sh(s):
    return sum(ord(c) * (i + 1) for i, c in enumerate(s)) % 997


def catalog():
    """(相対パス（拡張子なし）, 生成関数) の一覧"""
    items = []
    for prof in GUN_PROFILES:
        for v in range(3):
            items.append((f"fire/{prof}_{v + 1}", (lambda p=prof, v=v: gunshot(p, 1000 + v * 17 + _sh(p)))))
        items.append((f"fire/{prof}_far", (lambda p=prof: gunshot(p, 4242 + _sh(p), distant=True))))
    for v in range(3):
        items.append((f"fire/suppressed_{v + 1}", (lambda v=v: suppressed(300 + v))))
        items.append((f"fire/suppressed_heavy_{v + 1}", (lambda v=v: suppressed(400 + v, True))))
    for v in range(2):
        items.append((f"fire/launcher_{v + 1}", (lambda v=v: launcher_thump(50 + v))))
        items.append((f"fire/rocket_{v + 1}", (lambda v=v: rocket_launch(60 + v))))
        items.append((f"fire/energy_{v + 1}", (lambda v=v: energy_shot(70 + v, 900 + v * 90, "pulse"))))
        items.append((f"fire/arc_{v + 1}", (lambda v=v: energy_shot(80 + v, 0, "arc"))))
        items.append((f"fire/cryo_{v + 1}", (lambda v=v: energy_shot(90 + v, 0, "cryo"))))
    items.append(("fire/rail_1", lambda: energy_shot(95, 0, "rail")))
    items.append(("fire/grapple_1", lambda: grapple_shot(96)))
    items.append(("fire/flare_1", lambda: flare_shot(97)))
    mech = {
        "mech/mag_out": mag_out, "mech/mag_in": mag_in, "mech/bolt_back": bolt_back, "mech/bolt_forward": bolt_forward,
        "mech/shell_insert": shell_insert, "mech/pump": pump, "mech/break_open": break_open, "mech/break_close": break_close,
        "mech/belt": belt, "mech/heavy_load": heavy_load, "mech/revolver_spin": revolver_spin, "mech/dry_fire": dry_fire,
        "mech/mode_switch": mode_switch, "mech/equip": equip, "mech/jam": jam,
    }
    for k, fn in mech.items():
        for v in range(2):
            items.append((f"{k}_{v + 1}", (lambda fn=fn, v=v: fn(500 + v * 31 + len(k)))))
    items.append(("mech/cell_out_1", lambda: cell_swap(1, False)))
    items.append(("mech/cell_in_1", lambda: cell_swap(2, True)))
    fx = {
        "fx/hit_1": lambda: hitmarker(1), "fx/hit_2": lambda: hitmarker(2),
        "fx/headshot_1": lambda: headshot(1), "fx/kill_1": lambda: killconfirm(1),
        "fx/lock_beep_1": lambda: beep(1200), "fx/lock_on_1": lock_on, "fx/charge_1": charge_hum,
        "fx/heat_vent_1": lambda: heat_vent(1), "fx/overheat_1": lambda: overheat(1),
        "fx/explosion_1": lambda: explosion(1), "fx/explosion_2": lambda: explosion(2),
        "fx/explosion_far_1": lambda: explosion(3, True),
        "fx/grenade_pin_1": lambda: grenade_pin(1), "fx/bounce_1": lambda: bounce(1), "fx/bounce_2": lambda: bounce(2),
        "fx/flash_bang_1": lambda: flash_bang(1), "fx/flash_ring_1": flash_ring, "fx/smoke_1": lambda: smoke_hiss(1),
        "fx/glass_1": lambda: glass_break(1), "fx/fire_1": lambda: fire_whoosh(1),
        "fx/impact_block_1": lambda: impact_block(1), "fx/impact_block_2": lambda: impact_block(2), "fx/impact_block_3": lambda: impact_block(3),
        "fx/impact_flesh_1": lambda: impact_flesh(1), "fx/impact_flesh_2": lambda: impact_flesh(2),
        "fx/ricochet_1": lambda: ricochet(1), "fx/ricochet_2": lambda: ricochet(2), "fx/ricochet_3": lambda: ricochet(3),
        "fx/whizz_1": lambda: whizz(1), "fx/whizz_2": lambda: whizz(2),
        "fx/casing_1": lambda: casing(1), "fx/casing_2": lambda: casing(2), "fx/casing_3": lambda: casing(3),
        "fx/breath_in_1": lambda: breath(1, True), "fx/breath_out_1": lambda: breath(2, False),
        "fx/craft_1": lambda: craft(1), "fx/repair_1": lambda: repair(1),
        "fx/c4_beep_1": c4_beep, "fx/mine_arm_1": mine_arm,
        "fx/spin_up_1": lambda: spin(1, True), "fx/spin_down_1": lambda: spin(2, False),
    }
    items.extend(fx.items())
    # ---- 2.0 ----
    for prof in GUN_PROFILES:
        items.append((f"fire/{prof}_in_1", (lambda p=prof: gunshot(p, 2000 + _sh(p), indoor=True))))
    new_fire = {
        "fire/flamer": lambda v: flamer_burst(610 + v), "fire/beam": lambda v: beam_hum(620 + v), "fire/gravity": lambda v: gravity_warp(630 + v),
        "fire/plasma": lambda v: plasma_bolt(640 + v), "fire/needle": lambda v: needle_tick(650 + v), "fire/sonic": lambda v: sonic_thump(660 + v),
        "fire/mortar": lambda v: mortar_thunk(670 + v),
    }
    for k, fn in new_fire.items():
        for v in range(2):
            items.append((f"{k}_{v + 1}", (lambda fn=fn, v=v: fn(v))))
    fx2 = {
        "melee/swing_1": lambda: swing(1), "melee/swing_2": lambda: swing(2), "melee/swing_heavy_1": lambda: swing(3, True),
        "melee/hit_1": lambda: melee_hit(1), "melee/hit_2": lambda: melee_hit(2), "melee/hit_metal_1": lambda: melee_hit(3, True),
        "melee/zap_1": lambda: zap(1), "melee/throw_1": lambda: swing(4),
        "armor/plate_hit_1": lambda: plate_hit(1), "armor/plate_hit_2": lambda: plate_hit(2), "armor/plate_break_1": lambda: plate_hit(3, True),
        "armor/plate_insert_1": lambda: velcro(1), "armor/helmet_ping_1": lambda: melee_hit(4, True),
        "vehicle/engine_1": lambda: engine(1), "vehicle/engine_rev_1": lambda: engine(2, True), "vehicle/horn_1": lambda: horn(3),
        "boss/warlord_roar_1": lambda: growl(1, 1.0), "boss/warlord_roar_2": lambda: growl(2, 0.9, 1.0),
        "boss/juggernaut_roar_1": lambda: growl(3, 0.6, 1.6), "boss/servo_1": lambda: servo(1), "boss/servo_2": lambda: servo(2),
        "boss/stomp_1": lambda: sonic_thump(700), "boss/emp_charge_1": lambda: whine(True, 1.6), "boss/emp_blast_1": lambda: zap(9),
        "ui/buy_1": coin, "ui/sell_1": lambda: arpeggio([1976, 1318], 0.06, 0.08), "ui/levelup_1": lambda: arpeggio([523, 659, 784, 1046], 0.09, 0.15),
        "ui/rankup_1": lambda: arpeggio([392, 523, 659, 784, 1046, 1318], 0.08, 0.18), "ui/challenge_1": lambda: arpeggio([659, 784, 1175], 0.1, 0.2),
        "ui/streak_ready_1": lambda: arpeggio([880, 1320], 0.07, 0.1), "ui/radio_1": lambda: radio(1), "ui/radio_2": lambda: radio(2),
        "ui/error_1": lambda: arpeggio([300, 220], 0.08, 0.06),
        "world/jet_1": lambda: jet_flyby(1), "world/drop_whistle_1": lambda: whistle_fall(1.4), "world/klaxon_1": klaxon, "world/wave_horn_1": lambda: horn(7),
        "world/gunship_1": lambda: engine(8, True), "world/drone_1": lambda: buzz_loop(1), "world/sonar_1": sonar,
        "gear/heal_1": lambda: velcro(5), "gear/adrenaline_1": heartbeat, "gear/defib_1": lambda: zap(5), "gear/emp_1": lambda: zap(6),
        "gear/deploy_1": lambda: repair(7), "gear/beep_1": lambda: beep(1600, 0.07), "gear/claymore_1": lambda: mine_arm(),
    }
    items.extend(fx2.items())
    return items


def generate(out_dir, log=print):
    items = catalog()
    for rel, fn in items:
        x = fn()
        write_ogg(os.path.join(out_dir, rel + ".ogg"), x)
    log(f"  sounds: {len(items)} files")
    return [rel for rel, _ in items]
