#!/usr/bin/env python3
"""Builds a Premiere Pro package from an export body + rendered layers.

Usage: premiere_package.py <body.json> <layersDir> <outDir> <sfxDir> <packageFolder> <phrases.json>
  layersDir      output of `scripts/render-layers.ts layers` (manifest.json + PNG sequences)
  outDir         package folder to create (graphics/, sfx/, media/, *.xml, README.txt)
  packageFolder  where the package will live on the editor's computer, e.g.
                 C:/Users/me/Downloads/my_edit_premiere or /Users/me/Downloads/my_edit_premiere
                 (Premiere needs absolute paths; if they don't match it asks to locate one file once).

body.json may carry width/height (sequence size) and mediaFiles: {assetId: {path, frames, w, h, audio, still}}
with path relative to the package (e.g. media/clip.mp4) or absolute. AROLL_PATH overrides the A-roll path.

The XML is Final Cut Pro 7 XML (xmeml v4), which Premiere imports with File > Import.
Every graphic is a QuickTime Animation (.mov with alpha) so it stays a separate, movable clip;
captions are one alpha .mov cut into one clip per phrase; SFX are wav clips with their mix level.
"""
import glob
import json
import os
import shutil
import subprocess
import sys
from urllib.parse import quote
from xml.sax.saxutils import escape

from PIL import Image

body_file, layers_dir, out_dir, sfx_dir, win_folder, phrases_file = sys.argv[1:7]
body = json.load(open(body_file))
FPS = body['fps']
W, H = int(body.get('width', 1440)), int(body.get('height', 1080))
TOTAL = round(body['duration'] * FPS)
SFX_FILES = {'whoosh': 'whoosh.wav', 'swoosh': 'whoosh.wav', 'pop': 'pop.wav', 'type': 'type.wav', 'typing': 'type.wav',
             'ding': 'ding.wav', 'notification': 'ding.wav', 'riser': 'riser.wav', 'hit': 'hit.wav', 'boom': 'hit.wav', 'click': 'click.wav'}
SFX_VOLUME = {'whoosh.wav': 0.55, 'pop.wav': 0.7, 'type.wav': 0.45, 'ding.wav': 0.35, 'riser.wav': 0.4, 'hit.wav': 0.7, 'click.wav': 0.5}

os.makedirs(f'{out_dir}/graphics', exist_ok=True)
os.makedirs(f'{out_dir}/sfx', exist_ok=True)
manifest = json.load(open(f'{layers_dir}/manifest.json'))
clips = body['clips']
by_id = {c['id']: c for c in clips}


def gain(c):
    db = c.get('gainDb') or 0
    return 0.0 if db <= -60 else 10 ** (db / 20)


def fr(t):
    return round(t * FPS)


AROLL_PATH = os.environ.get('AROLL_PATH')  # absolute Windows path of the source clip, if not inside the package


def url(rel):
    rel = rel.replace('\\', '/')
    absolute = rel.startswith('/') or (len(rel) > 1 and rel[1] == ':')
    p = rel if absolute else win_folder.replace('\\', '/').rstrip('/') + '/' + rel
    if len(p) > 1 and p[1] == ':':  # Windows drive path
        return f'file://localhost/{p[0]}%3a' + quote(p[2:])
    return 'file://localhost' + quote(p)


def frames_of(d):
    return sorted(glob.glob(f'{d}/*.png'))


def encode(pngs, out, opaque=False):
    # Numbered image sequence (exactly one output frame per PNG; the concat demuxer adds a frame).
    tmp = out + '.seq'
    os.makedirs(tmp, exist_ok=True)
    for k, p in enumerate(pngs):
        dst = f'{tmp}/{k:06d}.png'
        try:
            os.symlink(os.path.abspath(p), dst)
        except OSError:  # Windows without symlink rights: hard link, else copy
            try:
                os.link(os.path.abspath(p), dst)
            except OSError:
                shutil.copy(p, dst)
    codec = ['-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'] if opaque else ['-c:v', 'qtrle', '-pix_fmt', 'argb']
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', f'{tmp}/%06d.png'] + codec + [out], check=True)
    shutil.rmtree(tmp)


# ---- Media files --------------------------------------------------------------------------
files = {}  # key -> dict(id, name, rel, frames, kind, w, h)


def add_file(key, name, rel, frames, kind='video', w=W, h=H, audio=False):
    files[key] = dict(id=f'file-{len(files) + 1}', name=name, rel=rel, frames=frames, kind=kind, w=w, h=h, audio=audio, written=False)
    return files[key]


