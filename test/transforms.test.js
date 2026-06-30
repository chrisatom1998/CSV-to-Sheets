const test = require('node:test');
const assert = require('node:assert');
const { cleanNumeric, normalizeDate } = require('../transforms.js');

test('cleanNumeric: strips currency and thousands separators', () => {
  assert.strictEqual(cleanNumeric('$1,234.56'), '1234.56');
  assert.strictEqual(cleanNumeric('1,000'), '1000');
  assert.strictEqual(cleanNumeric('1,234,567.8'), '1234567.8');
});

test('cleanNumeric: strips space/NBSP/narrow-NBSP thousands separators', () => {
  assert.strictEqual(cleanNumeric('1 000'), '1000');          // regular space U+0020
  assert.strictEqual(cleanNumeric('1 000'), '1000');     // NBSP U+00A0
  assert.strictEqual(cleanNumeric('1 000'), '1000');     // narrow NBSP U+202F
});

test('cleanNumeric: handles negatives', () => {
  assert.strictEqual(cleanNumeric('(1,234.56)'), '-1234.56');
  assert.strictEqual(cleanNumeric('-50'), '-50');
});

test('cleanNumeric: leaves percents untouched', () => {
  assert.strictEqual(cleanNumeric('45.2%'), '45.2%');
  assert.strictEqual(cleanNumeric('100%'), '100%');
});

test('cleanNumeric: leaves non-numbers untouched', () => {
  for (const v of ['AdMob', '2026-06-01', '1,23', '', 'N/A']) {
    assert.strictEqual(cleanNumeric(v), v);
  }
});

test('cleanNumeric: text with internal spaces is not glued into a number', () => {
  // Spaces are stripped before validation (so "1 000" -> "1000"), but the regex
  // guard must still reject text that only *looks* numeric once spaces are gone.
  assert.strictEqual(cleanNumeric('1 2 3 abc'), '1 2 3 abc');
  assert.strictEqual(cleanNumeric('N / A'), 'N / A');
  assert.strictEqual(cleanNumeric('$ 5 each'), '$ 5 each');
});

test('cleanNumeric: leaves plain numbers unchanged', () => {
  assert.strictEqual(cleanNumeric('12345'), '12345');
  assert.strictEqual(cleanNumeric('12.5'), '12.5');
});

test('normalizeDate: normalizes common date formats', () => {
  assert.strictEqual(normalizeDate('6/1/26'), '2026-06-01');
  assert.strictEqual(normalizeDate('2026.06.01'), '2026-06-01');
  assert.strictEqual(normalizeDate('Jun 1 2026'), '2026-06-01');
  assert.strictEqual(normalizeDate('1 June 2026'), '2026-06-01');
  assert.strictEqual(normalizeDate('2026-06-01T15:34:57-07:00'), '2026-06-01');
  assert.strictEqual(normalizeDate('2026/06/01 15:34'), '2026-06-01');
  assert.strictEqual(normalizeDate('6/1/26 12:00 PM'), '2026-06-01');
});

test('normalizeDate: leaves invalid or yearless dates untouched', () => {
  assert.strictEqual(normalizeDate('2/29/2025'), '2/29/2025');
  assert.strictEqual(normalizeDate('6/1'), '6/1');
  assert.strictEqual(normalizeDate('AdMob'), 'AdMob');
});

const { splitTargets } = require('../transforms.js');

test('splitTargets: comma-separated', () => {
  assert.deepStrictEqual(
    splitTargets('Date, Ad source, Format'),
    ['Date', 'Ad source', 'Format']
  );
});

test('splitTargets: one-per-line (newlines) still splits', () => {
  assert.deepStrictEqual(
    splitTargets('Date\nAd source\nFormat'),
    ['Date', 'Ad source', 'Format']
  );
});

test('splitTargets: mixed commas and newlines', () => {
  assert.deepStrictEqual(
    splitTargets('Date, Ad source\nFormat, Impressions\nEstimated earnings'),
    ['Date', 'Ad source', 'Format', 'Impressions', 'Estimated earnings']
  );
});

