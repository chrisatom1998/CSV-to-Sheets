# Design: Number cleaning + Skip leading rows

Date: 2026-06-16
Status: Approved (pending spec review)

## Summary

Two self-contained improvements to the CSV → Sheets popup, both pure data
transforms:

1. **Clean numbers** — normalize numeric-looking cells (strip currency symbols
   and thousands separators) so pasted values are real numbers in Google Sheets
   and `SUM()`/`AVERAGE()` work. Toggle, default **ON**, numeric-only.
2. **Skip first N rows** — drop metadata/title rows that appear above the real
   header row in AdMob/mediation CSV exports. Manual number input, default 0.

Both respect the core constraint: everything stays in the popup, offline, no
Google access, no new permissions.

## Architecture

The transform logic lives today inside the `DOMContentLoaded` closure in
`popup.js`, tangled with DOM access. Extract the pure parts into a new
`transforms.js` so they can be unit-tested in Node without a browser and reused
by the popup unchanged.

`transforms.js` is a dual browser/Node module:

```js
(function (root) {
  function cleanNumeric(value) { /* ... */ }
  function splitRows(rawRows, opts) { /* ... */ }
  const api = { cleanNumeric, splitRows };
  root.Transforms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Loaded in `popup.html` via `<script src="transforms.js"></script>` **before**
`popup.js`. No build step; no CDN; stays policy-proof.

## Components

### `cleanNumeric(value) -> string`

Pure. Returns a normalized numeric string when `value` is *clearly* a number;
otherwise returns the original `value` unchanged (never throws).

Algorithm:
1. `s = String(value).trim()`. If empty, return original `value`.
2. If `s` contains `%`, return original `value` (percents left untouched —
   Google Sheets parses `45.2%` into `0.452` shown as `45.2%` on its own).
3. Detect negative: accounting parentheses `(...)` or a leading `-`. Strip the
   marker, set `neg = true`.
4. Strip currency symbols and all space variants: `$ € £ ¥ ₹`, regular space,
   NBSP (` `), narrow NBSP (` `).
5. Classify the remaining string:
   - US-grouped `^\d{1,3}(,\d{3})+(\.\d+)?$` → remove commas.
   - Plain `^-?\d+(\.\d+)?$` (no commas) → keep as-is.
   - Otherwise → return the original `value` (not a clean number).
6. Return `(neg ? '-' : '') + s`.

Conservative by design: ambiguous `1,23` (European decimal) is **not** grouped,
so it is returned untouched rather than mangled. Dates (`2026-06-01`), IDs with
dashes, and text are returned untouched.

Scope limitation (documented, accepted): US conventions only — `.` decimal, `,`
thousands. European decimal-comma formats are out of scope (YAGNI for the
gTech/AdMob US context).

### `splitRows(rawRows, { skip, firstRowHeader }) -> { headers, rows }`

Pure. Replaces the inline logic in `applyHeaderMode`.
1. `n = Math.max(0, Math.floor(skip) || 0)`.
2. `body = rawRows.slice(n)`.
3. If `body` is empty → `{ headers: [], rows: [] }`.
4. If `firstRowHeader`: `headers = body[0]` (blank cells → `Column k`),
   `rows = body.slice(1)`.
   Else: `headers = ['Column 1' … 'Column m']` for the widest row,
   `rows = body`.

## UI

- **Skip rows** (Upload module, step 1): a labeled number input
  `id="input-skip-rows"`, `min=0`, default `0`, placed under the "First row is
  the header" toggle. On `input`/`change`: re-run header mode, mapping, preview,
  and persist.
- **Clean numbers** (Copy module, step 4): a switch row
  `id="chk-clean-numbers"` like the existing toggles, checked by default, label
  "Clean numbers ($, commas, spaces)". On `change`: re-render preview and
  persist.

## Data flow changes (popup.js)

- `applyHeaderMode()` calls `Transforms.splitRows(rawRows, { skip, firstRowHeader })`
  and assigns `csvHeaders`/`csvRows`, then updates the `csv-info` readout. When
  the skip count consumes all rows, the readout states everything was skipped
  and the mapping/preview show their empty states.
- `buildMatrix()` cell builder: when `chk-clean-numbers` is checked, run the
  mapped value through `Transforms.cleanNumeric` before the existing
  tab/newline sanitize. The header row (`targets.slice()`) is **never** cleaned.

## Error handling

- Skip input: non-numeric or negative → treated as 0 (clamped in `splitRows`).
- Over-skip (`n >= rawRows.length`): empty `headers`/`rows`; UI shows empty
  states; Copy button stays disabled (existing `updateCopyEnabled` guard).
- `cleanNumeric` never throws; any non-number returns the original value.

## Persistence

Add to the existing `chrome.storage.local` set/get (`persist`/`restore`):
- `skipRows` (number, default 0)
- `cleanNumbers` (boolean, default true)

Wrapped in the existing try/catch so storage failure never breaks the UI.

## Testing

`test/transforms.test.js` using Node's built-in `node:test` + `node:assert`
(zero dependencies; run `node --test`). Cases:

`cleanNumeric`:
- `$1,234.56` → `1234.56`; `1,000` → `1000`; `1,234,567.8` → `1234567.8`
- NBSP/narrow-NBSP/space thousands → digits only
- `(1,234.56)` → `-1234.56`; `-$50` → `-50`
- `45.2%` → `45.2%` (untouched); `100%` → `100%`
- non-numbers untouched: `AdMob`, `2026-06-01`, `1,23`, ``, `N/A`
- plain numbers unchanged: `12345`, `12.5`

`splitRows`:
- skip 0 + header → first row is header
- skip 2 + header → third row is header, rest are data
- skip 0 + no header → synthetic `Column k`, all rows are data
- over-skip (n ≥ total) → `{ headers: [], rows: [] }`
- negative/NaN skip → treated as 0

Also: `node --check popup.js transforms.js` for syntax, and a Playwright render
sanity check of the popup with the two new controls present.

## Files

- **new** `transforms.js` — pure `cleanNumeric`, `splitRows` (browser + Node).
- **new** `test/transforms.test.js` — Node unit tests.
- **modify** `popup.html` — `<script src="transforms.js">` before `popup.js`;
  skip-rows input; clean-numbers toggle.
- **modify** `popup.js` — use `Transforms`; wire + persist/restore the two
  controls.
- **modify** `popup.css` — number-input styling.
- **modify** `CLAUDE.md` — document the transforms module, the two controls, and
  the test command.

## Out of scope (YAGNI)

- European decimal-comma parsing.
- Per-column cleaning rules (global toggle only).
- Auto-detecting the header row (manual skip chosen instead).
- Currency conversion or rounding.
