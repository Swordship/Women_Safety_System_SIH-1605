"""
detector.py — EmpowerHer core detection pipeline

Key fixes vs original:
1. Temporal consistency — SOS only fires after N consecutive positive frames
2. rapid_head — delta threshold raised 0.07→0.12, requires 4 consecutive frames
3. defensive_posture — requires BOTH wrists crossed + above hips (not just hands at sides)
4. help_signal — waving motion required before threshold is crossed
5. SOS_THRESHOLD raised 0.65→0.72
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
        self._prev_nose_y:   dict = {}
        self._wrist_history: dict = {}
        self._sos_streak:    dict = defaultdict(lambda: defaultdict(int))

    def process_frame(self, frame: np.ndarray) -> dict:
        vis = frame.copy()
        results = self.model.track(
            frame, persist=True, verbose=False,
            conf=0.35, iou=0.5, device=self.device
        )
        women, men = [], []
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
                det = dict(track_id=track_id, gender=gender, conf=conf,
                           x1=x1, y1=y1, x2=x2, y2=y2,
                           sos=False, sos_type="", sos_conf=0.0, nearby_men=0)
                if gender == "woman":
                    pad = 25
                    rx1 = max(0, x1-pad); ry1 = max(0, y1-pad)
                    rx2 = min(vis.shape[1], x2+pad)
                    ry2 = min(vis.shape[0], y2+pad)
                    cw = rx2-rx1; ch = ry2-ry1
                    if cw > 20 and ch > 20:
                        crop_rgb    = cv2.cvtColor(vis[ry1:ry2, rx1:rx2], cv2.COLOR_BGR2RGB)
                        pose_result = self.pose.process(crop_rgb)
                        if pose_result.pose_landmarks:
                            lm = pose_result.pose_landmarks.landmark
                            self._draw_skeleton(vis, lm, rx1, ry1, cw, ch)
                            ok, stype, sconf = self._detect_sos(lm, track_id)
                            if ok:
                                det["sos"] = True; det["sos_type"] = stype; det["sos_conf"] = sconf
                        else:
                            self._sos_streak[track_id].clear()
                (women if gender == "woman" else men).append(det)
        women = self._proximity(women, men, vis)
        self._draw_boxes(vis, women, men)
        self._draw_hud(vis, women, men)
        return {"frame": vis, "women_count": len(women), "men_count": len(men),
                "person_count": len(women)+len(men), "alerts": self._build_alerts(women, men)}

    def reset_state(self):
        self._prev_nose_y.clear()
        self._wrist_history.clear()
        self._sos_streak.clear()

    def _draw_skeleton(self, frame, lm, rx1, ry1, cw, ch, vis_thresh=0.35):
        fh, fw = frame.shape[:2]
        for conn in mp_pose.POSE_CONNECTIONS:
            a = lm[conn[0]]; b = lm[conn[1]]
            if a.visibility < vis_thresh or b.visibility < vis_thresh: continue
            pt1 = (int(a.x*cw)+rx1, int(a.y*ch)+ry1)
            pt2 = (int(b.x*cw)+rx1, int(b.y*ch)+ry1)
            if not (0<=pt1[0]<fw and 0<=pt1[1]<fh and 0<=pt2[0]<fw and 0<=pt2[1]<fh): continue
            cv2.line(frame, pt1, pt2, COLOR_SKELETON, 2)
        for l in lm:
            if l.visibility < vis_thresh: continue
            px = int(l.x*cw)+rx1; py = int(l.y*ch)+ry1
            if not (0<=px<fw and 0<=py<fh): continue
            cv2.circle(frame, (px,py), 5, COLOR_JOINT, -1)
            cv2.circle(frame, (px,py), 5, (30,30,30), 1)

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
        """Hand raised + waving confirmed. Static raised hand no longer triggers."""
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
            if wave_score==0.0: return 0.0   # wave required
            s=0.50
            if left_up!=right_up: s+=0.10
            return min(1.0, s+wave_score)
        except: return 0.0

    def _detect_defensive(self, lm) -> float:
        """Crossed arms guard posture. Normal standing (hands at sides) no longer scores."""
        try:
            l_sh=lm[PL.LEFT_SHOULDER]; r_sh=lm[PL.RIGHT_SHOULDER]
            l_el=lm[PL.LEFT_ELBOW];   r_el=lm[PL.RIGHT_ELBOW]
            l_wr=lm[PL.LEFT_WRIST];   r_wr=lm[PL.RIGHT_WRIST]
            l_hip=lm[PL.LEFT_HIP];    r_hip=lm[PL.RIGHT_HIP]
            if any(x.visibility<0.4 for x in [l_sh,r_sh,l_el,r_el,l_wr,r_wr,l_hip,r_hip]): return 0.0
            cx=( l_sh.x+r_sh.x)/2; sh_w=abs(r_sh.x-l_sh.x)
            hip_y=(l_hip.y+r_hip.y)/2
            lc=abs(l_wr.x-cx)<sh_w*0.35; rc=abs(r_wr.x-cx)<sh_w*0.35
            ec=abs(r_el.x-l_el.x)<sh_w*1.2
            if not (lc and rc): return 0.0           # BOTH wrists must cross
            if not (l_wr.y<hip_y and r_wr.y<hip_y): return 0.0  # raised guard only
            s=0.50
            if ec: s+=0.28
            sh_y=(l_sh.y+r_sh.y)/2
            if l_wr.y<sh_y and r_wr.y<sh_y: s+=0.15
            return min(1.0,s)
        except: return 0.0

    def _detect_rapid_head(self, lm, track_id) -> float:
        """Rapid vertical head jerk. Threshold 0.07→0.12 eliminates walking bob."""
        try:
            nose=lm[PL.NOSE]
            if nose.visibility<0.5: return 0.0
            ny=nose.y; prev=self._prev_nose_y.get(track_id,ny); d=abs(ny-prev)
            self._prev_nose_y[track_id]=ny
            if d<0.12: return 0.0
            return min(0.90, (d-0.12)/0.10*0.35+0.60)
        except: return 0.0

    def _detect_sos(self, lm, track_id):
        """Fire only after N consecutive positive frames per gesture type."""
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
            if score >= SOS_THRESHOLD:
                streak[stype] += 1
            else:
                streak[stype] = 0
            if streak[stype] >= required and score > confirmed_conf:
                confirmed_conf = score; confirmed_type = stype
        if confirmed_type:
            return True, confirmed_type, round(confirmed_conf, 3)
        return False, "", 0.0

    def _proximity(self, women, men, frame):
        for w in women:
            wc=((w["x1"]+w["x2"])//2,(w["y1"]+w["y2"])//2); w_h=w["y2"]-w["y1"]; nearby=0
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

    def _draw_boxes(self, frame, women, men):
        for det in women+men:
            x1,y1,x2,y2=det["x1"],det["y1"],det["x2"],det["y2"]
            if det["gender"]=="woman":
                if det["sos"]:           color=COLOR_SOS;  tag=f"SOS:{det['sos_type']} ({det['sos_conf']:.0%})"
                elif det["nearby_men"]>=2: color=COLOR_SOS;  tag=f"SURROUNDED ({det['nearby_men']} men)"
                elif det["nearby_men"]==1: color=COLOR_WARN; tag="Woman (1 man nearby)"
                else:                    color=COLOR_WOMAN; tag="Woman"
            else: color=COLOR_MAN; tag="Man"
            cv2.rectangle(frame,(x1,y1),(x2,y2),color,2)
            (tw,th),_=cv2.getTextSize(tag,cv2.FONT_HERSHEY_SIMPLEX,0.55,1)
            ly=max(y1,th+10)
            cv2.rectangle(frame,(x1,ly-th-8),(x1+tw+8,ly),color,-1)
            cv2.putText(frame,tag,(x1+4,ly-4),cv2.FONT_HERSHEY_SIMPLEX,0.55,(255,255,255),1)

    def _draw_hud(self, frame, women, men):
        ov=frame.copy()
        cv2.rectangle(ov,(0,0),(frame.shape[1],62),(10,10,10),-1)
        cv2.addWeighted(ov,0.6,frame,0.4,0,frame)
        cv2.putText(frame,"DAY MODE",(10,24),cv2.FONT_HERSHEY_SIMPLEX,0.7,(0,255,255),2)
        cv2.putText(frame,f"Women:{len(women)}  Men:{len(men)}  People:{len(women)+len(men)}",
                    (10,52),cv2.FONT_HERSHEY_SIMPLEX,0.62,(255,255,255),1)

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