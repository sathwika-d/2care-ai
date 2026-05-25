"""
MedVoice FastAPI application entry point.
"""
from contextlib import asynccontextmanager
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import init_db
from app.api.routes import router as api_router
from app.api.voice import router as voice_router

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("startup", app=settings.app_name, env=settings.environment)
    await init_db()
    yield
    logger.info("shutdown")


app = FastAPI(
    title="MedVoice API",
    description="Real-time multilingual voice AI agent for clinical appointment booking",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://medvoice.2care.ai"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")
app.include_router(voice_router)


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.app_name}


@app.get("/")
async def root():
    return {
        "app": "MedVoice",
        "version": "1.0.0",
        "docs": "/docs",
        "ws": "/ws/voice"
    }
