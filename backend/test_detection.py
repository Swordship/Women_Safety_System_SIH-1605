import cv2
import os
import time
import math
import numpy as np
import torch
from ultralytics import YOLO
import mediapipe as mp

# ── Config ────────────────────────────────────────────────────────
VIDEO_PATH = "./sample_video.mp4"
MODEL_PATH = "./models/best.pt"

# ── GPU ───────────────────────────────────────────────────────────
print(f"CUDA available: {torch.cuda.is_available()}")
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")

# ── Load YOLO ─────────────────────────────────────────────────────
model_path = MODEL_PATH if os.path.exists(MODEL_PATH) else "yolov8n.pt"
print(f"Loading model: {model_path}")
model = YOLO(model_path)
if device == "cuda":
    model.to("cuda")

# ── MediaPipe ─────────────────────────────────────────────────────
mp_pose = mp.solutions.pose
PL      = mp_pose.PoseLandmark
pose    = mp_pose.Pose(
    static_image_mode=False,
    model_complexity=1,
    smooth_landmarks=True,
    min_detection_confidence=0.45,
    min_tracking_confidence=0.45
)

# ── Colors (BGR) ──────────────────────────────────────────────────
COLOR_WOMAN    = (180, 105, 255)
COLOR_MAN      = (235, 175, 50)
COLOR_SOS      = (0, 0, 220)
COLOR_WARN     = (0, 100, 255)
COLOR_PROX     = (50, 220, 50)
COLOR_SKELETON = (0, 230, 255)
COLOR_JOINT    = (0, 215, 255)

# ── SOS State ─────────────────────────────────────────────────────
prev_nose_y   = {}
wrist_history = {}

# ── Skeleton drawing ──────────────────────────────────────────────
def draw_skeleton(frame, lm, rx1, ry1, crop_w, crop_h, vis_thresh=0.35):
    """
    Map MediaPipe landmarks back to full-frame coordinates.
    Key formula from SIH repo gesture_analyzer.py:
      px = int(landmark.x * crop_w) + rx1
    """
    fh, fw = frame.shape[:2]
    for conn in mp_pose.POSE_CONNECTIONS:
        a = lm[conn[0]]; b = lm[conn[1]]
        if a.visibility < vis_thresh or b.visibility < vis_thresh:
            continue
        pt1 = (int(a.x * crop_w) + rx1, int(a.y * crop_h) + ry1)
        pt2 = (int(b.x * crop_w) + rx1, int(b.y * crop_h) + ry1)
        if not (0 <= pt1[0] < fw and 0 <= pt1[1] < fh and
                0 <= pt2[0] < fw and 0 <= pt2[1] < fh):
            continue
        cv2.line(frame, pt1, pt2, COLOR_SKELETON, 2)

    for l in lm:
        if l.visibility < vis_thresh:
            continue
        px = int(l.x * crop_w) + rx1
        py = int(l.y * crop_h) + ry1
        if not (0 <= px < fw and 0 <= py < fh):
            continue
        cv2.circle(frame, (px, py), 5, COLOR_JOINT, -1)
        cv2.circle(frame, (px, py), 5, (30, 30, 30), 1)


# ── 4 SOS gesture types from the SIH repo ────────────────────────

def _detect_hands_up(lm):
    """Both wrists clearly above head."""
    try:
        nose = lm[PL.NOSE]; l_sh = lm[PL.LEFT_SHOULDER]; r_sh = lm[PL.RIGHT_SHOULDER]
        l_el = lm[PL.LEFT_ELBOW]; r_el = lm[PL.RIGHT_ELBOW]
        l_wr = lm[PL.LEFT_WRIST]; r_wr = lm[PL.RIGHT_WRIST]
        if any(x.visibility < 0.5 for x in [nose, l_sh, r_sh, l_el, r_el, l_wr, r_wr]):
            return 0.0
        head_y = nose.y; sh_y = (l_sh.y + r_sh.y) / 2
        if not (l_wr.y < head_y - 0.05 and r_wr.y < head_y - 0.05):
            return 0.0
        score = 0.75
        if l_el.y < sh_y and r_el.y < sh_y:
            score += 0.15
        avg_wr_y = (l_wr.y + r_wr.y) / 2
        h_range = sh_y - head_y
        if h_range > 0:
            score += min(0.10, ((head_y - avg_wr_y) / h_range) * 0.10)
        return min(1.0, score)
    except:
        return 0.0


