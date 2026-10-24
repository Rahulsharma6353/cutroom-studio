#!/usr/bin/env python3
"""Where the footage is busy or calm, and how bright, on a coarse grid over time.

Usage: calm_map.py <video> <out.json|-> [step_seconds=0.5] [cols=12] [rows=16]
Output: [{t, cols, rows, edge: [...], luma: [...]}]  (row-major, values 0..1, source frame coords)

edge = how much detail is in the cell (Sobel magnitude, normalised); text placed on low-edge cells
reads cleanly. luma = mean brightness; it decides dark text (on light) or light text (on dark).
"""
import json
import sys

import cv2
import numpy as np

video, out = sys.argv[1], sys.argv[2]
step = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 12
rows = int(sys.argv[5]) if len(sys.argv) > 5 else 16

cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
every = max(1, round(step * fps))
samples = []
i = 0
while True:
    ok = cap.grab()
    if not ok:
        break
    if i % every == 0:
        ok, frame = cap.retrieve()
        if not ok:
            break
        h, w = frame.shape[:2]
        scale = 360 / max(h, w)
        small = cv2.resize(frame, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        mag = np.sqrt(gx * gx + gy * gy)
        H, W = gray.shape
        edge, luma = [], []
        for r in range(rows):
            for c in range(cols):
                y0, y1 = r * H // rows, (r + 1) * H // rows
                x0, x1 = c * W // cols, (c + 1) * W // cols
                edge.append(float(mag[y0:y1, x0:x1].mean()))
                luma.append(float(gray[y0:y1, x0:x1].mean()))
        samples.append({'t': round(i / fps, 3), 'cols': cols, 'rows': rows, 'edge': edge, 'luma': [round(v, 3) for v in luma]})
    i += 1

# Normalise edge so 1 is "as busy as this video gets" (robust to footage that is all soft or all sharp).
allv = np.array([v for s in samples for v in s['edge']]) if samples else np.array([0.0])
hi = float(np.percentile(allv, 95)) or 1.0
for s in samples:
    s['edge'] = [round(min(1.0, v / hi), 3) for v in s['edge']]

if out == '-':
    sys.stdout.write(json.dumps(samples))
else:
    json.dump(samples, open(out, 'w'))
    print('samples', len(samples), file=sys.stderr)
