from sqlalchemy import Column, Integer, String, Boolean
from sqlalchemy.sql import func
from app.database import Base, UTCDateTime


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    language = Column(String(5), default="en", nullable=False)  # "en" or "ru"
    created_at = Column(UTCDateTime, server_default=func.now())
