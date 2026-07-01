// Pure data transforms shared by the popup (browser) and unit tests (Node).
// No DOM access. Exposed as globalThis.Transforms and module.exports.
(function (root) {
  // Normalize a clearly-numeric string (currency/thousands stripped) so Google
  // Sheets treats it as a number. Anything not clearly numeric is returned
  // unchanged. Percent values are left untouched (Sheets parses them itself).
  function cleanNumeric(value) {
    const original = value;
    let s = String(value == null ? '' : value).trim();
    if (s === '') return original;
    if (s.indexOf('%') !== -1) return original;

    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1).trim(); }

    // Strip currency symbols and every space variant (\s covers NBSP + narrow NBSP).
    s = s.replace(/[\s$€£¥₹]/g, '');

    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
      s = s.replace(/,/g, '');           // US grouped -> remove commas
    } else if (!/^\d+(\.\d+)?$/.test(s)) {
      return original;                    // not a clean number
    }
    return (neg ? '-' : '') + s;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function expandYear(y) {
    y = Number(y);
    if (y < 100) return y >= 70 ? 1900 + y : 2000 + y;
    return y;
  }

  function validDate(y, m, d) {
    y = expandYear(y); m = Number(m); d = Number(d);
    if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  // Normalize common report date formats to YYYY-MM-DD. Deliberately avoids
  // guessing dates that omit the year, so ordinary numbers are left alone.
  function normalizeDate(value) {
    const original = value;
    const s = String(value == null ? '' : value).trim();
    if (!s) return original;

    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}.*)?$/);
    if (m) return validDate(m[1], m[2], m[3]) || original;

    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T]\d{1,2}:\d{2}.*)?$/);
    if (m) return validDate(m[3], m[1], m[2]) || original;

    const months = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, sept: 9, september: 9,
      oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
    };
    m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{2,4})$/);
    if (m && months[m[1].toLowerCase()]) return validDate(m[3], months[m[1].toLowerCase()], m[2]) || original;

    m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})$/);
    if (m && months[m[2].toLowerCase()]) return validDate(m[3], months[m[2].toLowerCase()], m[1]) || original;

    return original;
  }

  // RFC 4180-ish parser: handles quoted fields, embedded delimiters/newlines,
  // "" escapes, CRLF, and a leading UTF-8 BOM. DOM-free so it can be unit-tested
  // and reused by the delimiter sniffer below.
  function parseCSV(text, delimiter) {
    const delim = delimiter || ',';
    text = String(text == null ? '' : text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM

    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

    // Drop fully-blank rows. This covers a bare blank line (one empty field) and
    // also a blank row whose column count was preserved by trailing delimiters
    // (",,," from Excel/Sheets exports) — otherwise such a row would survive to
    // become the header and splitRows would label every column "Column N".
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  // Sniff the field delimiter by sampling several rows rather than trusting the
  // first line (a metadata line or a quoted comma can mislead a one-line guess).
  // For each candidate we fully parse a sample with the real parser, find the
  // most common column count, and score by (columns gained) × (how consistent
  // that count is across rows). Only delimiters that actually split (>= 2
  // columns) compete; on a tie the delimiter producing more columns wins, and
  // only a true all-ways tie falls back to comma (first in the list).
  function detectDelimiter(text, opts) {
    opts = opts || {};
    const sampleSize = opts.sampleSize || 20;
    const candidates = [',', '\t', ';', '|'];
    const EPS = 1e-9; // scores are integer ratios, so equal splits compare exactly

    // Cap the work for large files: parse only the first ~sampleSize*4 lines.
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const sample = lines.slice(0, sampleSize * 4).join('\n');

    let best = ',', bestScore = -Infinity, bestModal = 0;
    for (const d of candidates) {
      const rows = parseCSV(sample, d).slice(0, sampleSize);
      if (rows.length === 0) continue;

      const freq = {};
      rows.forEach(r => { freq[r.length] = (freq[r.length] || 0) + 1; });
      let modal = 1, modalFreq = 0;
      for (const k in freq) {
        if (freq[k] > modalFreq) { modalFreq = freq[k]; modal = Number(k); }
      }
      if (modal < 2) continue; // this delimiter doesn't split the data

      const consistency = modalFreq / rows.length;
      const score = (modal - 1) * consistency;
      // Strictly better score wins; on a (near-)tie prefer more columns, so a
      // later candidate can still beat comma when it splits the data further.
      if (score > bestScore + EPS ||
          (Math.abs(score - bestScore) <= EPS && modal > bestModal)) {
        bestScore = score; best = d; bestModal = modal;
      }
    }
    return best;
  }

  // Lowercase + strip non-alphanumerics so "Ad source" ~ "ad_source" ~ "adSource".
  function normalizeString(str) {
    return String(str == null ? '' : str).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // How well a CSV header matches a target name: 'exact' (same normalized text),
  // 'similar' (one is a substring of the other), or 'none'.
  function headerMatchConfidence(target, header) {
    const nt = normalizeString(target);
    const nh = normalizeString(header);
    if (!nt || !nh) return 'none';
    if (nt === nh) return 'exact';
    if (nh.includes(nt) || nt.includes(nh)) return 'similar';
    return 'none';
  }

  // Index of the best-matching CSV header for a target: exact normalized match
  // first, then the first substring ("contains") match. -1 if nothing matches.
  // Returns an index (not the header text) so duplicate header names stay
  // distinguishable downstream.
  function autoMatchIndex(target, csvHeaders) {
    const nt = normalizeString(target);
    if (!nt) return -1;
    const heads = csvHeaders || [];
    for (let i = 0; i < heads.length; i++) {
      if (normalizeString(heads[i]) === nt) return i;
    }
    for (let i = 0; i < heads.length; i++) {
      const nh = normalizeString(heads[i]);
      if (nh && (nh.includes(nt) || nt.includes(nh))) return i;
    }
    return -1;
  }

  // Split parsed CSV rows into { headers, rows }, dropping the first `skip`
  // rows first. Mirrors the popup's previous inline header logic.
  function splitRows(rawRows, opts) {
    opts = opts || {};
    const n = Math.max(0, Math.floor(Number(opts.skip)) || 0);
    const body = (rawRows || []).slice(n);
    if (body.length === 0) return { headers: [], rows: [] };

    if (opts.firstRowHeader) {
      const headers = body[0].map((h, i) => (h && h.trim()) ? h.trim() : `Column ${i + 1}`);
      return { headers, rows: body.slice(1) };
    }
    const colCount = Math.max(...body.map(r => r.length));
    const headers = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
    return { headers, rows: body.slice() };
  }

  // Split the target-headers field into individual header names. The input is a
  // multi-line textarea, so users separate headers with commas, new lines, or
  // tabs (Enter is natural in a textarea; pasting a row of headers brings tabs).
  // None of those characters can appear inside a single header name here, so all
  // are treated as separators. Consecutive separators collapse; blanks dropped.
  function splitTargets(value) {
    return String(value == null ? '' : value)
      .split(/[,\n\r\t]+/)
      .map(h => h.trim())
      .filter(h => h !== '');
  }

  // Parse a value to a Number for sorting, or null if it isn't clearly numeric.
  // Reuses cleanNumeric's notion of "a number" (US currency/thousands) and also
  // accepts a trailing percent so "45.2%" sorts by its face value (45.2).
  function asNumber(value) {
    let s = String(value == null ? '' : value).trim();
    if (s === '') return null;
    if (s.indexOf('%') !== -1) s = s.replace(/%/g, '');
    const cleaned = cleanNumeric(s);
    return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
  }

  // Compare two cell values: numerically when both look numeric, otherwise as
  // case-insensitive text. Numeric values sort before text in ascending order.
  function compareValues(a, b) {
    const na = asNumber(a), nb = asNumber(b);
    if (na !== null && nb !== null) return na < nb ? -1 : na > nb ? 1 : 0;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    const sa = String(a == null ? '' : a).toLowerCase();
    const sb = String(b == null ? '' : b).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  // Stable multi-key sort of output rows. `keys` is an array of { index, dir }
  // (dir 'asc'|'desc'); earlier keys take precedence, so grouping is just the
  // first key. `rows` are arrays of cell strings; `index` is a column position.
  // Returns a new array (input is not mutated). Keys with a null/negative index
  // are ignored; with no usable keys the rows are returned in original order.
  function sortRows(rows, keys) {
    const list = (rows || []).slice();
    const ks = (keys || []).filter(k => k && Number(k.index) >= 0);
    if (ks.length === 0) return list;
    return list
      .map((row, i) => ({ row, i }))
      .sort((A, B) => {
        for (const k of ks) {
          const c = compareValues(A.row[k.index], B.row[k.index]);
          if (c !== 0) return k.dir === 'desc' ? -c : c;
        }
        return A.i - B.i; // stable: preserve original order on ties
      })
      .map(d => d.row);
  }

  // Sum the numeric cells of `rows` per column (currency/percent/thousands aware
  // via asNumber). Returns one string per column: the column total as a plain
  // number where any cell was numeric, otherwise ''. Float noise from summing is
  // rounded off (to 6 decimals) so totals read cleanly in a sheet.
  function sumColumns(rows) {
    const list = rows || [];
    const sums = [];
    const seen = [];
    let width = 0;
    list.forEach(r => {
      const row = r || [];
      if (row.length > width) width = row.length;
      row.forEach((cell, i) => {
        const n = asNumber(cell);
        if (n !== null) { sums[i] = (sums[i] || 0) + n; seen[i] = true; }
      });
    });
    const out = [];
    for (let i = 0; i < width; i++) {
      out.push(seen[i] ? String(Math.round(sums[i] * 1e6) / 1e6) : '');
    }
    return out;
  }

  // Append summary rows that sum the numeric columns. With a groupIndex the rows
  // (which must already be sorted so equal group values are contiguous) get a
  // subtotal row after each group; a grand-total row is appended when there is
  // more than one group, or always when ungrouped. The label string is written
  // into `labelIndex` (the group column when grouping, else column 0), overwriting
  // that column's own sum. Returns a new array; the input is not mutated.
  function summarizeRows(rows, opts) {
    opts = opts || {};
    const list = rows || [];
    const groupIndex = (opts.groupIndex != null && opts.groupIndex >= 0) ? opts.groupIndex : -1;
    const labelIndex = opts.labelIndex == null ? 0 : (opts.labelIndex >= 0 ? opts.labelIndex : -1);
    const totalLabel = opts.totalLabel != null ? opts.totalLabel : 'Total';
    const subtotalLabel = opts.subtotalLabel != null ? opts.subtotalLabel : 'Subtotal';
    if (list.length === 0) return [];

    const summaryFor = (group, label) => {
      const sums = sumColumns(group);
      if (labelIndex !== -1) sums[labelIndex] = label;
      return sums;
    };

    const out = [];
    if (groupIndex !== -1) {
      let i = 0, groups = 0;
      while (i < list.length) {
        const key = list[i][groupIndex];
        const group = [];
        while (i < list.length && list[i][groupIndex] === key) { group.push(list[i]); i++; }
        group.forEach(r => out.push(r));
        out.push(summaryFor(group, `${subtotalLabel}: ${key}`));
        groups++;
      }
      if (groups > 1) out.push(summaryFor(list, totalLabel)); // skip if it duplicates the lone subtotal
    } else {
      list.forEach(r => out.push(r));
      out.push(summaryFor(list, totalLabel));
    }
    return out;
  }

<<<<<<< HEAD
  // A column counts as numeric (summable) only when every non-blank cell in it
  // parses as a number — one stray text value (an ID, a note) keeps it a key
  // column instead of silently dropping that column's text on consolidation.
  function isNumericColumn(rows, index) {
    let sawValue = false;
    for (const row of rows) {
      const cell = row[index];
      if (cell == null || String(cell).trim() === '') continue;
      sawValue = true;
      if (asNumber(cell) === null) return false;
    }
    return sawValue;
  }

  // Merge rows that share the same value in every non-numeric ("key") column —
  // groupIndex is always treated as a key column even if it happens to look
  // numeric, since it's the field the caller explicitly grouped by — and sum
  // their numeric columns into one row. Rows that differ in any key column
  // (e.g. same date, different app) are left separate. Order follows first
  // occurrence of each key. Returns a new array; the input is not mutated.
  function consolidateRows(rows, groupIndex) {
    const list = rows || [];
    if (groupIndex == null || groupIndex < 0 || list.length === 0) return list.slice();

    let width = 0;
    list.forEach(r => { if ((r || []).length > width) width = r.length; });

    const numericCols = [];
    for (let i = 0; i < width; i++) numericCols[i] = i !== groupIndex && isNumericColumn(list, i);

    const order = [];
    const groups = new Map();
    list.forEach(row => {
      const key = JSON.stringify(row.map((cell, i) => numericCols[i] ? null : cell));
      if (!groups.has(key)) { groups.set(key, []); order.push(key); }
      groups.get(key).push(row);
    });

    return order.map(key => {
      const group = groups.get(key);
      if (group.length === 1) return group[0];
      const merged = group[0].slice();
      for (let i = 0; i < width; i++) {
        if (!numericCols[i]) continue;
        let sum = 0;
        group.forEach(r => { const n = asNumber(r[i]); if (n !== null) sum += n; });
        merged[i] = String(Math.round(sum * 1e6) / 1e6);
      }
      return merged;
    });
  }

  // RFC-4180 CSV encoding (comma-separated, "" escaped quotes), mirrors buildTSV's
  // tab-separated output. Used by the "Download CSV" button.
  function csvField(value) {
    const s = String(value == null ? '' : value);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(matrix) {
    return (matrix || []).map(row => row.map(csvField).join(',')).join('\r\n');
=======
  // Serialize a 2D array of strings to a standard RFC 4180 CSV string.
  // Encapsulates cells containing commas, double quotes, or newlines in double quotes,
  // and doubles any double quote characters inside the cell.
  function buildCSV(matrix) {
    return (matrix || []).map(row =>
      (row || []).map(cell => {
        const s = String(cell == null ? '' : cell);
        if (/[",\r\n]/.test(s)) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }).join(',')
    ).join('\n');
>>>>>>> origin/main
  }

  const api = {
    cleanNumeric, normalizeDate, splitRows, splitTargets,
    parseCSV, detectDelimiter, normalizeString,
    headerMatchConfidence, autoMatchIndex,
    asNumber, compareValues, sortRows,
<<<<<<< HEAD
    sumColumns, summarizeRows, consolidateRows, toCSV
=======
    sumColumns, summarizeRows, buildCSV
>>>>>>> origin/main
  };
  root.Transforms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