test('splitTargets: tabs (pasted spreadsheet row) split too', () => {
  assert.deepStrictEqual(
    splitTargets('Date\tAd source\tFormat'),
    ['Date', 'Ad source', 'Format']
  );
});

test('splitTargets: CRLF and consecutive separators collapse, blanks dropped', () => {
  assert.deepStrictEqual(
    splitTargets('Date,\r\n, Ad source,,Format,\n'),
    ['Date', 'Ad source', 'Format']
  );
});

test('splitTargets: empty / null input yields []', () => {
  assert.deepStrictEqual(splitTargets(''), []);
  assert.deepStrictEqual(splitTargets(null), []);
  assert.deepStrictEqual(splitTargets(undefined), []);
});

const { splitRows } = require('../transforms.js');

test('splitRows: skip 0 with header', () => {
  const raw = [['Date', 'Earnings'], ['d1', '1'], ['d2', '2']];
  const out = splitRows(raw, { skip: 0, firstRowHeader: true });
  assert.deepStrictEqual(out.headers, ['Date', 'Earnings']);
  assert.deepStrictEqual(out.rows, [['d1', '1'], ['d2', '2']]);
});

test('splitRows: skip 2 with header', () => {
  const raw = [['title'], ['range'], ['Date', 'Earnings'], ['d1', '1']];
  const out = splitRows(raw, { skip: 2, firstRowHeader: true });
  assert.deepStrictEqual(out.headers, ['Date', 'Earnings']);
  assert.deepStrictEqual(out.rows, [['d1', '1']]);
});

test('splitRows: blank header cells become Column k', () => {
  const raw = [['Date', '', 'Earnings']];
  const out = splitRows(raw, { skip: 0, firstRowHeader: true });
  assert.deepStrictEqual(out.headers, ['Date', 'Column 2', 'Earnings']);
});

test('splitRows: no header makes synthetic columns', () => {
  const raw = [['a', 'b'], ['c', 'd']];
  const out = splitRows(raw, { skip: 0, firstRowHeader: false });
  assert.deepStrictEqual(out.headers, ['Column 1', 'Column 2']);
  assert.deepStrictEqual(out.rows, [['a', 'b'], ['c', 'd']]);
});

test('splitRows: over-skip returns empty', () => {
  const raw = [['a'], ['b']];
  assert.deepStrictEqual(
    splitRows(raw, { skip: 5, firstRowHeader: true }),
    { headers: [], rows: [] }
  );
});

test('splitRows: negative/NaN skip treated as 0', () => {
  const raw = [['Date'], ['d1']];
  assert.deepStrictEqual(splitRows(raw, { skip: -3, firstRowHeader: true }).rows, [['d1']]);
  assert.deepStrictEqual(splitRows(raw, { skip: NaN, firstRowHeader: true }).headers, ['Date']);
});

const { parseCSV, detectDelimiter, headerMatchConfidence, autoMatchIndex } = require('../transforms.js');

test('parseCSV: quoted fields with embedded delimiters and newlines', () => {
  const out = parseCSV('a,"b,c","d\ne"\n1,2,3', ',');
  assert.deepStrictEqual(out, [['a', 'b,c', 'd\ne'], ['1', '2', '3']]);
});

test('parseCSV: "" escapes and a leading BOM', () => {
  const out = parseCSV('﻿name,note\n"O""Brien","ok"', ',');
  assert.deepStrictEqual(out, [['name', 'note'], ['O"Brien', 'ok']]);
});

test('parseCSV: drops a leading multi-column all-blank row (Excel/Sheets export)', () => {
  // A blank row whose column count is preserved by trailing delimiters must not
  // survive to become the header row, or splitRows yields "Column 1, Column 2…".
  const out = parseCSV(',,,\nDate,Ad source,Impressions,Earnings\n2026-06-01,AdMob,100,5', ',');
  assert.deepStrictEqual(out[0], ['Date', 'Ad source', 'Impressions', 'Earnings']);
});

