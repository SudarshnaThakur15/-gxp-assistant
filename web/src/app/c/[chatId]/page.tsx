import { Suspense } from "react";

import { Chat } from "@/components/chat";
import { ErrorNote, Skeleton } from "@/components/ui";
import { settle } from "@/lib/api";
import { getCurrentPersona } from "@/lib/persona";

export default function ChatPage(props: PageProps<"/c/[chatId]">) {
  return (
    <Suspense fallback={<Skeleton lines={4} />}>
      <ChatRoute params={props.params} />
    </Suspense>
  );
}

async function ChatRoute({ params }: { params: PageProps<"/c/[chatId]">["params"] }) {
  const [{ chatId }, persona] = await Promise.all([params, settle(getCurrentPersona())]);
  if (!persona.data) return <ErrorNote>API unreachable: {persona.error}</ErrorNote>;
  return <Chat me={persona.data.current} chatId={chatId} />;
}
