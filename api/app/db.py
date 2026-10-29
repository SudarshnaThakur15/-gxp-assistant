"""Database connections. Every connection gets network timeouts.

Without them, a silently dropped TCP connection (Wi-Fi blip, broken route) blocks
a request for 15–30 minutes while the kernel keeps retransmitting. Seen for real:
an evaluation run froze with 5 KB stuck in the socket's send queue.
"""

import time

import psycopg
from psycopg_pool import ConnectionPool

from app.config import settings

NETWORK_TIMEOUTS = {
    "connect_timeout": 10,       # seconds to establish a connection
    "tcp_user_timeout": 15000,   # ms that sent data may stay unacknowledged before the socket is closed
    "keepalives": 1,             # probe idle connections so dead ones are noticed
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 3,
}


def connect(*, pooled: bool = True, **kwargs) -> psycopg.Connection:
    """Pooled URL for app traffic; direct URL for migrations, ingestion and admin work."""
    if pooled:
        # Neon's pooled endpoint is PgBouncer in transaction mode: no server-side prepared statements.
        return psycopg.connect(settings.database_url, prepare_threshold=None, **NETWORK_TIMEOUTS, **kwargs)
    return psycopg.connect(settings.migration_url, **NETWORK_TIMEOUTS, **kwargs)


# Neon closes idle connections (and suspends an idle database), so a pooled connection can be dead
# when it is handed out. A connection that has been idle for a while is tested first and replaced if
# needed; a recently used one is not (each test is a network round trip). max_idle retires
# connections before the server would close them.
CHECK_AFTER_IDLE_S = 20
_returned_at: dict[int, float] = {}


def _mark_returned(conn: psycopg.Connection) -> None:
    _returned_at[id(conn)] = time.monotonic()


def _check_if_idle(conn: psycopg.Connection) -> None:
    if time.monotonic() - _returned_at.get(id(conn), 0) > CHECK_AFTER_IDLE_S:
        ConnectionPool.check_connection(conn)


def _pool(**kwargs) -> ConnectionPool:
    return ConnectionPool(
        settings.database_url,
        min_size=1,
        max_size=5,
        kwargs={"prepare_threshold": None, **NETWORK_TIMEOUTS, **kwargs},
        check=_check_if_idle,
        reset=_mark_returned,
        max_idle=240,
        open=False,
    )


# Writes (asking, signing) need transactions: the audit entry and its checks commit together.
pool = _pool()
# Read-only pages need none: autocommit saves the BEGIN and COMMIT round trips on every request.
read_pool = _pool(autocommit=True)
