import os
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "women_safety")

# Async client (for FastAPI endpoints)
async_client: AsyncIOMotorClient = None
async_db = None

# Sync client (for background thread)
sync_client: MongoClient = None
sync_db = None


def get_sync_db():
    global sync_client, sync_db
    if sync_client is None:
        sync_client = MongoClient(MONGODB_URI)
        sync_db = sync_client[MONGODB_DB]
    return sync_db


async def connect_db():
    global async_client, async_db
    async_client = AsyncIOMotorClient(MONGODB_URI)
    async_db = async_client[MONGODB_DB]
    # Create indexes
    await async_db.alerts.create_index([("timestamp", -1)])
    await async_db.alerts.create_index([("severity", 1)])
    await async_db.cameras.create_index([("name", 1)])
    print(f"✅ Connected to MongoDB: {MONGODB_URI}/{MONGODB_DB}")


async def disconnect_db():
    global async_client
    if async_client:
        async_client.close()


def get_async_db():
    return async_db
