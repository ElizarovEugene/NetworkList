import base64
import hashlib
from datetime import timezone

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import create_engine, event, DateTime, String
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.types import TypeDecorator
from app.core.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)

if "sqlite" in settings.database_url:
    # The scanner commits after nearly every host it touches — under SQLite's
    # default rollback-journal mode that's an fsync per commit. WAL +
    # synchronous=NORMAL keeps durability against app crashes (just not OS
    # crashes) while cutting that fsync cost dramatically.
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class UTCDateTime(TypeDecorator):
    """DateTime that round-trips as UTC even on SQLite.

    SQLite has no native timezone-aware datetime type, so plain
    DateTime(timezone=True) silently drops tzinfo on this dialect —
    values come back naive and every caller has to remember they're
    UTC. This type re-attaches tzinfo=UTC on read so the rest of the
    app (and JSON serialization) sees a real offset.
    """
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


# Fernet needs a 32-byte url-safe base64 key — derive one from the configured
# passphrase so settings.db_encryption_key can stay a plain human-set string,
# same ergonomics as jwt_secret.
_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(settings.db_encryption_key.encode()).digest()))


class EncryptedString(TypeDecorator):
    """Encrypts a column at rest (SSH passwords, SNMP community strings) so
    a stolen/leaked .db file or backup doesn't hand out plaintext credentials.

    Falls back to returning unrecognized values as-is on read — lets rows
    written before this column existed (plaintext) keep working; they're
    re-encrypted the next time that row is saved.
    """
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return _fernet.encrypt(value.encode()).decode()

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        try:
            return _fernet.decrypt(value.encode()).decode()
        except InvalidToken:
            return value


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
