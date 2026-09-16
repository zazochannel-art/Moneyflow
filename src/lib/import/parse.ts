/**
 * Turns a bank statement's CSV into rows this app can store.
 *
 * Written against the shape of the problem rather than one bank's file: the
 * columns are chosen by the person importing, from a guess this makes and can
 * be overruled on. A parser that only knows one layout is a parser that breaks
 * the first time the bank changes a heading, and there is no way to test that
 * day in advance.
 */

export interface ParsedRow {
  /** 1-based, as the person sees it in a spreadsheet. */
  line: number;
  date: string | null;
  amount: number | null;
  description: string;
  /** Why this row cannot be imported, if it cannot. */
  problem: 'date' | 'amount' | null;
}

export interface ColumnMapping {
  date: number;
  description: number;
  /** One signed column, or two columns where only one is filled per row. */
  amount: number | null;
  debit: number | null;
  credit: number | null;
}

export interface Sheet {
  headers: string[];
  rows: string[][];
}

/**
 * Splits a delimited file.
 *
 * Quoted fields may contain the delimiter, newlines and doubled quotes, which
 * is the entire reason this is not `split(',')`. Bank exports carry merchant
 * names with commas in them constantly.
 */
export function parseDelimited(text: string): Sheet {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;

  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const filled = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  const [headers = [], ...body] = filled;

  return { headers: headers.map((h) => h.trim()), rows: body };
}

/** Whichever of these appears most often outside quotes, counted on the first line. */
function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t', '|'].map((d) => ({
    d,
    n: firstLine.split(d).length - 1,
  }));
  const best = counts.sort((a, b) => b.n - a.n)[0];
  return best && best.n > 0 ? best.d : ',';
}

/**
 * A number as banks write it.
 *
 * `1.234,56`, `1,234.56`, `1 234,56`, `-97.60`, `97,60-`, `(97.60)`. The last
 * separator in the string is the decimal one — that single rule settles the
 * ambiguity between thousands and decimals without guessing a locale.
 */
export function parseAmount(raw: string): number | null {
  let text = raw.trim();
  if (!text) return null;

  let negative = false;

  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1);
  }
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  if (text.startsWith('+')) text = text.slice(1);

  text = text.replace(/[^\d.,]/g, '');
  if (!text) return null;

  const lastSeparator = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
  let whole = text;
  let fraction = '';

  if (lastSeparator !== -1) {
    const tail = text.slice(lastSeparator + 1);
    // Three digits after the last separator and no other separator is a
    // thousands group, not a fraction: "1,234" is one thousand.
    const onlySeparator = text.indexOf('.') === text.lastIndexOf('.') && text.indexOf(',') === text.lastIndexOf(',');
    const bothKinds = text.includes('.') && text.includes(',');
    if (!(tail.length === 3 && onlySeparator && !bothKinds)) {
      whole = text.slice(0, lastSeparator);
      fraction = tail;
    }
  }

  const digits = `${whole.replace(/[^\d]/g, '')}.${fraction.replace(/[^\d]/g, '') || '0'}`;
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;

  return negative ? -value : value;
}

/**
 * A date as banks write it, returned as `YYYY-MM-DD`.
 *
 * Day-first is assumed where both readings are possible, because this app is
 * used where that is the convention — and because the preview shows the result
 * before anything is written, so a wrong guess is visible rather than silent.
 */
export function parseDate(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return build(iso[1], iso[2], iso[3]);

  const dayFirst = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dayFirst) {
    const year = dayFirst[3].length === 2 ? `20${dayFirst[3]}` : dayFirst[3];
    return build(year, dayFirst[2], dayFirst[1]);
  }

  return null;
}

function build(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DATE_WORDS = ['data', 'date', 'дата', 'ziua', 'transaction date', 'data tranzacției'];
const DESCRIPTION_WORDS = ['descriere', 'description', 'details', 'detalii', 'narrative', 'назначение', 'описание', 'merchant', 'beneficiar'];
const AMOUNT_WORDS = ['suma', 'amount', 'сумма', 'valoare', 'value'];
const DEBIT_WORDS = ['debit', 'cheltuieli', 'расход', 'дебет', 'plati', 'plăți'];
const CREDIT_WORDS = ['credit', 'incasari', 'încasări', 'приход', 'кредит'];

/** A first guess at which column is which, from the headings. */
export function guessMapping(headers: string[]): ColumnMapping {
  const find = (words: string[]) =>
    headers.findIndex((header) => {
      const h = header.toLowerCase().trim();
      return words.some((word) => h === word || h.includes(word));
    });

  const debit = find(DEBIT_WORDS);
  const credit = find(CREDIT_WORDS);
  const amount = find(AMOUNT_WORDS);

  return {
    date: find(DATE_WORDS),
    description: find(DESCRIPTION_WORDS),
    // Two columns win over one: a statement that has both usually leaves the
    // single "amount" column as an unsigned duplicate.
    amount: debit !== -1 && credit !== -1 ? null : amount,
    debit: debit !== -1 && credit !== -1 ? debit : null,
    credit: debit !== -1 && credit !== -1 ? credit : null,
  };
}

/** Applies a mapping to every row, keeping the ones that cannot be read. */
export function readRows(sheet: Sheet, mapping: ColumnMapping): ParsedRow[] {
  return sheet.rows.map((cells, index) => {
    const at = (column: number | null) => (column === null || column < 0 ? '' : (cells[column] ?? ''));

    const date = parseDate(at(mapping.date));
    const description = at(mapping.description).trim();

    let amount: number | null = null;
    if (mapping.debit !== null || mapping.credit !== null) {
      const debit = parseAmount(at(mapping.debit));
      const credit = parseAmount(at(mapping.credit));
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    } else {
      amount = parseAmount(at(mapping.amount));
    }

    return {
      line: index + 2, // +1 for the header, +1 because people count from one
      date,
      description,
      amount,
      problem: date === null ? 'date' : amount === null || amount === 0 ? 'amount' : null,
    };
  });
}

/**
 * A stable name for a row, so importing the same statement twice imports it
 * once. The database has a unique index on it; this is the value that index
 * protects.
 *
 * `occurrence` is what makes two genuine coffees on the same day at the same
 * price survive. Without it they collide, and a unique index turns a perfectly
 * ordinary statement into a failed import — the same value that stops the
 * double import would have stopped the first one.
 */
export function importFingerprint(row: ParsedRow, accountId: string, occurrence = 0): string {
  const basis = `${accountId}|${row.date}|${row.amount?.toFixed(2)}|${row.description.toLowerCase().replace(/\s+/g, ' ').trim()}|${occurrence}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < basis.length; i += 1) {
    hash ^= basis.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `import:${hash.toString(16)}:${row.date}:${row.amount?.toFixed(2)}:${occurrence}`;
}

/**
 * Fingerprints for a whole statement, counting repeats as it goes.
 *
 * Numbering by position in the file rather than by row index keeps it stable:
 * the same file imported again produces the same sequence, so the second
 * import still recognises every line.
 */
export function fingerprintAll(rows: ParsedRow[], accountId: string): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = `${row.date}|${row.amount?.toFixed(2)}|${row.description.toLowerCase().trim()}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return importFingerprint(row, accountId, occurrence);
  });
}
