"""Shared SQLAlchemy session-factory configuration for platform processes."""

from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker


def build_session_factory_from_env():
    url = URL.create(
        os.getenv("DB_DRIVER", "mysql+mysqlconnector"),
        username=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", "root"),
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3307")),
        database=os.getenv("DB_NAME", "testdb"),
    )
    engine = create_engine(
        url,
        future=True,
        pool_pre_ping=True,
        pool_recycle=1800,
        isolation_level="READ COMMITTED",
        connect_args={"time_zone":"+00:00"} if url.drivername.startswith("mysql") else {},
    )
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

