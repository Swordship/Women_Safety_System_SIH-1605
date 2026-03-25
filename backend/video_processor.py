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


class VideoProcessor:
    def __init__(self, video_path: str, model_path: str = "./models/best.pt"):
        self.video_path = video_path
        self.model_path = model_path

        self._latest_jpeg: Optional[bytes] = None
        self._lock   = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

        self._stats = {
            "women_count":  0,
            "men_count":    0,
            "person_count": 0,
            "alert_count":  0,
            "fps":          0.0,
            "model_ready":  False,
        }
        self._alerts_queue: list = []

        self.ws_clients: set = set()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._detector = None

    # ── Lifecycle ─────────────────────────────────────────────────
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

    # ── Public API ────────────────────────────────────────────────
    def get_jpeg(self) -> Optional[bytes]:
        with self._lock:
            return self._latest_jpeg

    def get_stats(self) -> dict:
        return dict(self._stats)

    def get_recent_alerts(self) -> list:
        return list(self._alerts_queue[-50:])

    # ── Main loop ─────────────────────────────────────────────────
    def _run(self):
        # Step 1: Load model
        logger.info("Loading detector model (this takes ~10s first time)...")
        try:
            from detector import Detector
            self._detector = Detector(self.model_path)
            self._stats["model_ready"] = True
            logger.info("✅ Detector loaded successfully")
        except Exception as e:
            logger.error(f"❌ Detector load failed: {e}")
            logger.error(traceback.format_exc())
            self._running = False
            return

        fps_display  = 0.0
        alert_total  = 0

        # Step 2: Loop video
        while self._running:
            cap = cv2.VideoCapture(self.video_path)
            if not cap.isOpened():
                logger.error(f"Cannot open video: {self.video_path}")
                time.sleep(2)
                continue

            fps_src = cap.get(cv2.CAP_PROP_FPS) or 25
            logger.info(f"Video opened — source FPS: {fps_src:.1f}")
            self._detector.reset_state()
            t_prev = time.time()

            while self._running:
                ret, frame = cap.read()
                if not ret:
                    logger.info("Video ended — looping...")
                    break

                # Detection
                try:
                    result = self._detector.process_frame(frame)
                except Exception as e:
                    logger.warning(f"Detection error: {e}")
                    result = {
                        "frame": frame,
                        "women_count": 0,
                        "men_count": 0,
                        "person_count": 0,
                        "alerts": [],
                    }

                # Encode JPEG
                try:
                    _, buf = cv2.imencode(".jpg", result["frame"],
                                          [cv2.IMWRITE_JPEG_QUALITY, 80])
                    with self._lock:
                        self._latest_jpeg = buf.tobytes()
                except Exception as e:
                    logger.warning(f"JPEG encode error: {e}")

                # Stats
                t_now       = time.time()
                fps_display = 0.9 * fps_display + 0.1 / max(t_now - t_prev, 0.001)
                t_prev      = t_now

                new_alerts = result.get("alerts", [])
                alert_total += len(new_alerts)

                self._stats.update({
                    "women_count":  result["women_count"],
                    "men_count":    result["men_count"],
                    "person_count": result["person_count"],
                    "alert_count":  alert_total,
                    "fps":          round(fps_display, 1),
                    "model_ready":  True,
                    "timestamp":    datetime.utcnow().isoformat(),
                })

                # Cache alerts
                for a in new_alerts:
                    a["timestamp"] = datetime.utcnow().isoformat()
                    self._alerts_queue.append(a)
                if len(self._alerts_queue) > 200:
                    self._alerts_queue = self._alerts_queue[-200:]

                # WS push
                if self._loop and self.ws_clients:
                    payload = json.dumps({
                        "type":   "stats",
                        "stats":  self._stats,
                        "alerts": new_alerts,
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


# ── Singleton ─────────────────────────────────────────────────────
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