"""Face track for a video: prints JSON [{t, x, y, w, h}] with the face centre and size as
fractions of the frame, sampled about 4 times a second. Used so captions and graphics
never cover the speaker's face. Needs: pip install opencv-python-headless==4.10.0.84"""
import json, sys
import cv2

path = sys.argv[1]
step = float(sys.argv[2]) if len(sys.argv) > 2 else 0.25
cap = cv2.VideoCapture(path)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
out, every, i = [], max(1, round(fps * step)), 0
while True:
    ok = cap.grab()
    if not ok:
        break
    if i % every == 0:
        ok, frame = cap.retrieve()
        if ok:
            h, w = frame.shape[:2]
            scale = 480 / max(w, h)
            small = cv2.resize(frame, (int(w * scale), int(h * scale)))
            grey = cv2.equalizeHist(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
            faces = cascade.detectMultiScale(grey, scaleFactor=1.1, minNeighbors=6, minSize=(int(40 * 480 / 1080), int(40 * 480 / 1080)))
            if len(faces):
                fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
                sw, sh = small.shape[1], small.shape[0]
                out.append({"t": round(i / fps, 2), "x": round((fx + fw / 2) / sw, 4), "y": round((fy + fh / 2) / sh, 4), "w": round(fw / sw, 4), "h": round(fh / sh, 4)})
    i += 1
print(json.dumps(out))
