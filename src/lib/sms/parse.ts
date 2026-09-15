import { parseAmount } from '@/lib/format';

export interface ParsedSmsTransaction {
  amount: number;
  currency: string;
  type: 'expense' | 'income';
  /** Merchant as the bank wrote it, trimmed. Null when the shape has no merchant. */
  merchant: string | null;
  /** Last four digits of the card the money moved on. */
  cardLast4: string | null;
  /** The balance the bank reported afterwards, when it did. Not acted on yet. */
  availableBalance: number | null;
}

export type SmsRefusal =
  /** The bank said the payment did not go through. Nothing happened to the money. */
  | 'declined'
  /** Not a shape we have seen. Refused rather than guessed. */
  | 'unrecognised';

export type SmsParseResult =
  | { ok: true; tx: ParsedSmsTransaction }
  | { ok: false; reason: SmsRefusal };

/**
 * Turns a bank SMS into a transaction.
 *
 * Only shapes that have actually been observed are accepted. Anything else is
 * refused, and the caller records the raw text instead — a parser that guesses
 * is worse than one that admits it does not know, because a wrong amount in a
 * financial record looks exactly like a right one.
 *
 * Adding a shape means adding a pattern here and a test beside it with the real
 * message. That is the whole process; there is no generic fallback on purpose.
 */

/**
 * maib, Russian, card payment:
 *
 *   Оплата на сумму 97.6 MDL в FIDESCO 111 с карты ***8913 прошла успешно.
 *   Доступный остаток: 499.2 MDL.
 *
 * `прошла успешно` is the part that says the money actually moved, so it is
 * required rather than decorative: a declined payment carries different wording
 * and must not become a transaction.
 */
const MAIB_RU_PAYMENT =
  /Оплата\s+на\s+сумму\s+([\d\s.,]+?)\s*([A-Z]{3})\s+в\s+(.+?)\s+с\s+карты\s+\*+(\d{4})\s+прошла\s+успешно/iu;

/** The balance the message ends with, in any of the shapes above. */
const BALANCE = /остаток[:\s]+([\d\s.,]+?)\s*([A-Z]{3})/iu;

/**
 * Words that mean the money did not move. Checked before anything else: a
 * message can otherwise look exactly like a successful one.
 */
const DECLINED = /(отклонен|отказ|недостаточно средств|неуспешн|не выполнен)/iu;

export function parseBankSms(text: string): SmsParseResult {
  const body = text.replace(/\s+/g, ' ').trim();
  if (!body) return { ok: false, reason: 'unrecognised' };

  if (DECLINED.test(body)) return { ok: false, reason: 'declined' };

  const payment = MAIB_RU_PAYMENT.exec(body);
  if (payment) {
    const amount = parseAmount(payment[1] ?? '');
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'unrecognised' };

    return {
      ok: true,
      tx: {
        amount,
        currency: (payment[2] ?? '').toUpperCase(),
        type: 'expense',
        merchant: cleanMerchant(payment[3] ?? ''),
        cardLast4: payment[4] ?? null,
        availableBalance: readBalance(body),
      },
    };
  }

  return { ok: false, reason: 'unrecognised' };
}

function readBalance(body: string): number | null {
  const found = BALANCE.exec(body);
  if (!found) return null;
  const value = parseAmount(found[1] ?? '');
  return Number.isFinite(value) ? value : null;
}

/** Banks pad merchant names; the trailing punctuation belongs to the sentence. */
function cleanMerchant(raw: string): string | null {
  const merchant = raw.replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim();
  return merchant.length > 0 ? merchant.slice(0, 120) : null;
}

/**
 * A stable identity for a message, so the same SMS forwarded twice is one
 * transaction. The text itself is the identity: two different purchases differ
 * in at least the amount, the merchant or the balance that follows.
 */
export function smsFingerprint(text: string): string {
  const normalised = text.replace(/\s+/g, ' ').trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalised.length; i += 1) {
    hash ^= normalised.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `sms:${hash.toString(16).padStart(8, '0')}:${normalised.length}`;
}
