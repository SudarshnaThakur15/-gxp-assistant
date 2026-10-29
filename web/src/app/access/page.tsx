import { Suspense } from "react";

import { AccessForm } from "@/components/access-form";
import { PageHeader } from "@/components/ui";

export default function AccessPage(props: PageProps<"/access">) {
  return (
    <>
      <PageHeader eyebrow="Access" title="Enter the access code.">
        This demo is shared privately. Enter the code from the person who sent you the link.
      </PageHeader>
      <Suspense fallback={null}>
        <Form searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<"/access">["searchParams"] }) {
  const next = (await searchParams).next;
  return <AccessForm next={typeof next === "string" ? next : "/"} />;
}
