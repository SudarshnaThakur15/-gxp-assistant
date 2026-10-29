import Link from "next/link";

import { AnswerCard } from "@/components/answer-card";
import { ChatThread } from "@/components/chat-thread";
import { LinkPending } from "@/components/pending";
import { ErrorNote, Eyebrow } from "@/components/ui";
import { getChat, getRuns, settle, type Persona, type RunDetail, type RunSummary } from "@/lib/api";
import { plainReasons, STATUS } from "@/lib/plain";

const DOT: Record<string, string> = { ok: "bg-ok", wait: "bg-wait", fail: "bg-fail", info: "bg-brand" };

type ChatSummary = { id: string; title: string; turns: number; last: RunSummary };

// Runs grouped into chats, most recently active first. A chat is named after its first question.
function chatsOf(runs: RunSummary[]): ChatSummary[] {
  const byChat = new Map<string, RunSummary[]>();
  for (const r of runs) byChat.set(r.chat_id, [...(byChat.get(r.chat_id) ?? []), r]);
  return [...byChat.entries()]
    .map(([id, rs]) => {
      const sorted = [...rs].sort((a, b) => a.seq - b.seq);
      return { id, title: sorted[0].question, turns: sorted.length, last: sorted[sorted.length - 1] };
    })
    .sort((a, b) => b.last.seq - a.last.seq);
}

// Ask like a chat: each chat keeps its own context, and each message is still its own checked, recorded run.
export async function Chat({ me, chatId }: { me: Persona; chatId: string | null }) {
  const [runs, chat] = await Promise.all([
    settle(getRuns(me.id)),
    chatId ? settle(getChat(me.id, chatId)) : Promise.resolve(null),
  ]);
  const chats = chatsOf((runs.data?.runs ?? []).filter((r) => r.requested_by.id === me.id));
  const turns = chat?.data?.turns ?? [];
  const missing = chatId !== null && !chat?.data;
  const mine = !chatId || chat?.data?.requested_by.id === me.id;
  const today = new Date().toISOString().slice(0, 10);
  const groups: [string, ChatSummary[]][] = [
    ["Today", chats.filter((c) => c.last.recorded_at.slice(0, 10) === today)],
    ["Earlier", chats.filter((c) => c.last.recorded_at.slice(0, 10) !== today)],
  ];

  const list = (
    <nav aria-label="Your chats" className="flex flex-col gap-4">
      <Link href="/" className="rounded-lg bg-ink px-3 py-2 text-center text-sm font-semibold text-white hover:bg-ink-2">
        <LinkPending />
        + New chat
      </Link>
      {chats.length === 0 && <p className="px-1 text-sm text-faint">Your chats will appear here.</p>}
      {groups.filter(([, items]) => items.length).map(([label, items]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">{label}</p>
          {items.slice(0, 40).map((c) => (
            <Link key={c.id} href={`/c/${c.id}`} aria-current={c.id === chatId ? "page" : undefined}
              className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                c.id === chatId ? "bg-brand-soft text-strong" : "text-body hover:bg-sunken/60"}`}>
              <LinkPending />
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[STATUS[c.last.outcome].tone]}`}
                aria-label={`Latest: ${STATUS[c.last.outcome].title}`} />
              <span className="line-clamp-2 flex-1">{c.title}</span>
              {c.turns > 1 && (
                <span className="mt-0.5 rounded-full bg-sunken px-1.5 text-[11px] font-medium text-muted" aria-label={`${c.turns} messages`}>
                  {c.turns}
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  const thread = (
    <ChatThread chatId={chatId} lastSeq={turns.at(-1)?.seq ?? null} canAsk={me.role !== "auditor" && mine && !missing}>
      {missing ? (
        <ErrorNote>That chat is not visible to {me.name}.</ErrorNote>
      ) : chat?.data ? (
        <>
          {!mine && (
            <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-muted">
              Chat started by {chat.data.requested_by.name}. Read-only: only they can continue it.
            </p>
          )}
          {turns.map((t, i) => <Turn key={t.seq} run={t} viewerId={me.id} compact={i < turns.length - 1} />)}
        </>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-3 py-6">
          <Eyebrow>Assistant</Eyebrow>
          <h1 className="max-w-2xl text-3xl font-extrabold leading-[1.08] sm:text-4xl">
            Ask about your SOPs, specifications<br />and records.
          </h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-muted">
            Each answer quotes the section it comes from, and anything that needs a person waits for QA to sign it off.
            You can ask follow-up questions in the same chat. Some examples:
          </p>
        </div>
      )}
    </ChatThread>
  );

  if (me.role === "auditor") return thread; // auditors read chats; they have none of their own

  return (
    <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-1">{list}</div>
      </aside>
      <details className="rounded-card border border-line bg-white p-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-semibold text-strong">Your chats ({chats.length})</summary>
        <div className="mt-3">{list}</div>
      </details>
      {thread}
    </div>
  );
}

function Turn({ run, viewerId, compact }: { run: RunDetail; viewerId: string; compact: boolean }) {
  return (
    <div id={`run-${run.seq}`} className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex flex-col items-end gap-1">
        <p className="max-w-[85%] whitespace-pre-line rounded-card rounded-br-md bg-ink px-4 py-3 text-[15px] text-white">{run.question}</p>
        {run.standalone_question && (
          <p className="max-w-[85%] text-right text-xs text-faint">understood as: {run.standalone_question}</p>
        )}
      </div>
      {compact ? <CompactAnswer run={run} viewerId={viewerId} /> : <AnswerCard run={run} viewerId={viewerId} />}
    </div>
  );
}

// An earlier answer in the chat: its status and the first lines, with the full card one click away.
function CompactAnswer({ run, viewerId }: { run: RunDetail; viewerId: string }) {
  const status = STATUS[run.outcome];
  const preview = run.answer?.text ?? plainReasons(run.reasons)[0] ?? status.title;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-card border border-line bg-white px-5 py-3 shadow-card transition-colors hover:border-line-strong group-open:mb-3 group-open:border-transparent group-open:bg-transparent group-open:p-0 group-open:shadow-none [&::-webkit-details-marker]:hidden">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full group-open:hidden ${DOT[status.tone]}`} aria-hidden />
        <span className="min-w-0 flex-1 group-open:hidden">
          <span className="block text-sm font-semibold text-strong">{status.title}</span>
          <span className="line-clamp-2 text-sm text-muted">{preview}</span>
        </span>
        <span className="shrink-0 text-xs font-medium text-brand-text group-open:ml-auto">
          <span className="group-open:hidden">Show details</span>
          <span className="hidden group-open:inline">Hide details</span>
        </span>
      </summary>
      <AnswerCard run={run} viewerId={viewerId} />
    </details>
  );
}
