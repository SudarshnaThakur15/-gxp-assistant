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

// For actions: the caller decides what an error status means.
export async function postJson<T>(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; status: number; detail: unknown }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return res.ok ? { ok: true, data: json as T } : { ok: false, status: res.status, detail: json?.detail ?? null };
}

export function getRaw(path: string): Promise<Response> {
  return fetch(`${API_URL}${path}`);
}

const q = encodeURIComponent;

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
  role: "qa_analyst" | "qa_manager" | "auditor";
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

export type Outcome = "released" | "not_found" | "held" | "approved" | "rejected" | "refused";
export type Filter = "released" | "held" | "decided" | "refused";

export type Citation = {
  n: number;
  doc: string;
  version: string;
  section: string;
  page: number | null;
  quotes: string[];
  title?: string | null;
};

export type Check = {
  id: string;
  title: string;
  severity: "hard" | "review";
  status: "pass" | "fail" | "fixed" | "skip";
  detail: string | null;
};

export type RunSummary = {
  seq: number;
  recorded_at: string;
  question: string;
  test: boolean;
  requested_by: { id: string; name: string };
  outcome: Outcome;
  label: string;
  tier: string;
  reason: string | null;
  model: string | null;
  ruleset_version: string;
};

export type RunList = { counts: Record<"all" | Filter, number>; runs: RunSummary[] };

export type Llm = {
  model: string;
  provider: string;
  input_tokens?: number;
  output_tokens?: number;
  rate_limit_wait_s?: number;
};

export type Gate = {
  n: number;
  gate: string;
  by: string;
  result: string;
  rules?: { rule: string; title: string }[];
  ai_intent?: string | null;
  ai_reason?: string | null;
  llm?: Llm | null;
  prompt?: { version: string; fingerprint: string } | null;
  passages?: { doc: string; version: string; section: string; score: number; injection_flagged: boolean }[];
  excluded?: { reason: string; document: string | null }[];
  best_similarity?: number | null;
  claims?: number;
  summary?: { checks: number; failed: string[] };
  reasons?: string[];
  audit_seq?: number;
  audit_hash?: string;
};

export type HistoryEvent = {
  seq: number;
  recorded_at: string;
  actor: string;
  event_type: string;
  hash: string;
  text: string;
};

export type Review = {
  audit_seq: number;
  audit_hash: string;
  outcome: string;
  signature: string;
  reason: string | null;
  content_hash: string;
};

export type RunDetail = {
  seq: number;
  recorded_at: string;
  hash: string;
  prev_hash: string;
  question: string;
  test: boolean;
  requested_by: { id: string; name: string };
  outcome: Outcome;
  label: string;
  decision: string;
  answer_type: string;
  tier: string;
  reasons: string[];
  error: string | null;
  answer: { text: string; withheld: boolean; citations?: Citation[]; notices?: string[] } | null;
  rule_sources: Citation[]; // a refusal: the approved documents its rule rests on
  checks: Check[];
  trace: Gate[];
  model: string | null;
  ruleset: { version: string; fingerprint: string };
  ms: Record<string, number>;
  review: Review | null;
  can_review: boolean;
  history: HistoryEvent[];
};

export type QueueItem = {
  ask_seq: number;
  requested_by: string;
  question: string;
  tier: string;
  reasons: string[];
  text: string;
  citations: Citation[];
  content_hash: string;
};

export type AuditEntry = {
  seq: number;
  recorded_at: string;
  actor: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  prev_hash: string;
  hash: string;
};

// What POST /ask returns to the requester (pipeline.public_view).
export type AskResult = {
  decision: "released" | "held_for_review" | "refused";
  decision_label: string;
  answer_type: string;
  tier: string;
  reasons: string[];
  message: string;
  citations: Citation[];
  notices: string[];
  receipt: { audit_seq: number; audit_hash: string; ruleset_version: string };
  gates: { n: number; gate: string; by: string; result: string }[];
  ms: Record<string, number>;
};

export type SignResult = {
  ask_seq: number;
  outcome: "approved" | "rejected";
  signature: string;
  content_hash: string;
  receipt: { audit_seq: number; audit_hash: string };
};

// Fetch first, render after: keeps JSX out of try/catch.
export async function settle<T>(
  promise: Promise<T>,
): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    return { data: await promise, error: null };
  } catch (error) {
    return { data: null, error: (error as Error).message };
  }
}

export const getDbHealth = () => getJson<DbHealth>("/health/db");
export const getPersonas = () => getJson<Persona[]>("/personas");
export const verifyAudit = () => getJson<AuditVerification>("/audit/verify");
export const getRuns = (persona: string, filter?: string) =>
  getJson<RunList>(`/runs?persona=${q(persona)}${filter ? `&filter=${q(filter)}` : ""}`);
