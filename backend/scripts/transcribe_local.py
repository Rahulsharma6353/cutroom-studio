"""Local speech-to-text (no API key): sherpa-onnx Whisper, run per chunk of <= 7 s split at pauses
and energy dips; word times spread across each chunk by length and snapped to energy dips.
Usage: transcribe_local.py <media> <whisperModelDir> <out.json|-> [language]"""
import json, re, subprocess, sys, wave, os
import numpy as np
import sherpa_onnx

src, model_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
lang = sys.argv[4] if len(sys.argv) > 4 else "en"
import tempfile
wav = tempfile.mktemp(suffix=".wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-ac", "1", "-ar", "16000", "-f", "wav", wav], check=True)
with wave.open(wav) as w:
    pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
SR = 16000
dur = len(pcm) / SR
hop = 160
e = np.array([20 * np.log10(np.sqrt(np.mean(pcm[i:i + 320] ** 2)) + 1e-9) for i in range(0, len(pcm) - 320, hop)])
s = np.convolve(e, np.ones(7) / 7, "same")
floor = np.percentile(s, 12)
speech = s > floor + 9

# pauses: runs of non-speech >= 0.28 s
pauses, i = [], 0
while i < len(speech):
    if not speech[i]:
        j = i
        while j < len(speech) and not speech[j]:
            j += 1
        if (j - i) * 0.01 >= 0.28:
            pauses.append((i * 0.01, j * 0.01))
        i = j
    else:
        i += 1

# local minima for splitting long runs
dips = [k * 0.01 for k in range(5, len(s) - 5) if s[k] == s[k - 5:k + 6].min()]

# chunk boundaries: pauses, then split anything longer than 7 s at the deepest dip near the middle
bounds = [0.0] + [round((a + b) / 2, 2) for a, b in pauses if 0.3 < (a + b) / 2 < dur - 0.3] + [dur]
chunks = []
for a, b in zip(bounds, bounds[1:]):
    stack = [(a, b)]
    while stack:
        x, y = stack.pop(0)
        if y - x <= 7:
            chunks.append((x, y)); continue
        cand = [d for d in dips if x + 2 < d < y - 2]
        m = min(cand, key=lambda d: s[int(d * 100)]) if cand else (x + y) / 2
        stack[0:0] = [(x, m), (m, y)]

files = os.listdir(model_dir)
pick = lambda key: model_dir + "/" + sorted(f for f in files if key in f and f.endswith(".onnx") and "int8" in f)[0]
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=pick("encoder"), decoder=pick("decoder"),
    tokens=model_dir + "/" + [f for f in files if f.endswith("tokens.txt")][0], language=lang, task="transcribe", num_threads=int(os.environ.get("WHISPER_THREADS", "4")))

words = []
for a, b in chunks:
    seg = pcm[int(a * SR):int(b * SR)]
    # trim silence at the chunk ends for tighter timing
    sp = [k * 0.01 for k in range(int(a * 100), min(len(speech), int(b * 100))) if speech[k]]
    if not sp:
        continue
    a2, b2 = sp[0], sp[-1] + 0.05
    st = rec.create_stream(); st.accept_waveform(SR, seg); rec.decode_stream(st)
    toks = st.result.text.strip().split()
    if not toks:
        continue
    lens = np.array([len(re.sub(r"\W", "", w)) + 1.6 for w in toks])
    cum = np.concatenate([[0], np.cumsum(lens)]) / lens.sum()
    bnd = a2 + cum * (b2 - a2)
    local = [d for d in dips if a2 < d < b2 and s[int(d * 100)] < np.percentile(s, 45)]
    used = set()
    for k in range(1, len(bnd) - 1):
        near = [d for d in local if abs(d - bnd[k]) < 0.16 and d not in used]
        if near:
            d = min(near, key=lambda d: abs(d - bnd[k])); used.add(d); bnd[k] = d
    bnd = np.maximum.accumulate(bnd)
    for k, w in enumerate(toks):
        words.append({"t": round(float(bnd[k]), 2), "d": round(float(max(0.08, (bnd[k + 1] - bnd[k]) * 0.92)), 2), "w": w})
    print(f"{a:6.2f}-{b:6.2f}  {' '.join(toks)}", file=sys.stderr)

for k, w in enumerate(words):
    w["id"] = f"w{k}"
    w["filler"] = re.sub(r"[^a-z]", "", w["w"].lower()) in {"um", "umm", "uh", "uhh", "erm", "hmm", "ah"}
res = {"duration": round(dur, 3), "pauses": [{"t": round(a, 2), "d": round(b - a, 2)} for a, b in pauses], "words": words}
os.remove(wav)
if out == "-":
    sys.stdout.write(json.dumps(res))
else:
    json.dump(res, open(out, "w"), indent=1)
print("words", len(words), "pauses", len(pauses), "chunks", len(chunks), file=sys.stderr)