# Source media: one file per asset that has a local copy.
media = body.get('mediaFiles') or {}
assets = {a['id']: a for a in body['assets']}
def media_key(asset_id):
    key = 'asset:' + asset_id
    if key in files:
        return key
    a = assets.get(asset_id, {})
    m = dict(media.get(asset_id) or {})
    if AROLL_PATH and a.get('kind') == 'aroll':
        m.setdefault('path', AROLL_PATH)
    if not m.get('path'):
        return None
    frames = int(m.get('frames') or round((a.get('duration') or body['duration']) * FPS))
    add_file(key, os.path.basename(m['path']), m['path'], frames, w=int(m.get('w') or W), h=int(m.get('h') or H), audio=bool(m.get('audio', True)) and not m.get('still'))
    files[key]['still'] = bool(m.get('still'))
    return key

video_tracks = []  # list of lists of clipitems (dict)
audio_tracks = []


def place(tracks, item):
    for tr in tracks:
        if all(item['end'] <= o['start'] or item['start'] >= o['end'] for o in tr):
            tr.append(item)
            return
    tracks.append([item])


# V1: A-roll shots. Punch-in alternates 100/112, scaled about 50%/35% like the MP4 (centre nudged down).
look = body['look']
arolls = sorted([c for c in clips if c['trackId'] == 't-aroll'], key=lambda c: c['start'])
v1 = []
vo = []  # a voiceover A-roll: sound only, no picture
for i, c in enumerate(arolls):
    s = 1.12 if look.get('punchAlternate') and i % 2 == 1 else 1.0
    start, end = fr(c['start']), fr(c['start'] + c['duration'])
    fk = media_key(c.get('assetId', ''))
    if not fk:
        continue
    if assets.get(c.get('assetId', ''), {}).get('audioOnly'):
        files[fk]['kind'] = 'audio'
        files[fk]['audio'] = True
        vo.append(dict(name=f'Voiceover {i + 1}', file=fk, start=start, end=end, inp=fr(c['in']), out=fr(c['in']) + end - start, gain=gain(c)))
        continue
    fill = max(W / files[fk]['w'], H / files[fk]['h'])  # scale to fill the sequence frame
    s *= fill
    item = dict(name=f"Shot {i + 1}", file=fk, start=start, end=end, inp=fr(c['in']), out=fr(c['in']) + end - start, scale=s * 100, punch=s / fill, kf=None, gain=gain(c))
    if i == 0 and look.get('introSettle') and fr(c['in']) == 0:
        # Opening settle (shot 1 starts at media frame 0, so keyframe times are unambiguous): 116% -> 100%.
        kf = []
        push = (lambda t: 1 + 0.045 * t / c['duration']) if look.get('pushIn') else (lambda t: 1)
        for t in (0, 0.075, 0.15, 0.225, 0.3, 0.375, 0.45):
            k = 1 - t / 0.45
            kf.append((fr(t), s * 100 * (1 + 0.16 * k * k) * push(t)))
        kf.append((end - start, s * 100 * push(c['duration'])))  # slow push-in to the end of the shot
        item['kf'] = kf
    v1.append(item)
video_tracks.append(v1)

# B-roll: full-frame cutaways above the A-roll, scaled to fill (side-by-side split layouts are not reproduced).
broll_tracks = []
for c in sorted([c for c in clips if c['trackId'] == 't-broll'], key=lambda c: c['start']):
    fk = media_key(c.get('assetId', ''))
    if not fk:
        continue
    f = files[fk]
    start, end = fr(c['start']), fr(c['start'] + c['duration'])
    if f.get('still'):
        f['frames'] = max(f['frames'], end - start)
        inp = 0
    else:
        inp = fr(c.get('in', 0))
    place(broll_tracks, dict(name=c.get('label') or f['name'], file=fk, start=start, end=end, inp=inp, out=inp + end - start, scale=max(W / f['w'], H / f['h']) * 100, kf=None))
video_tracks += broll_tracks

