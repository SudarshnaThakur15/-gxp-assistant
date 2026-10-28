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

    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", REPO_ROOT / ".env.local"),
        extra="ignore",
    )

    @property
    def migration_url(self) -> str:
        return self.database_url_unpooled or self.database_url


settings = Settings()
