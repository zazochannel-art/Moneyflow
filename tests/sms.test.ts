import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBankSms, smsFingerprint } from '@/lib/sms/parse';

/** The message this parser was written from, exactly as maib sends it. */
const REAL =
  'Оплата на сумму 97.6 MDL в FIDESCO 111 с карты ***8913 прошла успешно. Доступный остаток: 499.2 MDL.';

test('reads every field out of a real maib payment message', () => {
  const result = parseBankSms(REAL);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.tx.amount, 97.6);
  assert.equal(result.tx.currency, 'MDL');
  assert.equal(result.tx.type, 'expense');
  assert.equal(result.tx.merchant, 'FIDESCO 111');
  assert.equal(result.tx.cardLast4, '8913');
  assert.equal(result.tx.availableBalance, 499.2);
});

test('a merchant name with several words survives intact', () => {
  const result = parseBankSms(
    'Оплата на сумму 250 MDL в LINELLA SUPERMARKET 42 с карты ***1234 прошла успешно.',
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.tx.merchant, 'LINELLA SUPERMARKET 42');
  assert.equal(result.tx.cardLast4, '1234');
  assert.equal(result.tx.availableBalance, null);
});

test('thousands separators do not become a hundredfold error', () => {
  // The difference between 1234.56 and 1.23 is the whole point of the feature.
  const comma = parseBankSms(
    'Оплата на сумму 1,234.56 MDL в APPLE с карты ***8913 прошла успешно.',
  );
  assert.equal(comma.ok, true);
  if (comma.ok) assert.equal(comma.tx.amount, 1234.56);

  const dot = parseBankSms(
    'Оплата на сумму 1.234,56 MDL в APPLE с карты ***8913 прошла успешно.',
  );
  assert.equal(dot.ok, true);
  if (dot.ok) assert.equal(dot.tx.amount, 1234.56);
});

test('a declined payment is not a transaction', () => {
  // No money moved. Recording it would invent a debt that does not exist.
  const result = parseBankSms(
    'Оплата на сумму 97.6 MDL в FIDESCO 111 с карты ***8913 отклонена. Недостаточно средств.',
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'declined');
});

test('an unfamiliar message is refused, not guessed at', () => {
  // Contains an amount and a card, and still gets nothing written: a shape we
  // have not seen is a shape we cannot read correctly.
  const result = parseBankSms('Va informam: 500 MDL, card ***8913. Detalii in aplicatie.');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'unrecognised');
});

test('marketing and empty messages are refused', () => {
  for (const noise of ['', '   ', 'maib: reduceri de toamna la credite! Suna 1313.']) {
    const result = parseBankSms(noise);
    assert.equal(result.ok, false);
  }
});

test('line breaks and double spaces from the forwarder do not matter', () => {
  const messy = REAL.replace(' в ', '\n  в  ').replace(' с карты ', '  с  карты  ');
  const result = parseBankSms(messy);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.tx.merchant, 'FIDESCO 111');
});

test('the same message twice has the same fingerprint, a different one does not', () => {
  assert.equal(smsFingerprint(REAL), smsFingerprint(`  ${REAL}  `));
  assert.notEqual(
    smsFingerprint(REAL),
    smsFingerprint(REAL.replace('97.6', '97.7')),
  );
  // Two identical amounts at the same merchant still differ by the balance that
  // follows them, which is what stops a real second purchase being swallowed.
  assert.notEqual(
    smsFingerprint(REAL),
    smsFingerprint(REAL.replace('499.2', '401.6')),
  );
});
