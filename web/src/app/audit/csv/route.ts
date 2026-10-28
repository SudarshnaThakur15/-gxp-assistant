import { getRaw } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

// The API applies the same payload rule as the audit page: payloads only for signers.
export async function GET() {
  const { current } = await getCurrentPersona();
  const res = await getRaw(`/audit.csv?persona=${encodeURIComponent(current.id)}`);
  if (!res.ok) {
    return new Response("The audit trail could not be exported.", { status: 502 });
  }
  return new Response(res.body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="audit-trail.csv"',
    },
  });
}
