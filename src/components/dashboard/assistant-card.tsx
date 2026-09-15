'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Bot, SendHorizonal } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n/context';

/**
 * The assistant's doorway on the dashboard.
 *
 * It does not answer here: the conversation belongs on its own page, where
 * there is room for it and where the history survives. This hands the question
 * over and the answer starts arriving there, rather than showing a reply in a
 * card too small to hold the next one.
 */
export function AssistantCard() {
  const t = useT();
  const router = useRouter();
  const [question, setQuestion] = useState('');

  const send = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    router.push(trimmed ? `/assistant?q=${encodeURIComponent(trimmed)}` : '/assistant');
  };

  return (
    <Card className="relative overflow-hidden border-border/80 p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-70"
        style={{
          background:
            'radial-gradient(70% 100% at 50% 0%, color-mix(in oklab, var(--secondary) 22%, transparent), transparent 70%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary/15 text-secondary">
          <Bot className="size-6" aria-hidden />
        </span>

        <div className="space-y-1">
          <p className="font-semibold">{t('nav.assistant')}</p>
          <p className="text-xs text-muted-foreground">{t('assistant.subtitle')}</p>
        </div>

        <form onSubmit={send} className="relative w-full">
          <label className="sr-only" htmlFor="assistant-question">
            {t('assistant.placeholder')}
          </label>
          <Input
            id="assistant-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t('assistant.suggestion1')}
            className="pr-11"
          />
          <button
            type="submit"
            aria-label={t('assistant.send')}
            className="absolute inset-y-1 right-1 flex aspect-square items-center justify-center rounded-lg bg-secondary text-secondary-foreground transition-all hover:brightness-110 active:scale-95"
          >
            <SendHorizonal className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    </Card>
  );
}
