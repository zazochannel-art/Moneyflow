import type { Metadata } from 'next';
import { AssistantChat } from '@/components/assistant/assistant-chat';

export const metadata: Metadata = { title: 'Asistent AI' };

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The dashboard card hands its question over through the URL, so arriving
  // here already asking something is a normal way in.
  const params = await searchParams;
  const q = params.q;
  const initialQuestion = (Array.isArray(q) ? q[0] : q)?.trim() || undefined;

  return <AssistantChat initialQuestion={initialQuestion} />;
}
