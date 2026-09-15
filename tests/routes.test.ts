import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicPath } from '../src/lib/routes';

// A path in the wrong column here fails silently in both directions, which is
// why it is asserted rather than eyeballed. Left out, the SMS endpoint answered
// the phone with a redirect to the login page — a 200 with a form in it, which
// a forwarder reads as success while nothing is ever recorded.
test('the SMS endpoint is reachable without a session', () => {
  assert.equal(isPublicPath('/api/ingest/sms'), true);
});

test('the sign-in screens and the landing page stay public', () => {
  for (const path of [
    '/',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/auth/callback',
    '/offline',
  ]) {
    assert.equal(isPublicPath(path), true, `${path} should be public`);
  }
});

test('everything holding a signed-in user data stays behind the session', () => {
  for (const path of [
    '/dashboard',
    '/transactions',
    '/settings',
    '/assistant',
    '/api/assistant',
    '/api/export',
    '/api/notifications',
  ]) {
    assert.equal(isPublicPath(path), false, `${path} should require a session`);
  }
});

test('a public prefix does not open a path that merely starts with its letters', () => {
  assert.equal(isPublicPath('/logins-secret'), false);
  assert.equal(isPublicPath('/api/ingest/sms-admin'), false);
});
