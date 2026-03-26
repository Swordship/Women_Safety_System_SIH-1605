"""
detector.py — EmpowerHer core detection pipeline

Tracking improvements:
- BoT-SORT tracker (better re-identification than ByteTrack)
- IoU-based re-ID: merges new track_id with recently-lost same-gender track
- Canonical ID set: counts unique people, not max-concurrent or all-time IDs
- MediaPipe every 2nd frame per track (performance)
- Temporal SOS consistency (N consecutive frames required)
"""

import cv2
import math
import time
import numpy as np
import mediapipe as mp
from ultralytics import YOLO
import torch
from collections import defaultdict

mp_pose = mp.solutions.pose
PL = mp_pose.PoseLandmark

COLOR_WOMAN    = (180, 105, 255)
COLOR_MAN      = (235, 175, 50)
COLOR_SOS      = (0,   0,   220)
COLOR_WARN     = (0,   100, 255)
COLOR_PROX     = (50,  220, 50)
COLOR_SKELETON = (0,   230, 255)
COLOR_JOINT    = (0,   215, 255)

SOS_THRESHOLD = 0.72

SOS_CONSECUTIVE_REQUIRED = {
    "hands_up":          2,
    "help_signal":       3,
    "defensive_posture": 3,
    "rapid_head":        4,
}

# How many frames to remember a lost track for re-ID
REID_MEMORY_FRAMES = 45   # ~1.8s at 25fps


def _iou(b1, b2) -> float:
    """Compute IoU between two bboxes [x1,y1,x2,y2]."""
    ix1 = max(b1[0], b2[0]); iy1 = max(b1[1], b2[1])
    ix2 = min(b1[2], b2[2]); iy2 = min(b1[3], b2[3])
    iw = max(0, ix2 - ix1);  ih = max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    a1 = (b1[2]-b1[0]) * (b1[3]-b1[1])
    a2 = (b2[2]-b2[0]) * (b2[3]-b2[1])
    return inter / (a1 + a2 - inter + 1e-6)


def _center_dist(b1, b2) -> float:
    """Euclidean distance between bbox centers."""
    c1x = (b1[0]+b1[2])/2; c1y = (b1[1]+b1[3])/2
    c2x = (b2[0]+b2[2])/2; c2y = (b2[1]+b2[3])/2
    return math.hypot(c1x-c2x, c1y-c2y)


