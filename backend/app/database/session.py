"""
SQLAlchemy engine and session management.

Supports both SQLite (development) and PostgreSQL (production)
via DATABASE_URL — no code changes required when switching databases.
"""

from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

settings = get_settings()

# ─── Engine ───────────────────────────────────────────────────────────────────

# SQLite-specific: enable WAL mode and foreign key enforcement
_connect_args = {}
if settings.database_url.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.database_url,
    connect_args=_connect_args,
    # For PostgreSQL, connection pooling is handled by SQLAlchemy defaults.
    # For SQLite we keep it simple — single writer, WAL for concurrent reads.
    echo=(settings.app_env == "development"),
)

# Enable SQLite foreign keys and WAL mode per connection
if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


# ─── Session Factory ──────────────────────────────────────────────────────────

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)


# ─── Dependency ───────────────────────────────────────────────────────────────

def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that yields a database session and
    guarantees it is closed after the request, even on errors.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Table Initialisation ─────────────────────────────────────────────────────

def init_db() -> None:
    """
    Create all tables if they do not already exist.
    Called once at application startup.
    Safe to call repeatedly — does not drop existing tables.
    """
    from app.models.db_models import Base  # imported here to avoid circular imports
    Base.metadata.create_all(bind=engine)
