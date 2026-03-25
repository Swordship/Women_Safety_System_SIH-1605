"""
main.py — EmpowerHer FastAPI backend
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

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


# ── Lifespan ──────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting EmpowerHer backend...")

    try:
        from video_processor import init_processor
        proc = init_processor(VIDEO_PATH, MODEL_PATH)

        # FIX: use get_running_loop() not get_event_loop() in async context
        proc._loop = asyncio.get_running_loop()
        proc.start()

        app.state.processor = proc
        logger.info("✅ VideoProcessor thread started — model loading in background")
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


# ── MJPEG stream ─────────────────────────────────────────────────
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
    # FIX: accept any camera_id including "undefined" — always serve the same stream
    proc = app.state.processor
    return StreamingResponse(
        _mjpeg_generator(proc),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ── WebSocket ─────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    proc = app.state.processor
    proc.ws_clients.add(ws)
    logger.info(f"WS connected ({len(proc.ws_clients)} total)")
    try:
        # Send immediate stats on connect so dashboard gets data right away
        await ws.send_json({"type": "stats", "stats": proc.get_stats()})
        while True:
            await asyncio.sleep(1)
            stats = proc.get_stats()
            recent = proc.get_recent_alerts()[-5:]
            await ws.send_json({
                "type":   "stats",
                "stats":  stats,
                "alerts": recent,
            })
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        proc.ws_clients.discard(ws)
        logger.info(f"WS disconnected ({len(proc.ws_clients)} total)")


# ── REST ──────────────────────────────────────────────────────────
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
    return app.state.processor.get_stats()


@app.get("/api/alerts")
async def get_alerts(limit: int = 50):
    """
    Returns a plain list so Dashboard.tsx can call .map() directly.
    Frontend does: const alerts = await fetch('/api/alerts?limit=5').then(r => r.json())
    then: alerts.map(...)   ← works because this is now an array
    """
    all_alerts = app.state.processor.get_recent_alerts()
    return all_alerts[-limit:]


@app.get("/api/cameras")
async def get_cameras():
    # FIX: return BOTH id and camera_id so frontend works regardless of which field it reads
    return [
        {
            "id":         "cam_001",
            "camera_id":  "cam_001",
            "name":       "Main Camera",
            "status":     "active",
            "stream_url": f"http://localhost:{PORT}/api/stream/cam_001",
            "rtsp_url":   "",
        }
    ]


@app.get("/api/alerts/recent")
async def recent_alerts():
    return app.state.processor.get_recent_alerts()[-10:]


if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)