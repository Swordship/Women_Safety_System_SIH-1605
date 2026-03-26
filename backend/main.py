"""
main.py — EmpowerHer FastAPI backend
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("main")

VIDEO_PATH = os.getenv("VIDEO_PATH", "./sample_video.mp4")
MODEL_PATH = os.getenv("MODEL_PATH", "./models/best.pt")
HOST       = os.getenv("HOST", "0.0.0.0")
PORT       = int(os.getenv("PORT", 8000))


# ── Shape helpers ──────────────────────────────────────────────────────────────

def _make_dashboard_stats(proc) -> dict:
    """Map raw detector stats → DashboardStats the frontend expects."""
    s = proc.get_stats()

    # Use unique canonical person counts (re-ID corrected, never inflated)
    total_women = s.get("unique_women", s.get("session_women_total", 0))
    total_men   = s.get("unique_men",   s.get("session_men_total",   0))
    sos         = s.get("session_sos",         0)
    surrounded  = s.get("session_surrounded",  0)
    proximity   = s.get("session_proximity",   0)
    alert_total = s.get("alert_count",         0)
    safe        = max(0, total_women - sos - surrounded)

    return {
        "women_monitored": total_women,
        "men_detected":    total_men,
        "alerts_today":    alert_total,
        "hotspot_areas":   1,
        # Extra fields (not in DashboardStats type but Dashboard.tsx reads them)
        "fps":             s.get("fps", 0),
        "model_ready":     s.get("model_ready", False),
        "safety_metrics": {
            "lone_women":        0,
            "surrounded":        surrounded,
            "sos_gestures":      sos,
            "safe_interactions": safe,
            "total_women":       max(total_women, 1),  # never 0 — prevents div-by-zero in progress bars
        },
    }


_ALERT_TITLES = {
    "sos_gesture":       "SOS Gesture Detected",
    "person_surrounded": "Person Surrounded",
    "proximity_warning": "Proximity Warning",
}

def _make_alert(raw: dict) -> dict:
    """Map raw detector alert → Alert shape the frontend expects."""
    alert_type = raw.get("type", "proximity_warning")
    sub        = raw.get("sub_type", raw.get("sos_type", ""))
    conf       = raw.get("confidence", 0.0)
    n_men      = raw.get("surrounding_count", 2)

    descriptions = {
        "sos_gesture":       f"SOS signal: {sub} (confidence {conf:.0%})",
        "person_surrounded": f"Surrounded by {n_men} men nearby",
        "proximity_warning": "Man in close proximity detected",
    }

    ts       = raw.get("timestamp", datetime.now(timezone.utc).isoformat())
    if ts and not ts.endswith("Z") and "+" not in ts:
        ts = ts + "Z"
    track_id = raw.get("track_id", 0)

    return {
        "id":          f"{track_id}_{ts}",
        "title":       _ALERT_TITLES.get(alert_type, "Safety Alert"),
        "description": descriptions.get(alert_type, ""),
        "camera_id":   "cam_001",
        "camera_name": "Main Camera",
        "location":    "Main Camera Zone",
        "severity":    raw.get("severity", "medium"),
        "alert_type":  alert_type,
        "status":      "new",
        "timestamp":   ts,
    }


# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting EmpowerHer backend...")
    try:
        from video_processor import init_processor
        proc = init_processor(VIDEO_PATH, MODEL_PATH)
        proc._loop = asyncio.get_running_loop()
        proc.start()
        app.state.processor = proc
        logger.info("✅ VideoProcessor started")
    except Exception as e:
        logger.error(f"❌ Startup error: {e}", exc_info=True)
        raise

    yield

    logger.info("🛑 Shutting down...")
    try:
        app.state.processor.stop()
    except Exception as e:
        logger.error(f"Shutdown error: {e}")


app = FastAPI(title="EmpowerHer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── MJPEG stream ───────────────────────────────────────────────────────────────
def _mjpeg_generator(proc):
    import cv2
    import numpy as np

    ph = np.full((480, 640, 3), 30, dtype=np.uint8)
    cv2.putText(ph, "Loading model...", (150, 240),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
    _, buf = cv2.imencode(".jpg", ph)
    placeholder = buf.tobytes()

    while True:
        jpeg = proc.get_jpeg() or placeholder
        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n")
        time.sleep(0.04)


@app.get("/api/stream/{camera_id:path}")
async def mjpeg_stream(camera_id: str):
    proc = app.state.processor
    return StreamingResponse(
        _mjpeg_generator(proc),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ── WebSocket ──────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    proc = app.state.processor
    proc.ws_clients.add(ws)
    logger.info(f"WS connected ({len(proc.ws_clients)} total)")
    try:
        # Send immediately on connect
        await ws.send_json({
            "type": "stats_update",
            "data": _make_dashboard_stats(proc),
        })
        while True:
            await asyncio.sleep(2)
            recent_raw = proc.get_recent_alerts()[-5:]
            await ws.send_json({
                "type":   "stats_update",
                "data":   _make_dashboard_stats(proc),
                "alerts": [_make_alert(a) for a in recent_raw],
            })
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        proc.ws_clients.discard(ws)
        logger.info(f"WS disconnected ({len(proc.ws_clients)} total)")


# ── REST ───────────────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "online", "service": "EmpowerHer Safety API"}


@app.get("/api/health")
async def health():
    proc  = app.state.processor
    stats = proc.get_stats()
    return {
        "status":      "healthy",
        "fps":         stats.get("fps", 0),
        "model_ready": proc._detector is not None,
    }


@app.get("/api/stats")
async def get_stats():
    return _make_dashboard_stats(app.state.processor)


@app.get("/api/alerts")
async def get_alerts(limit: int = 50):
    raw = app.state.processor.get_recent_alerts()
    return [_make_alert(a) for a in raw[-limit:]]


@app.get("/api/alerts/recent")
async def recent_alerts():
    raw = app.state.processor.get_recent_alerts()[-10:]
    return [_make_alert(a) for a in raw]


@app.get("/api/cameras")
async def get_cameras():
    return [
        {
            "id":          "cam_001",
            "camera_id":   "cam_001",
            "name":        "Main Camera",
            "location":    "Main Entrance",
            "status":      True,
            "stream_url":  f"http://localhost:{PORT}/api/stream/cam_001",
            "rtsp_url":    "",
            "latitude":    13.1489,
            "longitude":   78.1686,
            "model_desc":  "EmpowerHer YOLOv8",
            "alert_count": len(app.state.processor.get_recent_alerts()),
            "created_at":  datetime.now(timezone.utc).isoformat(),
        }
    ]


@app.get("/api/hotspots")
async def get_hotspots():
    alerts = app.state.processor.get_recent_alerts()
    high   = sum(1 for a in alerts if a.get("severity") == "high")
    med    = sum(1 for a in alerts if a.get("severity") == "medium")
    return [
        {
            "camera_id":    "cam_001",
            "camera_name":  "Main Camera",
            "location":     "Main Entrance",
            "latitude":     13.1489,
            "longitude":    78.1686,
            "total_alerts": len(alerts),
            "high_count":   high,
            "medium_count": med,
            "low_count":    0,
        }
    ]


# ── Alert status (local-only, no DB needed) ────────────────────────────────────
@app.patch("/api/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str):
    return {"id": alert_id, "status": "acknowledged"}


@app.patch("/api/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str):
    return {"id": alert_id, "status": "resolved"}


if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)