# Captions: alpha .mov files (split at the empty stretch nearest the middle so each file stays
# small enough to copy), cut into one clip per phrase.
cap = next((m for m in manifest if m['name'] == 'captions'), None)
cap_items = []
if cap:
    cap_pngs = frames_of(cap['dir'])
    print('captions frames', len(cap_pngs), flush=True)
    nonempty = []
    for p in cap_pngs:
        a = Image.open(p).getchannel('A')
        nonempty.append(a.getbbox() is not None)
    mid = len(cap_pngs) // 2
    empties = [i for i, v in enumerate(nonempty) if not v and 0 < i < len(cap_pngs) - 1]
    split = min(empties, key=lambda i: abs(i - mid)) if empties else len(cap_pngs)
    parts = [(0, split), (split, len(cap_pngs))] if split < len(cap_pngs) else [(0, len(cap_pngs))]
    for n, (pa, pb) in enumerate(parts):
        name = f'captions_{n + 1}.mov' if len(parts) > 1 else 'captions.mov'
        encode(cap_pngs[pa:pb], f'{out_dir}/graphics/{name}')
        add_file(f'captions{n}', name, f'graphics/{name}', pb - pa)
    def part_of(frame):
        for n, (pa, pb) in enumerate(parts):
            if pa <= frame < pb:
                return n, pa
        return len(parts) - 1, parts[-1][0]
    # One clip per phrase: window from this phrase's first word to the next phrase's, trimmed to visible frames.
    phrases = json.load(open(phrases_file))
    if not phrases:
        # No phrase timing (non-pixel caption styles): one clip per run of visible captions.
        runs, i = [], 0
        while i < len(nonempty):
            if nonempty[i]:
                j = i
                while j < len(nonempty) and nonempty[j]:
                    j += 1
                if runs and i - runs[-1][1] <= 6:
                    runs[-1][1] = j
                else:
                    runs.append([i, j])
                i = j
            else:
                i += 1
        for a, b in runs:
            t0, t1 = (a + cap['from']) / FPS, (b + cap['from']) / FPS
            phrases.append({'t0': t0 + 0.14, 'text': ' '.join(w['w'] for w in body['words'] if t0 <= w['t'] < t1)[:48] or 'Caption'})
    bounds = [0] + [fr(p['t0'] - 0.14) - cap['from'] for p in phrases[1:]] + [len(nonempty)]
    cap_items = []
    for k, p in enumerate(phrases):
        a, b = max(0, bounds[k]), min(len(nonempty), bounds[k + 1])
        while a < b and not nonempty[a]:
            a += 1
        while b > a and not nonempty[b - 1]:
            b -= 1
        if b <= a:
            continue
        n, off = part_of(a)
        b = min(b, parts[n][1])  # never straddle the split (it sits in an empty stretch)
        cap_items.append(dict(name=p['text'][:48], file=f'captions{n}', start=a + cap['from'], end=b + cap['from'], inp=a - off, out=b - off, scale=100, kf=None))
print('caption clips', len(cap_items))

# Graphics: one clip each, grouped by layer kind so each kind gets its own track(s).
# Stills (plate, film look) are PNGs held for the clip's length.
ORDER = ['t-plate', 't-look', 't-overlay', 't-labels', 't-setup', 't-key']
KIND_NAME = {'t-plate': 'Background', 't-look': 'Look', 't-overlay': 'Graphic', 't-labels': 'Labels', 't-setup': 'Setup', 't-key': 'Key'}
by_track = {k: [] for k in ORDER}
for m in manifest:
    if m['name'] == 'captions':
        continue
    cid = m['name'][4:]
    c = by_id[cid]
    pngs = frames_of(m['dir'])
    track = m.get('track') or c['trackId']
    safe = ''.join(ch if ch.isalnum() else '_' for ch in c['label'])[:40].strip('_') or 'layer'
    prefix = KIND_NAME.get(track, 'Layer').lower()
    if m.get('still'):
        fname = f"{len(files):02d}_{prefix}_{safe}.png"
        shutil.copy(pngs[0], f'{out_dir}/graphics/{fname}')
        end = m.get('end') or (m['from'] + 1)
        add_file(cid, fname, f'graphics/{fname}', end - m['from'])
        files[cid]['still'] = True
        item = dict(name=f"{KIND_NAME.get(track, 'Layer')}: {c['label']}"[:60], file=cid, start=m['from'], end=end, inp=0, out=end - m['from'], scale=100, kf=None)
    else:
        opaque = ((c.get('graphic') or {}).get('ui')) == 'pages'  # full-frame scene: no alpha needed
        fname = f"{len(files):02d}_{prefix}_{safe}.{'mp4' if opaque else 'mov'}"
        print('layer', fname, len(pngs), flush=True)
        encode(pngs, f'{out_dir}/graphics/{fname}', opaque)
        add_file(cid, fname, f'graphics/{fname}', len(pngs))
        item = dict(name=f"{KIND_NAME.get(track, 'Layer')}: {c['label']}"[:60], file=cid, start=m['from'], end=m['from'] + len(pngs), inp=0, out=len(pngs), scale=100, kf=None)
    by_track.setdefault(track, []).append(item)


