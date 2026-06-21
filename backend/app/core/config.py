from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    app_name: str = "NetworkList"
    database_url: str = f"sqlite:///{BASE_DIR}/networklist.db"
    # Scan defaults
    scan_timeout: int = 2          # seconds per ping
    # -Pn: liveness was already established by the ping/ARP sweep that picks
    # this host as a scan target — letting nmap re-run its own (weaker, ARP-
    # less off the local segment) host discovery here can flip an already
    # confirmed-up host back to "down" and skip its port/OS scan entirely.
    nmap_args: str = "-sV -O --osscan-guess -T4 --top-ports 100 -Pn"
    snmp_community: str = "public"
    snmp_timeout: int = 2
    snmp_retries: int = 1
    ssh_timeout: int = 10
    # Home-lab vCenters typically run on a self-signed cert — defaulting to
    # True keeps that working out of the box. Deployments with a real CA-
    # signed vCenter cert should set this to False in .env to get actual
    # TLS verification instead of silently skipping it.
    vcenter_insecure_tls: bool = True
    max_scan_workers: int = 50
    host_check_retention_days: int = 30
    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_expire_minutes: int = 480
    admin_username: str = "admin"
    admin_password: str = "admin"
    # The UI supports two languages — "en" and "ru" — picked per-user on the
    # Users page, not by a global switch. This only sets the language for
    # the admin account auto-created on first run; override in .env if the
    # admin should start in Russian instead.
    admin_language: str = "en"
    db_encryption_key: str = "change-me-in-production"

    class Config:
        env_file = BASE_DIR / ".env"


settings = Settings()