def _detect_help_signal(lm, track_id):
    """Single hand raised + waving motion."""
    try:
        nose = lm[PL.NOSE]; l_wr = lm[PL.LEFT_WRIST]; r_wr = lm[PL.RIGHT_WRIST]
        l_sh = lm[PL.LEFT_SHOULDER]; r_sh = lm[PL.RIGHT_SHOULDER]
        if any(x.visibility < 0.5 for x in [nose, l_sh, r_sh, l_wr, r_wr]):
            return 0.0
        head_y = nose.y
        left_up  = l_wr.y < head_y - 0.08
        right_up = r_wr.y < head_y - 0.08
        if not (left_up or right_up):
            return 0.0
        score = 0.60
        if left_up != right_up:   # single hand is more typical
            score += 0.10
        # Track wrist x for waving
        now = time.time()
        if track_id not in wrist_history:
            wrist_history[track_id] = []
        wrist_history[track_id].append((l_wr.x, r_wr.x, now))
        wrist_history[track_id] = [w for w in wrist_history[track_id] if now - w[2] < 2.0]
        if len(wrist_history[track_id]) >= 3:
            lx = [w[0] for w in wrist_history[track_id]]
            rx = [w[1] for w in wrist_history[track_id]]
            if max(max(lx)-min(lx), max(rx)-min(rx)) > 0.08:
                score += 0.25
        return min(1.0, score)
    except:
        return 0.0


def _detect_defensive_posture(lm):
    """Arms crossed / wrists close to body center."""
    try:
        l_sh = lm[PL.LEFT_SHOULDER]; r_sh = lm[PL.RIGHT_SHOULDER]
        l_el = lm[PL.LEFT_ELBOW];   r_el = lm[PL.RIGHT_ELBOW]
        l_wr = lm[PL.LEFT_WRIST];   r_wr = lm[PL.RIGHT_WRIST]
        if any(x.visibility < 0.5 for x in [l_sh, r_sh, l_el, r_el, l_wr, r_wr]):
            return 0.0
        cx = (l_sh.x + r_sh.x) / 2; sh_w = abs(r_sh.x - l_sh.x)
        l_cross = abs(l_wr.x - cx) < sh_w * 0.3
        r_cross = abs(r_wr.x - cx) < sh_w * 0.3
        el_close = abs(r_el.x - l_el.x) < sh_w * 1.2
        score = 0.0
        if l_cross and r_cross: score += 0.45
        elif l_cross or r_cross: score += 0.20
        if el_close: score += 0.30
        if l_wr.y > l_sh.y and r_wr.y > r_sh.y: score += 0.15
        return min(1.0, score)
    except:
        return 0.0


def _detect_rapid_head(lm, track_id):
    """Rapid vertical head movement."""
    try:
        nose_y = lm[PL.NOSE].y
        prev   = prev_nose_y.get(track_id, nose_y)
        delta  = abs(nose_y - prev)
        prev_nose_y[track_id] = nose_y
        return min(1.0, delta / 0.07) if delta > 0.07 else 0.0
    except:
        return 0.0


SOS_THRESHOLD = 0.65

def detect_sos(lm, track_id):
    """
    Run all 4 SOS types; return (is_sos, best_type, confidence).
    Threshold raised to 0.65 to cut false positives.
    """
    scores = {
        "hands_up":          _detect_hands_up(lm),
        "help_signal":       _detect_help_signal(lm, track_id),
        "defensive_posture": _detect_defensive_posture(lm),
        "rapid_head":        _detect_rapid_head(lm, track_id),
    }
    best = max(scores, key=scores.get)
    conf = scores[best]
    if conf >= SOS_THRESHOLD:
        return True, best, conf
    return False, "", 0.0


