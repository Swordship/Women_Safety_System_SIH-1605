# EmpowerHer Safety Analytics System

Women's Safety Surveillance Dashboard — FastAPI + YOLOv8 + MediaPipe + React

---

## Project Structure

```
women_safety_system/
├── backend/
│   ├── main.py               ← FastAPI app, all REST + WebSocket + MJPEG
│   ├── detector.py           ← YOLOv8 + MediaPipe SOS + proximity analysis
│   ├── video_processor.py    ← Background thread: loop video, detect, alert
│   ├── database.py           ← MongoDB (motor async + pymongo sync)
│   ├── models.py             ← Pydantic request/response schemas
│   ├── requirements.txt
│   ├── .env                  ← Configuration (edit MONGODB_URI here)
│   └── models/
│       └── best.pt           ← ← ← PUT YOUR YOLO MODEL HERE
└── frontend/
    ├── src/
    │   ├── App.tsx
    │   ├── pages/
    │   │   ├── Dashboard.tsx
    │   │   ├── SafetyMap.tsx
    │   │   ├── Cameras.tsx
    │   │   └── Alerts.tsx
    │   ├── components/
    │   │   ├── Sidebar.tsx
    │   │   └── AddCameraModal.tsx
    │   ├── hooks/useWebSocket.ts
    │   ├── lib/{api.ts, utils.ts}
    │   └── types/index.ts
    ├── package.json
    └── vite.config.ts
```

---

## Prerequisites

- Python 3.10+
- Node.js 18+ (or Bun)
- MongoDB running locally

---

## Step 1 — Start MongoDB

Make sure MongoDB is running:

```bash
# Windows
net start MongoDB

# macOS/Linux
brew services start mongodb-community
# or
sudo systemctl start mongod
```

**MongoDB URI** (already set in `.env`):
```
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=women_safety
```

---

## Step 2 — Backend Setup

```bash
cd women_safety_system/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate       # macOS/Linux
# venv\Scripts\activate        # Windows

# Install dependencies
pip install -r requirements.txt
```

### Place your files:

1. **YOLOv8 model** → copy `best.pt` to `backend/models/best.pt`
2. **Demo video** → copy your MP4 to `backend/sample_video.mp4`

> If `sample_video.mp4` is missing, the system shows a placeholder frame and still runs.

### Configure `.env` (already correct for local MongoDB):

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=women_safety
VIDEO_PATH=./sample_video.mp4
MODEL_PATH=./models/best.pt
HOST=0.0.0.0
PORT=8000
```

### Start backend:

```bash
python main.py
```

Backend runs at: **http://localhost:8000**
API docs at: **http://localhost:8000/docs**

---

## Step 3 — Frontend Setup

```bash
cd women_safety_system/frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend runs at: **http://localhost:5173**

---

## Features

| Feature | Details |
|---------|---------|
| **Live Detection** | YOLOv8 gender detection on looped MP4 video |
| **SOS Gesture** | MediaPipe Pose — both wrists raised above shoulders |
| **Surrounded Analysis** | Proximity check: woman with 2+ men nearby |
| **Severity Colors** | High = Red, Medium = Orange, Low = Blue, Safe = Green |
| **MJPEG Stream** | Annotated live feed at `/api/stream/{camera_id}` |
| **WebSocket** | Real-time stats + alerts pushed to dashboard |
| **Safety Map** | OpenStreetMap + Leaflet with hotspot markers |
| **Alert Log** | MongoDB-stored alerts with acknowledge/resolve |
| **Camera CRUD** | Add, edit, delete cameras via UI |

---

## API Endpoints

```
GET  /api/stats                     ← Dashboard stats
GET  /api/cameras                   ← List cameras
POST /api/cameras                   ← Create camera
PUT  /api/cameras/{id}              ← Update camera
DEL  /api/cameras/{id}              ← Delete camera
GET  /api/alerts                    ← List alerts (?severity=high&status=new)
PATCH /api/alerts/{id}/acknowledge  ← Acknowledge alert
PATCH /api/alerts/{id}/resolve      ← Resolve alert
GET  /api/hotspots                  ← Safety map hotspot data
GET  /api/stream/{camera_id}        ← MJPEG annotated video stream
WS   /ws                            ← WebSocket for live updates
GET  /api/health                    ← System health check
```

---

## Severity Logic

| Condition | Severity |
|-----------|----------|
| SOS gesture detected | **HIGH** |
| Woman surrounded by 3+ men | **HIGH** |
| Woman surrounded by 2 men | **MEDIUM** |
| Lone woman with men nearby | **MEDIUM** |
| Women detected, no threat | **SAFE** |

---

## Alert Cooldown

Same alert type per camera is suppressed for **30 seconds** to avoid spam.

---

## Tech Stack

**Backend:** FastAPI, Uvicorn, Motor (async MongoDB), PyMongo, YOLOv8 (Ultralytics), MediaPipe, OpenCV, Python-dotenv

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, React Router v6, Recharts, React-Leaflet, Lucide React

**Database:** MongoDB (local, no Docker)