def stack(items):
    out = []
    for it in sorted(items, key=lambda x: x['start']):
        place(out, it)
    return out


plate_tracks = stack(by_track.pop('t-plate', []))
gfx_tracks = []
for k in ORDER[1:]:
    gfx_tracks += stack(by_track.get(k, []))
video_tracks += gfx_tracks
video_tracks[:0] = plate_tracks  # background under the footage
video_tracks.append(cap_items)  # captions on top

# Audio: dialogue (stereo pair A1/A2 from final_draft.mp4), then SFX tracks.
dialog_l, dialog_r = [], []
for i, it in enumerate(v1):
    if not files[it['file']]['audio']:
        continue
    it['dl'] = len(dialog_l)
    for ch, tr in ((1, dialog_l), (2, dialog_r)):
        g = it.get('gain', 1)
        tr.append(dict(name=it['name'], file=it['file'], start=it['start'], end=it['end'], inp=it['inp'], out=it['out'], ch=ch, level=None if g == 1 else round(g, 4), link=i))
for it in vo:
    for ch, tr in ((1, dialog_l), (2, dialog_r)):
        tr.append(dict(name=it['name'], file=it['file'], start=it['start'], end=it['end'], inp=it['inp'], out=it['out'], ch=ch, level=None if it['gain'] == 1 else round(it['gain'], 4), link=None))
audio_tracks += [dialog_l, dialog_r]
# Music beds.
music_tracks = []
for c in sorted([c for c in clips if c['trackId'] == 't-music'], key=lambda c: c['start']):
    fk = media_key(c.get('assetId', ''))
    if not fk:
        continue
    start, end = fr(c['start']), fr(c['start'] + c['duration'])
    inp = fr(c.get('in', 0))
    place(music_tracks, dict(name=c.get('label') or 'Music', file=fk, start=start, end=end, inp=inp, out=inp + end - start, ch=1, level=round(c.get('volume', 0.35) * gain(c), 4), link=None))
