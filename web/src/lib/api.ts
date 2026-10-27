import "server-only";

// The Python API owns all data access; the web app only calls it server-side.
const API_URL = process.env.API_URL ?? "http://localhost:8000";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}`);
  }
  return res.json();
}

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

export type Persona = {
  id: string;
  name: string;
  title: string;
  role: "qa_analyst" | "qa_manager";
  can_sign: boolean;
  organisation: string;
  clients: string[];
};

export type AuditVerification = {
  ok: boolean;
  entries: number;
  broken_at: number | null;
  reason: string | null;
  head_hash: string | null;
};

// Fetch first, render after: keeps JSX out of try/catch.
export async function settle<T>(promise: Promise<T>): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    return { data: await promise, error: null };
  } catch (error) {
    return { data: null, error: (error as Error).message };
  }
}

export const getDbHealth = () => getJson<DbHealth>("/health/db");
export const getPersonas = () => getJson<Persona[]>("/personas");
export const verifyAudit = () => getJson<AuditVerification>("/audit/verify");
