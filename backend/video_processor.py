"""
video_processor.py — Background video loop + MJPEG frame buffer
"""

import cv2
import time
import threading
import asyncio
import json
import logging
import traceback
from datetime import datetime
from typing import Optional
import numpy as np

logger = logging.getLogger("video_processor")

# Alert cooldowns: (track_id, type) → fires at most once per interval
ALERT_COOLDOWN = {
    "sos_gesture":       3.0,
    "person_surrounded": 5.0,
    "proximity_warning": 8.0,
}


class VideoProcessor:
    def __init__(self, video_path: str, model_path: str = "./models/best.pt"):
        self.video_path = video_path
        self.model_path = model_path

        self._latest_jpeg: Optional[bytes] = None
        self._lock    = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

        # Per-frame counts (reset each frame)
        self._stats = {
            "women_count":         0,
            "men_count":           0,
            "person_count":        0,
            "alert_count":         0,
            "fps":                 0.0,
            "model_ready":         False,
            # Session accumulators — never reset to 0
            "session_women_total": 0,
            "session_men_total":   0,
            "session_sos":         0,
            "session_surrounded":  0,
            "session_proximity":   0,
        }
        self._alerts_queue: list = []

        # dedup: (track_id, alert_type) → last fired time
        self._alert_last_fired: dict = {}

        self.ws_clients: set = set()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._detector = None

        self._last_ws_push: float = 0.0
        self._WS_INTERVAL  = 2.0   # push at most every 2 seconds

    # ── Lifecycle ──────────────────────────────────────────────────────────────
    def start(self):
        if self._running:
            return
        self._running = True
        self._thread  = threading.Thread(target=self._run, daemon=True, name="VideoProcessor")
        self._thread.start()
        logger.info("VideoProcessor thread started")

    def stop(self):
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)

    # ── Public API ─────────────────────────────────────────────────────────────
    def get_jpeg(self) -> Optional[bytes]:
        with self._lock:
            return self._latest_jpeg

    def get_stats(self) -> dict:
        return dict(self._stats)

    def get_recent_alerts(self) -> list:
        return list(self._alerts_queue[-50:])

    # ── Deduplication ──────────────────────────────────────────────────────────
    def _should_fire(self, track_id: int, alert_type: str) -> bool:
        key      = (track_id, alert_type)
        now      = time.time()
        cooldown = ALERT_COOLDOWN.get(alert_type, 5.0)
        if now - self._alert_last_fired.get(key, 0.0) >= cooldown:
            self._alert_last_fired[key] = now
            return True
        return False

    def _clean_dedup_table(self):
        now   = time.time()
        stale = [k for k, v in self._alert_last_fired.items() if now - v > 60]
        for k in stale:
            del self._alert_last_fired[k]

    # ── Main loop ──────────────────────────────────────────────────────────────
    def _run(self):
        logger.info("Loading detector model...")
        try:
            from detector import Detector
            self._detector = Detector(self.model_path)
            self._stats["model_ready"] = True
            logger.info("✅ Detector loaded")
        except Exception as e:
            logger.error(f"❌ Detector load failed: {e}")
            logger.error(traceback.format_exc())
            self._running = False
            return

        fps_display = 0.0
        alert_total = 0
        frame_count = 0

        # Session accumulators — persist across video loops
        session_women_total = 0
        session_men_total   = 0
        session_sos         = 0
        session_surrounded  = 0
        session_proximity   = 0

        while self._running:
            cap = cv2.VideoCapture(self.video_path)
            if not cap.isOpened():
                logger.error(f"Cannot open video: {self.video_path}")
                time.sleep(2)
                continue

            fps_src = cap.get(cv2.CAP_PROP_FPS) or 25
            logger.info(f"Video opened — FPS: {fps_src:.1f}")
            self._detector.reset_state()
            self._alert_last_fired.clear()
            t_prev = time.time()

            while self._running:
                ret, frame = cap.read()
                if not ret:
                    logger.info("Video ended — looping...")
                    break

                frame_count += 1

                # Detection
                try:
                    result = self._detector.process_frame(frame)
                except Exception as e:
                    logger.warning(f"Detection error: {e}")
                    result = {"frame": frame, "women_count": 0,
                              "men_count": 0, "person_count": 0, "alerts": []}

                # JPEG encode
                try:
                    _, buf = cv2.imencode(".jpg", result["frame"],
                                          [cv2.IMWRITE_JPEG_QUALITY, 80])
                    with self._lock:
                        self._latest_jpeg = buf.tobytes()
                except Exception as e:
                    logger.warning(f"JPEG encode error: {e}")

                # FPS
                t_now       = time.time()
                fps_display = 0.9 * fps_display + 0.1 / max(t_now - t_prev, 0.001)
                t_prev      = t_now

                # ── Update session accumulators ────────────────────────────
                w = result["women_count"]
                m = result["men_count"]
                if w > 0:
                    session_women_total = max(session_women_total, w)
                if m > 0:
                    session_men_total = max(session_men_total, m)

                # ── Deduplicated alerts ────────────────────────────────────
                raw_alerts     = result.get("alerts", [])
                deduped_alerts = []
                for a in raw_alerts:
                    tid   = a.get("track_id", 0)
                    atype = a.get("type", "")
                    if self._should_fire(tid, atype):
                        a["timestamp"] = datetime.utcnow().isoformat()
                        deduped_alerts.append(a)
                        # Count by type for session metrics
                        if atype == "sos_gesture":
                            session_sos += 1
                        elif atype == "person_surrounded":
                            session_surrounded += 1
                        elif atype == "proximity_warning":
                            session_proximity += 1

                alert_total += len(deduped_alerts)

                if frame_count % 300 == 0:
                    self._clean_dedup_table()

                self._stats.update({
                    "women_count":         result["women_count"],
                    "men_count":           result["men_count"],
                    "person_count":        result["person_count"],
                    "alert_count":         alert_total,
                    "fps":                 round(fps_display, 1),
                    "model_ready":         True,
                    "timestamp":           datetime.utcnow().isoformat(),
                    # Session totals — used by dashboard metrics
                    "session_women_total": session_women_total,
                    "session_men_total":   session_men_total,
                    "session_sos":         session_sos,
                    "session_surrounded":  session_surrounded,
                    "session_proximity":   session_proximity,
                })

                self._alerts_queue.extend(deduped_alerts)
                if len(self._alerts_queue) > 200:
                    self._alerts_queue = self._alerts_queue[-200:]

                # ── WS push — throttled to every 2s ───────────────────────
                now = time.time()
                if (self._loop and self.ws_clients and
                        now - self._last_ws_push >= self._WS_INTERVAL):
                    self._last_ws_push = now
                    payload = json.dumps({
                        "type":   "stats",
                        "stats":  self._stats,
                        "alerts": deduped_alerts,
                    })
                    try:
                        asyncio.run_coroutine_threadsafe(
                            self._broadcast(payload), self._loop
                        )
                    except Exception:
                        pass

                # Pace to source FPS
                elapsed = time.time() - t_now
                sleep   = max(0, (1.0 / fps_src) - elapsed)
                if sleep > 0:
                    time.sleep(sleep)

            cap.release()

    async def _broadcast(self, message: str):
        dead = set()
        for ws in list(self.ws_clients):
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        self.ws_clients -= dead


# ── Singleton ──────────────────────────────────────────────────────────────────
_processor: Optional[VideoProcessor] = None

def get_processor() -> VideoProcessor:
    global _processor
    if _processor is None:
        raise RuntimeError("Call init_processor() first")
    return _processor

def init_processor(video_path: str, model_path: str = "./models/best.pt") -> VideoProcessor:
    global _processor
    _processor = VideoProcessor(video_path, model_path)
    return _processor