export const getRun = (persona: string, seq: number) => getJson<RunDetail>(`/runs/${seq}?persona=${q(persona)}`);
export const getReviewCount = (persona: string) => getJson<{ waiting: number }>(`/reviews/count?persona=${q(persona)}`);
export const getQueue = (persona: string) => getJson<QueueItem[]>(`/reviews?persona=${q(persona)}`);
export const getAudit = (persona: string, limit: number, before?: number) =>
  getJson<AuditEntry[]>(`/audit?persona=${q(persona)}&limit=${limit}${before ? `&before=${before}` : ""}`);

export type DocVersion = { version: string; status: string; effective_date: string | null };

export type DocumentSummary = {
  code: string;
  title: string;
  version: string;
  status: string;
  doc_type: string;
  effective_date: string | null;
  owner: string | null;
  client_id: string | null;
  regulatory_status: string | null;
  record_state: string | null;
  source_format: string;
  sections: number;
  versions: DocVersion[];
};

export type DocumentDetail = Omit<DocumentSummary, "sections"> & {
  review_date: string | null;
  required_qualifier: string | null;
  source_url: string | null;
  fingerprint: string | null;
  sections: { path: string; heading: string | null; page: number | null; text: string }[];
};

export type AssuranceInfo = {
  ruleset: { version: string; fingerprint: string };
  screen_rules: { id: string; title: string; note: string; sources?: string[] }[];
  checks: { id: string; title: string; severity: "hard" | "review"; note: string }[];
  tier_rules: { id: string; rule: string; outcome: string }[];
  stats: {
    counts: Record<string, number>;
    failed_checks: Record<string, number>;
    rulesets: Record<string, number>;
    audit: { entries: number; ok: boolean };
  };
};

export type LabCase = {
  id: string;
  kind: string;
  name: string;
  question: string;
  claims: { text: string; source: string; quote: string }[];
  expected: string;
  actual: string;
  expected_trigger: string | null;
  triggered: string[];
  notices: string[];
  as_expected: boolean;
};

export type Lab = { ruleset_version: string; cases: LabCase[]; passed: number; total: number };

export const getDocuments = (persona: string) => getJson<DocumentSummary[]>(`/documents?persona=${q(persona)}`);
export const getDocument = (persona: string, code: string, version?: string) =>
  getJson<DocumentDetail>(`/documents/${q(code)}?persona=${q(persona)}${version ? `&version=${q(version)}` : ""}`);
export const getAssurance = () => getJson<AssuranceInfo>("/assurance");
export const getLab = () => getJson<Lab>("/assurance/lab");

export type Trust = {
  counts: Record<string, number>;
  boundary: {
    ai_model: string;
    ai_provider: string;
    ai_note: string;
    embedding_model: string;
    embedding_note: string;
    database: string;
    ruleset_version: string;
  };
  audit: { ok: boolean; entries: number; head_hash: string | null };
  safeguards: { name: string; how: string; ok: boolean | null }[];
  recent_calls: {
    seq: number;
    recorded_at: string;
    question: string;
    asked_by: string;
    model: string | null;
    tokens: number;
    ai_did: string;
    rules_did: string;
    person_did: string;
  }[];
};

type Decision = "released" | "held_for_review" | "refused";

export type Proof =
  | { available: false }
  | {
      available: true;
      recorded_at: string;
      runs: number;
      ruleset: { version: string; fingerprint: string };
      model: string;
      flaky: string[];
      rates: Record<"overall" | "tune" | "clean_holdout" | "contaminated_holdout", string>;
      results: {
        id: string;
        split: string;
        contaminated: boolean;
        persona: string;
        question: string;
        expected: Decision;
        actual: Decision;
        answer_type: string;
        tier: string;
        pass: boolean;
        failures: string[];
        audit_seq: number;
      }[];
      matrix: Record<Decision, Record<Decision, number>>;
      unsafe_releases: number;
    };

export type Sources = {
  documents: { format: string; tenant: string; client: string | null; status: string; count: number }[];
  last_run: {
    audit_seq: number;
    recorded_at: string;
    ingested: string[];
    unchanged: number;
    metadata_updated: string[];
    withdrawn: string[];
    rejected: { source: string; problems: string[] }[];
    failed: unknown[];
  } | null;
};

export const getTrust = (persona: string) => getJson<Trust>(`/trust?persona=${q(persona)}`);
export const getProof = () => getJson<Proof>("/proof");
export const getSources = () => getJson<Sources>("/sources");
