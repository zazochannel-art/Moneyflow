import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationHref } from '../src/lib/data/notification-link';

const base = { href: null, kind: 'budget_over', dedupe_key: 'x' };

test('an unreadable bank message leads to the screen that can record it', () => {
  assert.equal(
    notificationHref({ ...base, kind: 'sms_unparsed', dedupe_key: 'sms:abc123' }),
    '/transactions?message=sms%3Aabc123',
  );
});

test('a notification that carries its own link keeps it', () => {
  assert.equal(notificationHref({ ...base, href: '/budgets' }), '/budgets');
  assert.equal(
    notificationHref({ ...base, kind: 'sms_unparsed', href: '/elsewhere' }),
    '/elsewhere',
  );
});

test('a purchase with nowhere to go leads to the accounts screen', () => {
  assert.equal(notificationHref({ ...base, kind: 'sms_no_account' }), '/accounts');
});

test('anything else still leads nowhere, rather than somewhere wrong', () => {
  assert.equal(notificationHref(base), null);
});
