"""Database connections. Every connection gets network timeouts.

Without them, a silently dropped TCP connection (Wi-Fi blip, broken route) blocks
a request for 15–30 minutes while the kernel keeps retransmitting. Seen for real:
an evaluation run froze with 5 KB stuck in the socket's send queue.
"""

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


pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=5,
    kwargs={"prepare_threshold": None, **NETWORK_TIMEOUTS},
    open=False,
)