test('parseCSV: drops interior and trailing all-blank rows', () => {
  const out = parseCSV('a,b\n1,2\n,\n3,4\n,', ',');
  assert.deepStrictEqual(out, [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('parseCSV: a row with any non-blank cell is kept', () => {
  const out = parseCSV('a,b,c\n,,x\n,y,', ',');
  assert.deepStrictEqual(out, [['a', 'b', 'c'], ['', '', 'x'], ['', 'y', '']]);
});

test('parseCSV + splitRows: leading blank row no longer poisons the header', () => {
  const raw = parseCSV(',,,\nDate,Ad source,Impressions,Earnings\n2026-06-01,AdMob,100,5', ',');
  const out = splitRows(raw, { skip: 0, firstRowHeader: true });
  assert.deepStrictEqual(out.headers, ['Date', 'Ad source', 'Impressions', 'Earnings']);
});

test('detectDelimiter: samples rows, not just the first line', () => {
  // First line is a metadata title with a stray comma; the real data is tab-delimited.
  const text = 'Report, generated\nDate\tEarnings\tImpressions\n2026-01-01\t1\t2\n2026-01-02\t3\t4';
  assert.strictEqual(detectDelimiter(text), '\t');
});

test('detectDelimiter: not fooled by a quoted comma in an otherwise tab file', () => {
  const text = 'a\tb\tc\n"x,y"\t2\t3\n4\t5\t6';
  assert.strictEqual(detectDelimiter(text), '\t');
});

test('detectDelimiter: semicolon and pipe files', () => {
  assert.strictEqual(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.strictEqual(detectDelimiter('a|b|c\n1|2|3'), '|');
});

test('detectDelimiter: plain comma CSV', () => {
  assert.strictEqual(detectDelimiter('Date,Earnings\n2026-01-01,5'), ',');
});

test('detectDelimiter: ties break toward more columns, not candidate order', () => {
  // Comma splits every row into 2 cols (fully consistent → score 1.0).
  // Pipe splits 3 of 6 rows into 3 cols (modal 3, consistency 0.5 → score 1.0),
  // a tie. The tie must resolve to pipe (more columns) even though comma is
  // tried first — the old "first candidate wins" rule would return comma.
  const text = [
    'a|b|c,1', 'd|e|f,2', 'g|h|i,3', // pipe -> 3 cols, comma -> 2
    'j|k,4',                          // pipe -> 2 cols, comma -> 2
    'l|m|n|o,5',                      // pipe -> 4 cols, comma -> 2
    'p|q|r|s|t,6'                     // pipe -> 5 cols, comma -> 2
  ].join('\n');
  assert.strictEqual(detectDelimiter(text), '|');
});

test('headerMatchConfidence: exact / similar / none', () => {
  assert.strictEqual(headerMatchConfidence('Ad source', 'ad_source'), 'exact');
  assert.strictEqual(headerMatchConfidence('Earnings', 'Estimated earnings'), 'similar');
  assert.strictEqual(headerMatchConfidence('Date', 'Impressions'), 'none');
  assert.strictEqual(headerMatchConfidence('Date', ''), 'none');
});

test('autoMatchIndex: prefers exact, then contains, else -1', () => {
  const heads = ['Estimated earnings', 'Date', 'Earnings'];
  assert.strictEqual(autoMatchIndex('Earnings', heads), 2);   // exact wins over the substring at 0
  assert.strictEqual(autoMatchIndex('date', heads), 1);
  assert.strictEqual(autoMatchIndex('Format', heads), -1);
});

test('autoMatchIndex: returns an index so duplicate headers stay distinct', () => {
  // Two columns named "Value"; indexOf-on-text would always pick the first.
  const heads = ['Value', 'Label', 'Value'];
  assert.strictEqual(autoMatchIndex('Label', heads), 1);
});

const { sortRows, compareValues, asNumber } = require('../transforms.js');

test('asNumber: parses currency/thousands/percent, rejects text', () => {
  assert.strictEqual(asNumber('$1,234.56'), 1234.56);
  assert.strictEqual(asNumber('(50)'), -50);
  assert.strictEqual(asNumber('45.2%'), 45.2);
  assert.strictEqual(asNumber('AdMob'), null);
  assert.strictEqual(asNumber(''), null);
});

test('compareValues: numbers compare numerically, not lexically', () => {
  assert.ok(compareValues('9', '100') < 0);    // 9 < 100 (lexically "9" > "100")
  assert.ok(compareValues('$1,000', '900') > 0);
  assert.strictEqual(compareValues('5', '5'), 0);
});

test('compareValues: numbers sort before text; text is case-insensitive', () => {
  assert.ok(compareValues('5', 'apple') < 0);
  assert.ok(compareValues('apple', 'Banana') < 0);
  assert.strictEqual(compareValues('AdMob', 'admob'), 0);
});

test('sortRows: ascending and descending by a column', () => {
  const rows = [['b', '100'], ['a', '9'], ['c', '50']];
  assert.deepStrictEqual(
    sortRows(rows, [{ index: 1, dir: 'asc' }]),
    [['a', '9'], ['c', '50'], ['b', '100']]
  );
  assert.deepStrictEqual(
    sortRows(rows, [{ index: 1, dir: 'desc' }]),
    [['b', '100'], ['c', '50'], ['a', '9']]
  );
});

test('sortRows: stable on ties (preserves original order)', () => {
  const rows = [['x', '1'], ['y', '1'], ['z', '1']];
  assert.deepStrictEqual(
    sortRows(rows, [{ index: 1, dir: 'asc' }]),
    [['x', '1'], ['y', '1'], ['z', '1']]
  );
});

test('sortRows: group key first, then sort within each group', () => {
  // group by col 0 (asc), then col 1 desc within each group
  const rows = [['Video', '5'], ['Banner', '10'], ['Video', '20'], ['Banner', '3']];
  assert.deepStrictEqual(
    sortRows(rows, [{ index: 0, dir: 'asc' }, { index: 1, dir: 'desc' }]),
    [['Banner', '10'], ['Banner', '3'], ['Video', '20'], ['Video', '5']]
  );
});

test('sortRows: no keys returns a copy in original order', () => {
  const rows = [['b'], ['a']];
  const out = sortRows(rows, []);
  assert.deepStrictEqual(out, [['b'], ['a']]);
  assert.notStrictEqual(out, rows); // new array, input not mutated
});

const { sumColumns, summarizeRows } = require('../transforms.js');

test('sumColumns: totals numeric columns, blanks non-numeric', () => {
  const rows = [['Banner', '$1,000', '5'], ['Video', '2,000', '3']];
  assert.deepStrictEqual(sumColumns(rows), ['', '3000', '8']);
});

test('sumColumns: rounds float noise off', () => {
  assert.deepStrictEqual(sumColumns([['', '0.1'], ['', '0.2']]), ['', '0.3']);
});

test('summarizeRows: appends a grand-total row (no grouping)', () => {
  const rows = [['Jan', '10'], ['Feb', '20']];
  assert.deepStrictEqual(summarizeRows(rows, {}), [
    ['Jan', '10'],
    ['Feb', '20'],
    ['Total', '30']
  ]);
});

test('summarizeRows: subtotal per group plus a grand total', () => {
  const rows = [['Banner', '10'], ['Banner', '5'], ['Video', '20']];
  assert.deepStrictEqual(summarizeRows(rows, { groupIndex: 0, labelIndex: 0 }), [
    ['Banner', '10'],
    ['Banner', '5'],
    ['Subtotal: Banner', '15'],
    ['Video', '20'],
    ['Subtotal: Video', '20'],
    ['Total', '35']
  ]);
});

test('summarizeRows: single group omits the redundant grand total', () => {
  const rows = [['Banner', '10'], ['Banner', '5']];
  assert.deepStrictEqual(summarizeRows(rows, { groupIndex: 0, labelIndex: 0 }), [
    ['Banner', '10'],
    ['Banner', '5'],
    ['Subtotal: Banner', '15']
  ]);
});

test('summarizeRows: empty input yields no rows', () => {
  assert.deepStrictEqual(summarizeRows([], {}), []);
});

test('summarizeRows: labelIndex -1 preserves numeric total columns', () => {
  const rows = [['10', '1'], ['20', '2']];
  assert.deepStrictEqual(summarizeRows(rows, { labelIndex: -1 }), [
    ['10', '1'],
    ['20', '2'],
    ['30', '3']
  ]);
});
