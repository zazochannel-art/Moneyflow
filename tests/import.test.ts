import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDelimited,
  parseAmount,
  parseDate,
  guessMapping,
  readRows,
  importFingerprint,
  fingerprintAll,
} from '../src/lib/import/parse';

test('a quoted merchant name keeps its commas', () => {
  const sheet = parseDelimited('Data,Descriere,Suma\n01.02.2026,"FIDESCO 111, Chisinau",-97.60\n');
  assert.deepEqual(sheet.headers, ['Data', 'Descriere', 'Suma']);
  assert.deepEqual(sheet.rows, [['01.02.2026', 'FIDESCO 111, Chisinau', '-97.60']]);
});

test('semicolons and tabs are recognised as separators', () => {
  assert.deepEqual(parseDelimited('a;b;c\n1;2;3\n').headers, ['a', 'b', 'c']);
  assert.deepEqual(parseDelimited('a\tb\n1\t2\n').headers, ['a', 'b']);
});

test('a doubled quote inside a quoted field is one quote', () => {
  const sheet = parseDelimited('d,x\n1,"say ""hi"" now"\n');
  assert.equal(sheet.rows[0][1], 'say "hi" now');
});

test('a byte order mark does not become part of the first heading', () => {
  assert.equal(parseDelimited('﻿Data,Suma\n01.01.2026,5\n').headers[0], 'Data');
});

test('blank lines are dropped rather than imported as empty rows', () => {
  const sheet = parseDelimited('a,b\n1,2\n\n\n3,4\n');
  assert.equal(sheet.rows.length, 2);
});

test('amounts survive every separator convention a bank uses', () => {
  assert.equal(parseAmount('97.60'), 97.6);
  assert.equal(parseAmount('97,60'), 97.6);
  assert.equal(parseAmount('1 234,56'), 1234.56);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('-97.60'), -97.6);
  assert.equal(parseAmount('97.60-'), -97.6);
  assert.equal(parseAmount('(97.60)'), -97.6);
  assert.equal(parseAmount('1 234,56 MDL'), 1234.56);
});

test('three digits after the only separator is a thousands group, not a fraction', () => {
  assert.equal(parseAmount('1,234'), 1234);
  assert.equal(parseAmount('1.234'), 1234);
  // ...but with both kinds present the last one is the decimal point
  assert.equal(parseAmount('1.234,00'), 1234);
});

test('what is not a number is refused rather than guessed', () => {
  for (const junk of ['', '   ', 'n/a', '-', 'MDL']) {
    assert.equal(parseAmount(junk), null, `${junk} should be refused`);
  }
});

test('dates come back as YYYY-MM-DD, day first where it is ambiguous', () => {
  assert.equal(parseDate('01.02.2026'), '2026-02-01');
  assert.equal(parseDate('1/2/2026'), '2026-02-01');
  assert.equal(parseDate('2026-02-01'), '2026-02-01');
  assert.equal(parseDate('01.02.26'), '2026-02-01');
  assert.equal(parseDate('15.09.2026 01:13'), '2026-09-15');
});

test('a date that does not exist is refused, not rolled over', () => {
  assert.equal(parseDate('31.02.2026'), null);
  assert.equal(parseDate('45.01.2026'), null);
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate(''), null);
});

test('headings are matched in Romanian, English and Russian', () => {
  const mapping = guessMapping(['Data', 'Descriere', 'Suma']);
  assert.equal(mapping.date, 0);
  assert.equal(mapping.description, 1);
  assert.equal(mapping.amount, 2);

  const ru = guessMapping(['Дата', 'Описание', 'Сумма']);
  assert.equal(ru.date, 0);
  assert.equal(ru.description, 1);
  assert.equal(ru.amount, 2);
});

test('two columns for money win over one, because the single one duplicates them', () => {
  const mapping = guessMapping(['Data', 'Detalii', 'Suma', 'Debit', 'Credit']);
  assert.equal(mapping.amount, null);
  assert.equal(mapping.debit, 3);
  assert.equal(mapping.credit, 4);
});