class Detector:
    def __init__(self, model_path: str = "./models/best.pt"):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[Detector] Using device: {self.device}")

        self.model = YOLO(model_path)
        if self.device == "cuda":
            self.model.to("cuda")

        self.pose = mp_pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            smooth_landmarks=True,
            min_detection_confidence=0.45,
            min_tracking_confidence=0.45,
        )

        # SOS state
        self._prev_nose_y:   dict = {}
        self._wrist_history: dict = {}
        self._sos_streak:    dict = defaultdict(lambda: defaultdict(int))

        # MediaPipe cache: track_id -> (landmarks, frame_count)
        self._last_pose: dict = {}

        # ── Re-ID / unique person tracking ──────────────────────────────────
        # Active tracks: raw_track_id -> {gender, bbox, last_frame, canonical_id}
        self._active:   dict = {}
        # Lost tracks: canonical_id -> {gender, bbox, lost_frame}
        self._lost:     dict = {}
        # Unique canonical people seen this session
        self._unique_women: set = set()
        self._unique_men:   set = set()
        self._next_canonical = 1

    # ── Public API ─────────────────────────────────────────────────────────────
    def process_frame(self, frame: np.ndarray, frame_count: int = 0) -> dict:
        vis = frame.copy()

        # BoT-SORT gives better appearance-based re-ID than ByteTrack
        # Falls back to bytetrack automatically if botsort.yaml not found
        try:
            results = self.model.track(
                frame, persist=True, verbose=False,
                conf=0.35, iou=0.5, device=self.device,
                tracker="botsort.yaml",
            )
        except Exception:
            results = self.model.track(
                frame, persist=True, verbose=False,
                conf=0.35, iou=0.5, device=self.device,
            )

        raw_detections = []
        if results and results[0].boxes is not None:
            for box in results[0].boxes:
                cls_id   = int(box.cls[0])
                label    = self.model.names.get(cls_id, "person").lower()
                conf     = float(box.conf[0])
                track_id = int(box.id[0]) if box.id is not None else 0
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                x1 = max(0, x1); y1 = max(0, y1)
                x2 = min(vis.shape[1]-1, x2); y2 = min(vis.shape[0]-1, y2)

                if any(k in label for k in ("woman","female","girl")):
                    gender = "woman"
                elif any(k in label for k in ("man","male","boy")):
                    gender = "man"
                else:
                    gender = "woman" if cls_id == 1 else "man"

                raw_detections.append({
                    "track_id": track_id, "gender": gender, "conf": conf,
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                })

        # ── Re-ID: assign canonical IDs ───────────────────────────────────────
        raw_detections = self._assign_canonical(raw_detections, frame_count)

        # ── Expire lost tracks older than memory window ────────────────────────
        expired = [cid for cid, v in self._lost.items()
                   if frame_count - v["lost_frame"] > REID_MEMORY_FRAMES]
        for cid in expired:
            del self._lost[cid]

        # Mark tracks not seen this frame as lost
        seen_raw_ids = {d["track_id"] for d in raw_detections}
        for raw_id, info in list(self._active.items()):
            if raw_id not in seen_raw_ids:
                self._lost[info["canonical_id"]] = {
                    "gender": info["gender"],
                    "bbox":   info["bbox"],
                    "lost_frame": frame_count,
                }
                del self._active[raw_id]

        # ── Build women/men lists with pose ───────────────────────────────────
        women, men = [], []
        for d in raw_detections:
            det = dict(
                track_id=d["track_id"],
                canonical_id=d["canonical_id"],
                gender=d["gender"], conf=d["conf"],
                x1=d["x1"], y1=d["y1"], x2=d["x2"], y2=d["y2"],
                sos=False, sos_type="", sos_conf=0.0, nearby_men=0,
            )

            if d["gender"] == "woman":
                pad = 25
                rx1 = max(0, d["x1"]-pad); ry1 = max(0, d["y1"]-pad)
                rx2 = min(vis.shape[1], d["x2"]+pad)
                ry2 = min(vis.shape[0], d["y2"]+pad)
                cw = rx2-rx1; ch = ry2-ry1
                if cw > 20 and ch > 20:
                    tid = d["track_id"]
                    run_pose = (frame_count % 2 == 1) or (tid not in self._last_pose)
                    if run_pose:
                        crop_rgb    = cv2.cvtColor(vis[ry1:ry2, rx1:rx2], cv2.COLOR_BGR2RGB)
                        pose_result = self.pose.process(crop_rgb)
                        if pose_result.pose_landmarks:
                            self._last_pose[tid] = (pose_result.pose_landmarks.landmark, frame_count)
                        else:
                            self._last_pose.pop(tid, None)
                            self._sos_streak[tid].clear()
                    cached = self._last_pose.get(tid)
                    if cached:
                        lm = cached[0]
                        self._draw_skeleton(vis, lm, rx1, ry1, cw, ch)
                        ok, stype, sconf = self._detect_sos(lm, tid)
                        if ok:
                            det["sos"] = True
                            det["sos_type"] = stype
                            det["sos_conf"] = sconf

            (women if d["gender"] == "woman" else men).append(det)

        women = self._proximity(women, men, vis)
        self._draw_boxes(vis, women, men)
        self._draw_hud(vis, women, men, frame_count)

        return {
            "frame":         vis,
            "women_count":   len(self._unique_women),
            "men_count":     len(self._unique_men),
            "person_count":  len(self._unique_women) + len(self._unique_men),
            "frame_women":   len(women),    # current frame (for HUD)
            "frame_men":     len(men),
            "alerts":        self._build_alerts(women, men),
        }

    def reset_state(self):
        self._prev_nose_y.clear()
        self._wrist_history.clear()
        self._sos_streak.clear()
        self._last_pose.clear()
        self._active.clear()
        self._lost.clear()
        self._unique_women.clear()
        self._unique_men.clear()
        self._next_canonical = 1

    # ── Re-ID core ─────────────────────────────────────────────────────────────
    def _assign_canonical(self, detections: list, frame_count: int) -> list:
        """
        For each raw YOLO track_id, find or assign a canonical person ID.
        When a new track_id appears, check if it matches a recently-lost
        track via IoU or center distance — if so, it's the same person.
        """
        for d in detections:
            raw_id = d["track_id"]
            bbox   = [d["x1"], d["y1"], d["x2"], d["y2"]]
            w      = d["x2"] - d["x1"]   # person width for distance threshold

            if raw_id in self._active:
                # Known track — update bbox
                self._active[raw_id]["bbox"]       = bbox
                self._active[raw_id]["last_frame"] = frame_count
                d["canonical_id"] = self._active[raw_id]["canonical_id"]
            else:
                # New track_id — try to match a lost track (same gender)
                matched_cid = None
                best_score  = 0.0

                for cid, lost in self._lost.items():
                    if lost["gender"] != d["gender"]:
                        continue
                    frames_gone = frame_count - lost["lost_frame"]
                    if frames_gone > REID_MEMORY_FRAMES:
                        continue

                    iou   = _iou(bbox, lost["bbox"])
                    dist  = _center_dist(bbox, lost["bbox"])
                    # Distance threshold scales with person size
                    dist_ok = dist < max(w * 2.5, 80)
                    score = iou if iou > 0 else (0.3 if dist_ok else 0.0)

                    if (iou > 0.15 or dist_ok) and score > best_score:
                        best_score  = score
                        matched_cid = cid

                if matched_cid is not None:
                    # Same person re-appeared → reuse canonical ID
                    canonical_id = matched_cid
                    del self._lost[matched_cid]
                else:
                    # Genuinely new person
                    canonical_id = self._next_canonical
                    self._next_canonical += 1

                self._active[raw_id] = {
                    "gender":       d["gender"],
                    "bbox":         bbox,
                    "last_frame":   frame_count,
                    "canonical_id": canonical_id,
                }
                d["canonical_id"] = canonical_id

                # Register in unique sets
                if d["gender"] == "woman":
                    self._unique_women.add(canonical_id)
                else:
                    self._unique_men.add(canonical_id)

        return detections

    # ── Skeleton ───────────────────────────────────────────────────────────────
    def _draw_skeleton(self, frame, lm, rx1, ry1, cw, ch, vis_thresh=0.35):
        fh, fw = frame.shape[:2]
        for conn in mp_pose.POSE_CONNECTIONS:
            a = lm[conn[0]]; b = lm[conn[1]]
            if a.visibility < vis_thresh or b.visibility < vis_thresh:
                continue
            pt1 = (int(a.x*cw)+rx1, int(a.y*ch)+ry1)
            pt2 = (int(b.x*cw)+rx1, int(b.y*ch)+ry1)
            if not (0<=pt1[0]<fw and 0<=pt1[1]<fh and 0<=pt2[0]<fw and 0<=pt2[1]<fh):
                continue
            cv2.line(frame, pt1, pt2, COLOR_SKELETON, 2)
        for l in lm:
            if l.visibility < vis_thresh:
                continue
            px = int(l.x*cw)+rx1; py = int(l.y*ch)+ry1
            if not (0<=px<fw and 0<=py<fh):
                continue
            cv2.circle(frame, (px,py), 5, COLOR_JOINT, -1)
            cv2.circle(frame, (px,py), 5, (30,30,30), 1)

    # ── SOS detectors ──────────────────────────────────────────────────────────
    def _detect_hands_up(self, lm) -> float:
        try:
            nose=lm[PL.NOSE]; l_sh=lm[PL.LEFT_SHOULDER]; r_sh=lm[PL.RIGHT_SHOULDER]
            l_el=lm[PL.LEFT_ELBOW]; r_el=lm[PL.RIGHT_ELBOW]
            l_wr=lm[PL.LEFT_WRIST]; r_wr=lm[PL.RIGHT_WRIST]
            if any(x.visibility<0.5 for x in [nose,l_sh,r_sh,l_el,r_el,l_wr,r_wr]): return 0.0
            head_y=nose.y; sh_y=(l_sh.y+r_sh.y)/2
            if not (l_wr.y<head_y-0.05 and r_wr.y<head_y-0.05): return 0.0
            s=0.75
            if l_el.y<sh_y and r_el.y<sh_y: s+=0.15
            avg_wy=(l_wr.y+r_wr.y)/2; hr=sh_y-head_y
            if hr>0: s+=min(0.10,((head_y-avg_wy)/hr)*0.10)
            return min(1.0,s)
        except: return 0.0

    def _detect_help_signal(self, lm, track_id) -> float:
        try:
            nose=lm[PL.NOSE]; l_wr=lm[PL.LEFT_WRIST]; r_wr=lm[PL.RIGHT_WRIST]
            l_sh=lm[PL.LEFT_SHOULDER]; r_sh=lm[PL.RIGHT_SHOULDER]
            if any(x.visibility<0.5 for x in [nose,l_sh,r_sh,l_wr,r_wr]): return 0.0
            head_y=nose.y
            left_up=l_wr.y<head_y-0.08; right_up=r_wr.y<head_y-0.08
            if not (left_up or right_up): return 0.0
            now=time.time()
            if track_id not in self._wrist_history: self._wrist_history[track_id]=[]
            self._wrist_history[track_id].append((l_wr.x,r_wr.x,now))
            self._wrist_history[track_id]=[w for w in self._wrist_history[track_id] if now-w[2]<2.0]
            wave_score=0.0
            if len(self._wrist_history[track_id])>=4:
                lx=[w[0] for w in self._wrist_history[track_id]]
                rx=[w[1] for w in self._wrist_history[track_id]]
                lateral=max(max(lx)-min(lx), max(rx)-min(rx))
                if lateral>0.10: wave_score=0.30
                elif lateral>0.08: wave_score=0.15
            if wave_score==0.0: return 0.0
            s=0.50
            if left_up!=right_up: s+=0.10
            return min(1.0, s+wave_score)
        except: return 0.0

    def _detect_defensive(self, lm) -> float:
        try:
            l_sh=lm[PL.LEFT_SHOULDER]; r_sh=lm[PL.RIGHT_SHOULDER]
            l_el=lm[PL.LEFT_ELBOW];   r_el=lm[PL.RIGHT_ELBOW]
            l_wr=lm[PL.LEFT_WRIST];   r_wr=lm[PL.RIGHT_WRIST]
            l_hip=lm[PL.LEFT_HIP];    r_hip=lm[PL.RIGHT_HIP]
            if any(x.visibility<0.4 for x in [l_sh,r_sh,l_el,r_el,l_wr,r_wr,l_hip,r_hip]): return 0.0
            cx=(l_sh.x+r_sh.x)/2; sh_w=abs(r_sh.x-l_sh.x)
            hip_y=(l_hip.y+r_hip.y)/2
            lc=abs(l_wr.x-cx)<sh_w*0.35; rc=abs(r_wr.x-cx)<sh_w*0.35
            ec=abs(r_el.x-l_el.x)<sh_w*1.2
            if not (lc and rc): return 0.0
            if not (l_wr.y<hip_y and r_wr.y<hip_y): return 0.0
            s=0.50
            if ec: s+=0.28
            sh_y=(l_sh.y+r_sh.y)/2
            if l_wr.y<sh_y and r_wr.y<sh_y: s+=0.15
            return min(1.0,s)
        except: return 0.0

    def _detect_rapid_head(self, lm, track_id) -> float:
        try:
            nose=lm[PL.NOSE]
            if nose.visibility<0.5: return 0.0
            ny=nose.y; prev=self._prev_nose_y.get(track_id,ny); d=abs(ny-prev)
            self._prev_nose_y[track_id]=ny
            if d<0.12: return 0.0
            return min(0.90, (d-0.12)/0.10*0.35+0.60)
        except: return 0.0

    def _detect_sos(self, lm, track_id):
        scores = {
            "hands_up":          self._detect_hands_up(lm),
            "help_signal":       self._detect_help_signal(lm, track_id),
            "defensive_posture": self._detect_defensive(lm),
            "rapid_head":        self._detect_rapid_head(lm, track_id),
        }
        streak = self._sos_streak[track_id]
        confirmed_type = None; confirmed_conf = 0.0
        for stype, score in scores.items():
            required = SOS_CONSECUTIVE_REQUIRED.get(stype, 3)
            if score >= SOS_THRESHOLD: streak[stype] += 1
            else: streak[stype] = 0
            if streak[stype] >= required and score > confirmed_conf:
                confirmed_conf = score; confirmed_type = stype
        if confirmed_type:
            return True, confirmed_type, round(confirmed_conf, 3)
        return False, "", 0.0

    # ── Proximity ──────────────────────────────────────────────────────────────
    def _proximity(self, women, men, frame):
        for w in women:
            wc=((w["x1"]+w["x2"])//2,(w["y1"]+w["y2"])//2)
            w_h=w["y2"]-w["y1"]; nearby=0
            for m in men:
                mc=((m["x1"]+m["x2"])//2,(m["y1"]+m["y2"])//2)
                dist=math.hypot(wc[0]-mc[0],wc[1]-mc[1])
                if dist<w_h*1.8:
                    nearby+=1
                    cv2.line(frame,wc,mc,COLOR_PROX,2)
                    mid=((wc[0]+mc[0])//2,(wc[1]+mc[1])//2)
                    cv2.putText(frame,f"{int(dist)}px",mid,cv2.FONT_HERSHEY_SIMPLEX,0.4,COLOR_PROX,1)
            w["nearby_men"]=nearby
        return women

    # ── Drawing ────────────────────────────────────────────────────────────────
    def _draw_boxes(self, frame, women, men):
        for det in women+men:
            x1,y1,x2,y2=det["x1"],det["y1"],det["x2"],det["y2"]
            cid = det.get("canonical_id", det["track_id"])
            if det["gender"]=="woman":
                if det["sos"]:
                    color=COLOR_SOS
                    tag=f"W#{cid} SOS:{det['sos_type']} ({det['sos_conf']:.0%})"
                elif det["nearby_men"]>=2:
                    color=COLOR_SOS; tag=f"W#{cid} SURROUNDED"
                elif det["nearby_men"]==1:
                    color=COLOR_WARN; tag=f"W#{cid} (man nearby)"
                else:
                    color=COLOR_WOMAN; tag=f"Woman #{cid}"
            else:
                color=COLOR_MAN; tag=f"Man #{cid}"
            cv2.rectangle(frame,(x1,y1),(x2,y2),color,2)
            (tw,th),_=cv2.getTextSize(tag,cv2.FONT_HERSHEY_SIMPLEX,0.52,1)
            ly=max(y1,th+10)
            cv2.rectangle(frame,(x1,ly-th-8),(x1+tw+8,ly),color,-1)
            cv2.putText(frame,tag,(x1+4,ly-4),cv2.FONT_HERSHEY_SIMPLEX,0.52,(255,255,255),1)

    def _draw_hud(self, frame, women, men, frame_count=0):
        ov=frame.copy()
        cv2.rectangle(ov,(0,0),(frame.shape[1],62),(10,10,10),-1)
        cv2.addWeighted(ov,0.6,frame,0.4,0,frame)
        cv2.putText(frame,"DAY MODE",(10,24),cv2.FONT_HERSHEY_SIMPLEX,0.7,(0,255,255),2)
        # Show both current frame counts AND unique session totals
        cv2.putText(frame,
            f"Now: W:{len(women)} M:{len(men)}  |  Session: W:{len(self._unique_women)} M:{len(self._unique_men)}",
            (10,52),cv2.FONT_HERSHEY_SIMPLEX,0.55,(255,255,255),1)

    # ── Alert builder ──────────────────────────────────────────────────────────
    def _build_alerts(self, women, men) -> list:
        alerts=[]
        for w in women:
            if w["sos"]:
                alerts.append({"type":"sos_gesture","sub_type":w["sos_type"],
                    "confidence":round(w["sos_conf"],3),"severity":"high",
                    "bbox":[w["x1"],w["y1"],w["x2"],w["y2"]],"track_id":w["track_id"]})
            elif w["nearby_men"]>=2:
                alerts.append({"type":"person_surrounded","surrounding_count":w["nearby_men"],
                    "confidence":round(min(1.0,0.70+(w["nearby_men"]-2)*0.10),3),"severity":"high",
                    "bbox":[w["x1"],w["y1"],w["x2"],w["y2"]],"track_id":w["track_id"]})
            elif w["nearby_men"]==1:
                alerts.append({"type":"proximity_warning","confidence":0.65,"severity":"medium",
                    "bbox":[w["x1"],w["y1"],w["x2"],w["y2"]],"track_id":w["track_id"]})
        return alerts