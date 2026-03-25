from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from bson import ObjectId
from pydantic import field_validator


class PyObjectId(str):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v, _info=None):
        if not ObjectId.is_valid(str(v)):
            raise ValueError("Invalid ObjectId")
        return str(v)


# ─── Camera Models ────────────────────────────────────────────────────────────

class CameraCreate(BaseModel):
    name: str
    location: str = ""
    rtsp_url: str = "demo"
    latitude: float = 13.1489
    longitude: float = 78.1686
    model_desc: str = ""
    status: bool = True


class CameraUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    rtsp_url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    model_desc: Optional[str] = None
    status: Optional[bool] = None


class Camera(BaseModel):
    id: str
    name: str
    location: str
    rtsp_url: str
    latitude: float
    longitude: float
    model_desc: str
    status: bool
    last_active: Optional[datetime] = None
    created_at: datetime
    alert_count: int = 0


# ─── Alert Models ─────────────────────────────────────────────────────────────

class Alert(BaseModel):
    id: str
    title: str
    description: str
    camera_id: str
    camera_name: str
    location: str
    severity: str           # "high" | "medium" | "low" | "safe"
    alert_type: str         # "sos_gesture" | "surrounded" | "lone_woman" | "nighttime" | "safe"
    status: str = "new"     # "new" | "acknowledged" | "resolved"
    timestamp: datetime
    latitude: Optional[float] = None
    longitude: Optional[float] = None


# ─── Stats Models ─────────────────────────────────────────────────────────────

class SafetyMetrics(BaseModel):
    lone_women: int = 0
    surrounded: int = 0
    sos_gestures: int = 0
    safe_interactions: int = 0
    total_women: int = 0


class DashboardStats(BaseModel):
    women_monitored: int = 0
    men_detected: int = 0
    alerts_today: int = 0
    hotspot_areas: int = 0
    safety_metrics: SafetyMetrics = SafetyMetrics()


# ─── WebSocket Messages ───────────────────────────────────────────────────────

class DetectionBox(BaseModel):
    track_id: int
    label: str          # "woman" | "man"
    confidence: float
    x: int
    y: int
    w: int
    h: int
    sos: bool = False
    surrounded: bool = False


class WSDetectionUpdate(BaseModel):
    type: str = "detection_update"
    camera_id: str
    severity: str
    detections: List[DetectionBox]
    frame_women: int
    frame_men: int


class WSStatsUpdate(BaseModel):
    type: str = "stats_update"
    data: DashboardStats


class WSNewAlert(BaseModel):
    type: str = "new_alert"
    alert: Alert