audio_tracks += music_tracks
used = set()
sfx_tracks = []
for c in sorted([c for c in clips if c['trackId'] == 't-sfx'], key=lambda c: c['start']):
    f = SFX_FILES.get(c['label'].lower().split()[0])
    if not f:
        continue
    if f not in used:
        shutil.copy(f'{sfx_dir}/{f}', f'{out_dir}/sfx/{f}')
        n = int(float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{sfx_dir}/{f}']).decode()) * FPS)
        add_file('sfx:' + f, f, f'sfx/{f}', n, kind='audio', audio=True)
        used.add(f)
    n = files['sfx:' + f]['frames']
    start = fr(c['start'])
    length = min(n, max(1, fr(c['duration'])) if c['duration'] < n / FPS else n)
    # Whole file plays in the MP4 render (Remotion plays the full sound), so use the whole file.
    length = min(n, TOTAL - start)
    place(sfx_tracks, dict(name=c['label'], file='sfx:' + f, start=start, end=start + length, inp=0, out=length, ch=1, level=round(SFX_VOLUME[f] * gain(c), 4), link=None))
audio_tracks += sfx_tracks

# ---- XML ----------------------------------------------------------------------------------
RATE = f'<rate><timebase>{FPS}</timebase><ntsc>FALSE</ntsc></rate>'


def file_xml(key):
    f = files[key]
    if f['written']:
        return f'<file id="{f["id"]}"/>'
    f['written'] = True
    media = ''
    if f['kind'] == 'video':
        media += f'<video><samplecharacteristics>{RATE}<width>{f["w"]}</width><height>{f["h"]}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>'
    if f['audio']:
        media += '<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>'
    return (f'<file id="{f["id"]}"><name>{escape(f["name"])}</name><pathurl>{url(f["rel"])}</pathurl>{RATE}'
            f'<duration>{f["frames"]}</duration><media>{media}</media></file>')


def motion(it):
    s = it['scale']
    if s == 100 and not it['kf']:
        return ''
    kf = ''.join(f'<keyframe><when>{w}</when><value>{v:.3f}</value></keyframe>' for w, v in (it['kf'] or []))
    vert = (it.get('punch', 1) - 1) * 0.15  # the MP4 scales about 50%/35%: nudge the centre down
    return ('<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory>'
            '<effecttype>motion</effecttype><mediatype>video</mediatype>'
            f'<parameter authoringApp="PremierePro"><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax><value>{s:.3f}</value>{kf}</parameter>'
            f'<parameter authoringApp="PremierePro"><parameterid>center</parameterid><name>Center</name><value><horiz>0</horiz><vert>{vert:.5f}</vert></value></parameter>'
            '</effect></filter>')


def level(v):
    return ('<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory>'
            '<effecttype>audiolevels</effecttype><mediatype>audio</mediatype>'
            f'<parameter authoringApp="PremierePro"><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>{v}</value></parameter>'
            '</effect></filter>')


ids = {}
for ti, tr in enumerate(video_tracks):
    for ci, it in enumerate(sorted(tr, key=lambda x: x['start'])):
        it['id'] = f'clipitem-v{ti + 1}-{ci + 1}'
for ti, tr in enumerate(audio_tracks):
    for ci, it in enumerate(sorted(tr, key=lambda x: x['start'])):
        it['id'] = f'clipitem-a{ti + 1}-{ci + 1}'


V1_INDEX = next(k for k, tr in enumerate(video_tracks) if tr is v1) + 1


def links(i):
    v = v1[i]
    if 'dl' not in v:
        return ''
    d = v['dl']
    out = f'<link><linkclipref>{v["id"]}</linkclipref><mediatype>video</mediatype><trackindex>{V1_INDEX}</trackindex><clipindex>{i + 1}</clipindex></link>'
    for ch, tr in ((1, dialog_l), (2, dialog_r)):
        out += f'<link><linkclipref>{tr[d]["id"]}</linkclipref><mediatype>audio</mediatype><trackindex>{ch}</trackindex><clipindex>{d + 1}</clipindex><groupindex>1</groupindex></link>'
    return out


def vclip(it, ti):
    f = files[it['file']]
    lk = links(next(k for k, x in enumerate(v1) if x is it)) if ti == V1_INDEX - 1 else ''
    return (f'<clipitem id="{it["id"]}"><name>{escape(it["name"])}</name><enabled>TRUE</enabled><duration>{f["frames"]}</duration>{RATE}'
            f'<start>{it["start"]}</start><end>{it["end"]}</end><in>{it["inp"]}</in><out>{it["out"]}</out>'
            f'{file_xml(it["file"])}{motion(it)}{lk}</clipitem>')


def aclip(it):
    f = files[it['file']]
    lk = links(it['link']) if it['link'] is not None else ''
    lv = level(it['level']) if it['level'] is not None else ''
    return (f'<clipitem id="{it["id"]}"><name>{escape(it["name"])}</name><enabled>TRUE</enabled><duration>{f["frames"]}</duration>{RATE}'
            f'<start>{it["start"]}</start><end>{it["end"]}</end><in>{it["inp"]}</in><out>{it["out"]}</out>'
            f'{file_xml(it["file"])}<sourcetrack><mediatype>audio</mediatype><trackindex>{it["ch"]}</trackindex></sourcetrack>{lv}{lk}</clipitem>')


vx = ''.join('<track>' + ''.join(vclip(it, ti) for it in sorted(tr, key=lambda x: x['start'])) + '<enabled>TRUE</enabled><locked>FALSE</locked></track>'
             for ti, tr in enumerate(video_tracks))
ax = ''.join('<track>' + ''.join(aclip(it) for it in sorted(tr, key=lambda x: x['start'])) + '<enabled>TRUE</enabled><locked>FALSE</locked>'
             + (f'<outputchannelindex>{ti + 1}</outputchannelindex>' if ti < 2 else '') + '</track>'
             for ti, tr in enumerate(audio_tracks))
title = body.get('title') or 'edit'
seq = (f'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="sequence-1"><name>{escape(title)}</name>'
       f'<duration>{TOTAL}</duration>{RATE}<timecode>{RATE}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>'
       f'<media><video><format><samplecharacteristics>{RATE}<width>{W}</width><height>{H}</height><anamorphic>FALSE</anamorphic>'
       f'<pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance><colordepth>24</colordepth></samplecharacteristics></format>{vx}</video>'
       f'<audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>{ax}</audio>'
       '</media></sequence></xmeml>\n')
xml_name = (''.join(ch if ch.isalnum() else '_' for ch in title.lower()).strip('_') or 'edit') + '.xml'
open(f'{out_dir}/{xml_name}', 'w').write(seq)
print('xml', xml_name)
print('video tracks', len(video_tracks), 'audio tracks', len(audio_tracks), 'sfx clips', sum(len(t) for t in sfx_tracks))
