from psycopg_pool import ConnectionPool

from app.config import settings

# Neon's pooled endpoint is PgBouncer in transaction mode, so disable
# psycopg's automatic server-side prepared statements.
pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=5,
    kwargs={"prepare_threshold": None},
    open=False,
)
