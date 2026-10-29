import Link from "next/link";
import { Suspense } from "react";

import { AnswerCard } from "@/components/answer-card";
import { SignForm } from "@/components/sign-form";
import { Card, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { getRun, settle } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export default function RunPage(props: PageProps<"/runs/[seq]">) {
  return (
    <>
      <Link href="/runs" className="text-sm font-medium text-brand-text hover:underline">← Questions</Link>
      <Suspense fallback={<Skeleton lines={5} />}>
        <Run params={props.params} />
      </Suspense>
    </>
  );
}

async function Run({ params }: { params: PageProps<"/runs/[seq]">["params"] }) {
  const raw = (await params).seq;
  const seq = Number(raw);
  const persona = await settle(getCurrentPersona());
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  const me = persona.data.current;
  const res = Number.isInteger(seq) ? await settle(getRun(me.id, seq)) : null;
  if (!res?.data) {
    return (
      <ErrorNote>
        Question #{raw} is not visible to {me.name}. A question is visible to the person who asked it, to the QA Managers
        who cover their programme, and to auditors.
      </ErrorNote>
    );
  }
  const run = res.data;

  return (
    <>
      <PageHeader eyebrow={`Question #${run.seq} · asked by ${run.requested_by.name}${run.test ? " (test account)" : ""}`} title={run.question} />
      <p className="-mt-2 text-sm text-muted">
        {run.standalone_question && <>A follow-up, understood as: <span className="text-strong">{run.standalone_question}</span> · </>}
        <Link href={`/c/${run.chat.id}#run-${run.seq}`} className="font-medium text-brand-text hover:underline">
          {run.chat.turn > 1 ? "See the whole chat →" : "Open as a chat →"}
        </Link>
      </p>
      <div className={run.can_review ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]" : ""}>
        <AnswerCard run={run} viewerId={me.id} />
        {run.can_review && (
          <div className="xl:sticky xl:top-6 xl:self-start">
            <Card title="Your decision">
              <SignForm askSeq={run.seq} signerName={me.name} />
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
