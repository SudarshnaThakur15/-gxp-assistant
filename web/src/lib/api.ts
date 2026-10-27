import "server-only";

// The Python API owns all data access; the web app only calls it server-side.
const API_URL = process.env.API_URL ?? "http://localhost:8000";

export type DbHealth = {
  status: string;
  database: string;
  server_version: string;
  pooled: boolean;
  pgvector: string | null;
  vector_distance_check: number | null;
  write_read_roundtrip: boolean;
  latency_ms: number;
};

export async function getDbHealth(): Promise<DbHealth> {
  const res = await fetch(`${API_URL}/health/db`);
  if (!res.ok) {
    throw new Error(`API /health/db returned ${res.status}`);
  }
  return res.json();
}
