import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from .config import settings

logger = logging.getLogger("app.database")

db_url = settings.database_url or ""
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

# Detect unreplaced placeholders in DATABASE_URL and fallback to local SQLite for seamless local dev
if "[PROJECT-REF]" in db_url or "[PASSWORD]" in db_url or not db_url:
    logger.warning("Supabase placeholder detected in DATABASE_URL. Using local SQLite database (recon_dev.db).")
    db_url = "sqlite:///./recon_dev.db"

connect_args = {"check_same_thread": False} if db_url.startswith("sqlite") else {}
engine_kwargs = {"pool_pre_ping": True} if not db_url.startswith("sqlite") else {"connect_args": connect_args}

engine = create_engine(db_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
