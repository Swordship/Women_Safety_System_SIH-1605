"""
video_processor.py — Background video loop + MJPEG frame buffer

WS broadcasting is handled entirely by main.py's WebSocket endpoint.
This file only maintains state — it does NOT broadcast directly.
"""

import cv2
import time
import threading
import asyncio
import logging
import traceback
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("video_processor")

# Alert cooldowns per (track_id, type) — prevents alert flood
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

        self._stats = {
            # Current-frame counts (go to 0 when nobody in frame)
            "women_count":  0,
            "men_count":    0,
            "person_count": 0,
            # Session accumulators (only go up, never reset to 0)
            "alert_count":         0,
            "session_women_total": 0,
            "session_men_total":   0,
            "session_sos":         0,
            "session_surrounded":  0,
            "session_proximity":   0,
            # Meta
            "fps":         0.0,
            "model_ready": False,
        }
        self._alerts_queue: list = []
        self._alert_last_fired: dict = {}

        # WS clients set — populated by main.py but NOT used for direct broadcast here
        self.ws_clients: set = set()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._detector = None

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

    # ── Dedup ──────────────────────────────────────────────────────────────────
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
        frame_count = 0

        # Session accumulators — live outside the video loop so they survive re-loops
        session_women_total = 0
        session_men_total   = 0
        session_sos         = 0
        session_surrounded  = 0
        session_proximity   = 0
        alert_total         = 0

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

                # Resize to max 640px wide before detection — biggest FPS win
                h, w = frame.shape[:2]
                if w > 640:
                    scale  = 640 / w
                    frame  = cv2.resize(frame, (640, int(h * scale)), interpolation=cv2.INTER_LINEAR)

                # Detection
                try:
                    result = self._detector.process_frame(frame, frame_count)
                except Exception as e:
                    logger.warning(f"Detection error: {e}")
                    result = {"frame": frame, "women_count": 0,
                              "men_count": 0, "person_count": 0, "alerts": []}

                # JPEG encode
                try:
                    _, buf = cv2.imencode(".jpg", result["frame"],
                                          [cv2.IMWRITE_JPEG_QUALITY, 65])
                    with self._lock:
                        self._latest_jpeg = buf.tobytes()
                except Exception as e:
                    logger.warning(f"JPEG encode error: {e}")

                # FPS
                t_now       = time.time()
                fps_display = 0.9 * fps_display + 0.1 / max(t_now - t_prev, 0.001)
                t_prev      = t_now

                # Session totals — take the peak per-loop
                w = result["women_count"]
                m = result["men_count"]
                session_women_total = max(session_women_total, w)
                session_men_total   = max(session_men_total, m)

                # Deduplicated alerts
                raw_alerts     = result.get("alerts", [])
                deduped_alerts = []
                for a in raw_alerts:
                    tid   = a.get("track_id", 0)
                    atype = a.get("type", "")
                    if self._should_fire(tid, atype):
                        # UTC timestamp with Z so browsers parse correctly
                        a["timestamp"] = datetime.now(timezone.utc).isoformat()
                        deduped_alerts.append(a)
                        if atype == "sos_gesture":      session_sos        += 1
                        elif atype == "person_surrounded": session_surrounded += 1
                        elif atype == "proximity_warning": session_proximity  += 1

                alert_total += len(deduped_alerts)

                if frame_count % 300 == 0:
                    self._clean_dedup_table()

                # Update stats dict — main.py reads this via get_stats()
                self._stats.update({
                    "women_count":         result["women_count"],
                    "men_count":           result["men_count"],
                    "person_count":        result["person_count"],
                    "alert_count":         alert_total,
                    "fps":                 round(fps_display, 1),
                    "model_ready":         True,
                    "session_women_total": session_women_total,
                    "session_men_total":   session_men_total,
                    "session_sos":         session_sos,
                    "session_surrounded":  session_surrounded,
                    "session_proximity":   session_proximity,
                })

                # Queue alerts — main.py reads these via get_recent_alerts()
                self._alerts_queue.extend(deduped_alerts)
                if len(self._alerts_queue) > 200:
                    self._alerts_queue = self._alerts_queue[-200:]

                # ── NO WS BROADCAST HERE ──
                # main.py's WebSocket endpoint handles all broadcasting.
                # It calls _make_dashboard_stats() which correctly shapes the data.
                # Broadcasting from here would send the wrong shape (women_count
                # instead of women_monitored) causing the dashboard to blink to 0.

                # Pace to source FPS
                elapsed = time.time() - t_now
                sleep   = max(0, (1.0 / fps_src) - elapsed)
                if sleep > 0:
                    time.sleep(sleep)

            cap.release()


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