from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # `neon deploy` / `neon env pull` write these into the repo-root env file.
    # Pooled URL for app traffic; direct (unpooled) URL for migrations.
    database_url: str
    database_url_unpooled: str | None = None
    groq_api_key: str | None = None

    cors_origins: list[str] = ["http://localhost:3000"]

    # Hosted demo: the web app sends this key; without it the API answers nothing but /health.
    api_shared_key: str | None = None
    # Questions that may reach the AI, per hour: protects the provider's free-tier quota.
    ask_limit_per_hour: int = 60
    ask_limit_per_persona_per_hour: int = 20

    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", REPO_ROOT / ".env.local"),
        extra="ignore",
    )

    @property
    def migration_url(self) -> str:
        return self.database_url_unpooled or self.database_url


settings = Settings()