test('debit becomes an expense and credit an income, whatever sign they carry', () => {
  const sheet = parseDelimited('Data,Detalii,Debit,Credit\n01.02.2026,Chirie,5000,\n02.02.2026,Salariu,,20000\n');
  const parsed = readRows(sheet, guessMapping(sheet.headers));
  assert.equal(parsed[0].amount, -5000);
  assert.equal(parsed[1].amount, 20000);
});

test('a row that cannot be read says which part failed', () => {
  const sheet = parseDelimited('Data,Descriere,Suma\nnope,Ceva,10\n01.02.2026,Ceva,\n');
  const parsed = readRows(sheet, guessMapping(sheet.headers));
  assert.equal(parsed[0].problem, 'date');
  assert.equal(parsed[1].problem, 'amount');
});

test('rows are numbered as a spreadsheet numbers them', () => {
  const sheet = parseDelimited('Data,Descriere,Suma\n01.02.2026,A,1\n02.02.2026,B,2\n');
  const parsed = readRows(sheet, guessMapping(sheet.headers));
  assert.deepEqual(parsed.map((r) => r.line), [2, 3]);
});

test('the same row imported twice carries the same fingerprint', () => {
  const sheet = parseDelimited('Data,Descriere,Suma\n01.02.2026,"FIDESCO  111",-97.60\n');
  const [row] = readRows(sheet, guessMapping(sheet.headers));

  const again = readRows(parseDelimited('Data,Descriere,Suma\n01.02.2026,"fidesco 111",-97.6\n'), {
    date: 0, description: 1, amount: 2, debit: null, credit: null,
  })[0];

  assert.equal(importFingerprint(row, 'acct'), importFingerprint(again, 'acct'));
});

test('the same row on a different account is a different fingerprint', () => {
  const sheet = parseDelimited('Data,Descriere,Suma\n01.02.2026,A,-10\n');
  const [row] = readRows(sheet, guessMapping(sheet.headers));
  assert.notEqual(importFingerprint(row, 'one'), importFingerprint(row, 'two'));
});

test('two identical purchases on the same day are two rows, not a collision', () => {
  // A statement can honestly contain the same coffee twice. Before the repeat
  // counter these shared a fingerprint, the unique index rejected the batch,
  // and the whole import failed on a perfectly ordinary file.
  const sheet = parseDelimited(
    'Data,Descriere,Suma\n01.02.2026,CAFE,-25\n01.02.2026,CAFE,-25\n01.02.2026,CAFE,-25\n',
  );
  const parsed = readRows(sheet, guessMapping(sheet.headers));
  const prints = fingerprintAll(parsed, 'acct');

  assert.equal(new Set(prints).size, 3);
});

test('the same file fingerprinted twice gives the same sequence', () => {
  const text = 'Data,Descriere,Suma\n01.02.2026,CAFE,-25\n02.02.2026,PAINE,-15\n01.02.2026,CAFE,-25\n';
  const once = fingerprintAll(readRows(parseDelimited(text), { date: 0, description: 1, amount: 2, debit: null, credit: null }), 'acct');
  const twice = fingerprintAll(readRows(parseDelimited(text), { date: 0, description: 1, amount: 2, debit: null, credit: null }), 'acct');

  assert.deepEqual(once, twice);
});

test('the repeat counter is what separates them, nothing else', () => {
  const sheet = parseDelimited('Data,Descriere,Suma\n01.02.2026,CAFE,-25\n');
  const [row] = readRows(sheet, guessMapping(sheet.headers));

  assert.equal(importFingerprint(row, 'acct', 0), fingerprintAll([row], 'acct')[0]);
  assert.notEqual(importFingerprint(row, 'acct', 0), importFingerprint(row, 'acct', 1));
});
