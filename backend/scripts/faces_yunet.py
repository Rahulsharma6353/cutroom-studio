#!/usr/bin/env python3
"""Per-frame face track with OpenCV YuNet, smoothed. Usage: faces_yunet.py <video> <model.onnx> <out.json|-> [step]
Output: [{t, x, y, w, h}] in source fractions (x, y = face centre), one sample per `step` frames."""
import json, sys
import cv2
import numpy as np

video, model, out = sys.argv[1:4]
step = int(sys.argv[4]) if len(sys.argv) > 4 else 1
cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
sw = 720
sh = round(H * sw / W)
det = cv2.FaceDetectorYN.create(model, '', (sw, sh), 0.7, 0.3, 50)
raw = []
i = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    if i % step == 0:
        small = cv2.resize(frame, (sw, sh))
        _, faces = det.detect(small)
        if faces is not None and len(faces):
            f = max(faces, key=lambda r: r[2] * r[3] * r[14])
            x, y, w, h = f[:4]
            raw.append((i / fps, (x + w / 2) / sw, (y + h / 2) / sh, w / sw, h / sh))
        else:
            raw.append((i / fps, None, None, None, None))
    i += 1
# Smooth each run of detections (centred moving average over ~0.3 s), keep gaps as gaps.
t = np.array([r[0] for r in raw])
vals = [np.array([np.nan if r[k] is None else r[k] for r in raw]) for k in range(1, 5)]
win = max(1, round(0.3 * fps / step))
res = []
for j in range(len(raw)):
    if np.isnan(vals[0][j]):
        continue
    lo, hi = max(0, j - win), min(len(raw), j + win + 1)
    s = [np.nanmean(v[lo:hi]) for v in vals]
    res.append({'t': round(float(t[j]), 3), 'x': round(float(s[0]), 4), 'y': round(float(s[1]), 4), 'w': round(float(s[2]), 4), 'h': round(float(s[3]), 4)})
if out == '-':
    sys.stdout.write(json.dumps(res))
else:
    json.dump(res, open(out, 'w'))
    print('frames', len(raw), 'faces', len(res))