# ── Proximity ─────────────────────────────────────────────────────
def proximity_analysis(women, men, frame):
    for w in women:
        wc  = ((w["x1"] + w["x2"]) // 2, (w["y1"] + w["y2"]) // 2)
        w_h = w["y2"] - w["y1"]
        nearby = 0
        for m in men:
            mc   = ((m["x1"] + m["x2"]) // 2, (m["y1"] + m["y2"]) // 2)
            dist = math.hypot(wc[0] - mc[0], wc[1] - mc[1])
            if dist < w_h * 1.8:
                nearby += 1
                cv2.line(frame, wc, mc, COLOR_PROX, 2)
                mid = ((wc[0]+mc[0])//2, (wc[1]+mc[1])//2)
                cv2.putText(frame, f"{int(dist)}px", mid,
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, COLOR_PROX, 1)
        w["nearby_men"] = nearby
    return women


# ── Open video ────────────────────────────────────────────────────
cap = cv2.VideoCapture(VIDEO_PATH)
if not cap.isOpened():
    print(f"Cannot open: {VIDEO_PATH}"); exit()

fps_video = cap.get(cv2.CAP_PROP_FPS) or 25
print(f"✅ FPS: {fps_video:.1f} | Frames: {int(cap.get(cv2.CAP_PROP_FRAME_COUNT))}")
print("Q = quit | SPACE = pause")

frame_count = 0; alert_count = 0
fps_disp = 0.0; t_prev = time.time()

while True:
    ret, frame = cap.read()
    if not ret:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        prev_nose_y.clear(); wrist_history.clear()
        continue

    frame_count += 1
    t_now    = time.time()
    fps_disp = 0.9 * fps_disp + 0.1 / max(t_now - t_prev, 0.001)
    t_prev   = t_now

    results = model.track(frame, persist=True, verbose=False,
                          conf=0.35, iou=0.5, device=device)

    women = []; men = []

    if results and results[0].boxes is not None:
        for box in results[0].boxes:
            cls_id   = int(box.cls[0])
            label    = model.names.get(cls_id, "person").lower()
            conf     = float(box.conf[0])
            track_id = int(box.id[0]) if box.id is not None else (frame_count % 999)
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            x1=max(0,x1); y1=max(0,y1)
            x2=min(frame.shape[1]-1,x2); y2=min(frame.shape[0]-1,y2)

            # Gender: label keywords first, then class_id fallback
            # SIH model: class 0 = men, class 1 = women
            if any(k in label for k in ("woman","female","girl")):
                gender = "woman"
            elif any(k in label for k in ("man","male","boy")):
                gender = "man"
            else:
                gender = "woman" if cls_id == 1 else "man"

            det = dict(track_id=track_id, gender=gender, conf=conf,
                       x1=x1, y1=y1, x2=x2, y2=y2,
                       sos=False, sos_type="", sos_conf=0.0, nearby_men=0)

            if gender == "woman":
                pad = 25
                rx1 = max(0, x1-pad); ry1 = max(0, y1-pad)
                rx2 = min(frame.shape[1], x2+pad)
                ry2 = min(frame.shape[0], y2+pad)
                cw = rx2-rx1; ch = ry2-ry1
                if cw > 20 and ch > 20:
                    crop_rgb    = cv2.cvtColor(frame[ry1:ry2, rx1:rx2], cv2.COLOR_BGR2RGB)
                    pose_result = pose.process(crop_rgb)
                    if pose_result.pose_landmarks:
                        lm = pose_result.pose_landmarks.landmark
                        draw_skeleton(frame, lm, rx1, ry1, cw, ch)
                        ok, stype, sconf = detect_sos(lm, track_id)
                        if ok:
                            det["sos"] = True; det["sos_type"] = stype; det["sos_conf"] = sconf

            (women if gender == "woman" else men).append(det)

    women = proximity_analysis(women, men, frame)

    frame_alerts = 0
    for det in women + men:
        x1,y1,x2,y2 = det["x1"],det["y1"],det["x2"],det["y2"]
        if det["gender"] == "woman":
            if det["sos"]:
                color = COLOR_SOS
                tag   = f"SOS: {det['sos_type']} ({det['sos_conf']:.0%})"
                frame_alerts += 1
            elif det["nearby_men"] >= 2:
                color = COLOR_SOS; tag = f"SURROUNDED ({det['nearby_men']} men)"; frame_alerts += 1
            elif det["nearby_men"] == 1:
                color = COLOR_WARN; tag = "Woman ⚠ (1 man)"; frame_alerts += 1
            else:
                color = COLOR_WOMAN; tag = "Woman"
        else:
            color = COLOR_MAN; tag = "Man"

        cv2.rectangle(frame, (x1,y1),(x2,y2), color, 2)
        (tw,th),_ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        ly = max(y1, th+10)
        cv2.rectangle(frame,(x1,ly-th-8),(x1+tw+8,ly),color,-1)
        cv2.putText(frame, tag,(x1+4,ly-4),cv2.FONT_HERSHEY_SIMPLEX,0.55,(255,255,255),1)

    if frame_alerts > 0:
        alert_count += 1

    # HUD
    ov = frame.copy()
    cv2.rectangle(ov,(0,0),(frame.shape[1],62),(10,10,10),-1)
    cv2.addWeighted(ov,0.6,frame,0.4,0,frame)
    cv2.putText(frame,"DAY MODE",(10,24),cv2.FONT_HERSHEY_SIMPLEX,0.7,(0,255,255),2)
    cv2.putText(frame,
        f"People:{len(women)+len(men)}  Women:{len(women)}  Men:{len(men)}  AlertFrames:{alert_count}",
        (10,52),cv2.FONT_HERSHEY_SIMPLEX,0.62,(255,255,255),1)
    ftxt = f"FPS:{fps_disp:.1f}"
    (fw2,_),_=cv2.getTextSize(ftxt,cv2.FONT_HERSHEY_SIMPLEX,0.7,2)
    cv2.putText(frame,ftxt,(frame.shape[1]-fw2-10,24),cv2.FONT_HERSHEY_SIMPLEX,0.7,(50,255,50),2)

    cv2.imshow("EmpowerHer - Detection (Q=quit)",frame)
    key = cv2.waitKey(max(1,int(1000/fps_video))) & 0xFF
    if key == ord('q'):
        break
    elif key == ord(' '):
        cv2.waitKey(0)

cap.release()
cv2.destroyAllWindows()
print(f"\nDone | Frames:{frame_count} | Alert frames:{alert_count}")