# Number Cleaning + Skip Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (1) opt-in numeric cleaning so pasted values are real numbers in Google Sheets, and (2) a "skip first N rows" control to drop metadata rows above the real header, in the CSV→Sheets popup.

**Architecture:** Extract the two pure transforms into a new dual browser/Node module `transforms.js` (`cleanNumeric`, `splitRows`), unit-tested with Node's built-in test runner. `popup.js` consumes them via `globalThis.Transforms`; two new UI controls drive them and persist to `chrome.storage.local`.

**Tech Stack:** Vanilla JS (Chrome MV3 popup, no build step), Node `node:test`/`node:assert` for unit tests, Playwright (already installed) for a UI render sanity check.

> **Note — not a git repo:** This project is not under git, so the usual per-task `git commit` is replaced by a **Checkpoint** step (run tests / `node --check`). If you initialize git later, commit at each checkpoint with the suggested message.

---

## File Structure

- **Create** `transforms.js` — pure `cleanNumeric(value)` and `splitRows(rawRows, opts)`; one responsibility: data transforms, no DOM.
- **Create** `test/transforms.test.js` — Node unit tests for the two functions.
- **Modify** `popup.html` — load `transforms.js` before `popup.js`; add skip-rows input (Upload module) and clean-numbers toggle (Copy module).
- **Modify** `popup.js` — use `Transforms.splitRows` in `applyHeaderMode`, `Transforms.cleanNumeric` in `buildMatrix`; wire + persist/restore the two controls.
- **Modify** `popup.css` — style the number input.
- **Modify** `CLAUDE.md` — document the module, controls, and test command.

---

## Task 1: `cleanNumeric` in transforms.js (TDD)

**Files:**
- Create: `transforms.js`
- Test: `test/transforms.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/transforms.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { cleanNumeric } = require('../transforms.js');

test('cleanNumeric: strips currency and thousands separators', () => {
  assert.strictEqual(cleanNumeric('$1,234.56'), '1234.56');
  assert.strictEqual(cleanNumeric('1,000'), '1000');
  assert.strictEqual(cleanNumeric('1,234,567.8'), '1234567.8');
});

test('cleanNumeric: strips space/NBSP/narrow-NBSP thousands separators', () => {
  assert.strictEqual(cleanNumeric('1 000'), '1000');        // regular space
  assert.strictEqual(cleanNumeric('1 000'), '1000');   // NBSP
  assert.strictEqual(cleanNumeric('1 000'), '1000');   // narrow NBSP
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

test('cleanNumeric: leaves plain numbers unchanged', () => {
  assert.strictEqual(cleanNumeric('12345'), '12345');
  assert.strictEqual(cleanNumeric('12.5'), '12.5');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --test`
Expected: FAIL — `Cannot find module '../transforms.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `transforms.js`:

```js
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

    // Strip currency symbols and every space variant (incl. NBSP, narrow NBSP).
    s = s.replace(/[\s  $€£¥₹]/g, '');

    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
      s = s.replace(/,/g, '');           // US grouped -> remove commas
    } else if (!/^\d+(\.\d+)?$/.test(s)) {
      return original;                    // not a clean number
    }
    return (neg ? '-' : '') + s;
  }

  const api = { cleanNumeric };
  root.Transforms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --test`
Expected: PASS — all 6 `cleanNumeric` tests pass.

- [ ] **Step 5: Checkpoint**

Run: `node --check transforms.js && echo OK`
Expected: `OK`. (If using git: `git add transforms.js test/transforms.test.js && git commit -m "feat: add cleanNumeric transform with tests"`.)

---

## Task 2: `splitRows` in transforms.js (TDD)

**Files:**
- Modify: `transforms.js`
- Test: `test/transforms.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/transforms.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --test`
Expected: FAIL — `splitRows` is `undefined` (TypeError: not a function).

- [ ] **Step 3: Write minimal implementation**

In `transforms.js`, add the `splitRows` function above the `api` line, and add it to `api`:

```js
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
```

Change the api line from:

```js
  const api = { cleanNumeric };
```

to:

```js
  const api = { cleanNumeric, splitRows };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --test`
Expected: PASS — all `cleanNumeric` + `splitRows` tests pass (12 tests).

- [ ] **Step 5: Checkpoint**

Run: `node --check transforms.js && echo OK`
Expected: `OK`. (Git: `git commit -am "feat: add splitRows transform with tests"`.)

---

## Task 3: Skip-rows feature wired into the popup

**Files:**
- Modify: `popup.html` (load script + Upload-module input)
- Modify: `popup.js` (refs, getSkip, applyHeaderMode, listener, persist/restore)
- Modify: `popup.css` (number input)

- [ ] **Step 1: Load transforms.js in popup.html**

In `popup.html`, change:

```html
  <script src="popup.js"></script>
```

to:

```html
  <script src="transforms.js"></script>
  <script src="popup.js"></script>
```

- [ ] **Step 2: Add the skip-rows input to the Upload module**

In `popup.html`, inside the Upload `<section>` (step 1), immediately AFTER the `</label>` that closes the `switch-row` for `chk-first-row-header` and BEFORE `<div id="csv-info" ...>`, insert:

```html
      <label class="num-row">
        <span class="num-label">Skip first</span>
        <input type="number" id="input-skip-rows" min="0" value="0" inputmode="numeric">
        <span class="num-label">rows above the header</span>
      </label>
```

- [ ] **Step 3: Add element refs in popup.js**

In `popup.js`, after the line:

```js
  const chkFirstRowHeader = document.getElementById('chk-first-row-header');
```

add:

```js
  const inputSkipRows = document.getElementById('input-skip-rows');
```

- [ ] **Step 4: Add getSkip() and replace applyHeaderMode body**

In `popup.js`, replace the entire `applyHeaderMode` function:

```js
  function applyHeaderMode() {
    if (rawRows.length === 0) {
      csvHeaders = [];
      csvRows = [];
      csvInfo.classList.add('hidden');
      return;
    }

    if (chkFirstRowHeader.checked) {
      csvHeaders = rawRows[0].map((h, idx) => (h && h.trim()) ? h.trim() : `Column ${idx + 1}`);
      csvRows = rawRows.slice(1);
    } else {
      const colCount = Math.max(...rawRows.map(r => r.length));
      csvHeaders = Array.from({ length: colCount }, (_, idx) => `Column ${idx + 1}`);
      csvRows = rawRows.slice();
    }

    csvInfo.textContent = `${csvRows.length} rows, ${csvHeaders.length} columns (${delimiterName(detectedDelim)}-delimited).`;
    csvInfo.classList.remove('hidden');
  }
```

with:

```js
  function getSkip() {
    return Math.max(0, Math.floor(Number(inputSkipRows.value)) || 0);
  }

  function applyHeaderMode() {
    const split = Transforms.splitRows(rawRows, {
      skip: getSkip(),
      firstRowHeader: chkFirstRowHeader.checked
    });
    csvHeaders = split.headers;
    csvRows = split.rows;

    if (rawRows.length === 0) {
      csvInfo.classList.add('hidden');
      return;
    }
    if (csvHeaders.length === 0) {
      csvInfo.textContent = `All ${rawRows.length} rows skipped — lower the "skip first N rows" value.`;
      csvInfo.classList.remove('hidden');
      return;
    }
    csvInfo.textContent = `${csvRows.length} rows, ${csvHeaders.length} columns (${delimiterName(detectedDelim)}-delimited).`;
    csvInfo.classList.remove('hidden');
  }
```

- [ ] **Step 5: Wire the skip input listener**

In `popup.js`, find the existing listener:

```js
  chkFirstRowHeader.addEventListener('change', () => {
    applyHeaderMode();
    renderMapping();
    renderPreview();
  });
```

and immediately AFTER it add:

```js
  inputSkipRows.addEventListener('input', () => {
    applyHeaderMode();
    renderMapping();
    renderPreview();
    persist();
  });
```

- [ ] **Step 6: Persist and restore skipRows**

In `popup.js` `persist()`, change the object passed to `chrome.storage.local.set` from:

```js
      chrome.storage.local.set({
        targetHeaders: inputTargetHeaders.value,
        columnMapping: getMapping(),
        firstRowHeader: chkFirstRowHeader.checked,
        includeHeader: chkIncludeHeader.checked
      });
```

to (add the `skipRows` line):

```js
      chrome.storage.local.set({
        targetHeaders: inputTargetHeaders.value,
        columnMapping: getMapping(),
        firstRowHeader: chkFirstRowHeader.checked,
        includeHeader: chkIncludeHeader.checked,
        skipRows: getSkip()
      });
```

In `restore()`, change the `get` key list to include `'skipRows'`:

```js
      const data = await chrome.storage.local.get(
        ['targetHeaders', 'columnMapping', 'firstRowHeader', 'includeHeader', 'headerOptions', 'skipRows']
      );
```

and after the `headerOptions` restore line add:

```js
      if (typeof data.skipRows === 'number') inputSkipRows.value = String(data.skipRows);
```

- [ ] **Step 7: Add CSS for the number input**

In `popup.css`, immediately AFTER the `.chip-row { ... }` rule (near the chip styles), add:

```css
.num-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.num-label { font-size: 13px; color: var(--g-grey-700); }
#input-skip-rows {
  width: 64px;
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid var(--g-grey-300);
  border-radius: 8px;
  background: var(--surface);
  color: var(--g-grey-900);
}
#input-skip-rows:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}
```

- [ ] **Step 8: Syntax check**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --check popup.js && echo OK`
Expected: `OK`.

- [ ] **Step 9: UI render + functional check (Playwright)**

Run this script (save to `/tmp/check_skip.py`, then `python3 /tmp/check_skip.py`):

```python
from playwright.sync_api import sync_playwright
import pathlib
url = pathlib.Path('/home/chrismjohnson/CSV to Sheets/popup.html').resolve().as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width':408,'height':1000}, device_scale_factor=2)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(600)
    assert pg.locator('#input-skip-rows').count() == 1, 'skip input missing'
    # Simulate a file with 2 metadata rows above the header by driving the parser:
    pg.fill('#input-skip-rows', '2')
    pg.eval_on_selector('#input-skip-rows', "el => el.dispatchEvent(new Event('input',{bubbles:true}))")
    pg.wait_for_timeout(200)
    assert not errs, f'page errors: {errs}'
    print('skip input present, no page errors')
    b.close()
```

Expected: `skip input present, no page errors`.

- [ ] **Step 10: Checkpoint**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --test && node --check popup.js && echo OK`
Expected: tests PASS, `OK`. (Git: `git commit -am "feat: skip first N rows above the header"`.)

---

## Task 4: Clean-numbers toggle wired into the popup

**Files:**
- Modify: `popup.html` (Copy-module toggle)
- Modify: `popup.js` (ref, buildMatrix, listener, persist/restore)

- [ ] **Step 1: Add the toggle to the Copy module**

In `popup.html`, inside the Copy `<section>` (step 4), immediately AFTER the `</label>` that closes the `switch-row` for `chk-include-header` and BEFORE `<button id="btn-copy" ...>`, insert:

```html
      <label class="switch-row">
        <input type="checkbox" id="chk-clean-numbers" checked>
        <span class="track"></span>
        <span class="switch-label">Clean numbers ($, commas, spaces)</span>
      </label>
```

- [ ] **Step 2: Add the element ref**

In `popup.js`, after:

```js
  const chkIncludeHeader = document.getElementById('chk-include-header');
```

add:

```js
  const chkCleanNumbers = document.getElementById('chk-clean-numbers');
```

- [ ] **Step 3: Apply cleanNumeric in buildMatrix**

In `popup.js` `buildMatrix`, replace the cell-mapping block:

```js
      const cols = targets.map(t => {
        const mapped = mapping[t];
        if (!mapped || mapped === '__ignore__') return '';
        const idx = csvHeaders.indexOf(mapped);
        if (idx === -1) return '';
        const val = row[idx] != null ? row[idx] : '';
        // Sanitize so TSV structure survives a paste.
        return String(val).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
      });
```

with:

```js
      const cols = targets.map(t => {
        const mapped = mapping[t];
        if (!mapped || mapped === '__ignore__') return '';
        const idx = csvHeaders.indexOf(mapped);
        if (idx === -1) return '';
        let val = row[idx] != null ? row[idx] : '';
        if (chkCleanNumbers.checked) val = Transforms.cleanNumeric(val);
        // Sanitize so TSV structure survives a paste.
        return String(val).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
      });
```

- [ ] **Step 4: Wire the toggle listener**

In `popup.js`, find:

```js
  chkIncludeHeader.addEventListener('change', () => { renderPreview(); persist(); });
```

and immediately AFTER it add:

```js
  chkCleanNumbers.addEventListener('change', () => { renderPreview(); persist(); });
```

- [ ] **Step 5: Persist and restore cleanNumbers**

In `popup.js` `persist()`, add `cleanNumbers` to the set object (after `skipRows`):

```js
        skipRows: getSkip(),
        cleanNumbers: chkCleanNumbers.checked
```

In `restore()`, add `'cleanNumbers'` to the `get` key list, and after the `skipRows` restore line add:

```js
      if (typeof data.cleanNumbers === 'boolean') chkCleanNumbers.checked = data.cleanNumbers;
```

- [ ] **Step 6: Syntax check**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --check popup.js && echo OK`
Expected: `OK`.

- [ ] **Step 7: UI render + functional check (Playwright)**

Run this script (save to `/tmp/check_clean.py`, then `python3 /tmp/check_clean.py`):

```python
from playwright.sync_api import sync_playwright
import pathlib
url = pathlib.Path('/home/chrismjohnson/CSV to Sheets/popup.html').resolve().as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width':408,'height':1000}, device_scale_factor=2)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(600)
    assert pg.locator('#chk-clean-numbers').count() == 1, 'clean-numbers toggle missing'
    assert pg.eval_on_selector('#chk-clean-numbers', 'el => el.checked') is True, 'should default ON'
    # Confirm the transform is reachable in the page context:
    out = pg.evaluate("() => Transforms.cleanNumeric('$1,234.56')")
    assert out == '1234.56', f'unexpected: {out}'
    assert not errs, f'page errors: {errs}'
    print('clean toggle present + default ON, transform reachable:', out)
    b.close()
```

Expected: `clean toggle present + default ON, transform reachable: 1234.56`.

- [ ] **Step 8: Checkpoint**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --test && node --check popup.js && echo OK`
Expected: tests PASS, `OK`. (Git: `git commit -am "feat: clean numbers toggle for paste"`.)

---

## Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add transforms.js to the architecture table**

In `CLAUDE.md`, in the architecture table, add a new row immediately AFTER the `popup.js` row:

```markdown
| `transforms.js` | **Pure, DOM-free** data transforms shared by the popup and the Node tests: `cleanNumeric(value)` (normalize currency/thousands; leave percents/text untouched) and `splitRows(rawRows, {skip, firstRowHeader})`. Exposed as `globalThis.Transforms` and `module.exports`; loaded via `<script>` before `popup.js`. |
| `test/transforms.test.js` | Node `node:test` unit tests for `transforms.js`. Run `node --test`. No deps, offline. |
```

- [ ] **Step 2: Document the two controls in Key conventions**

In `CLAUDE.md`, under "## Key conventions", add these bullets at the end of the list:

```markdown
- **Skip rows**: the "Skip first N rows" input (Upload module) drops metadata
  rows above the header before `splitRows` runs; persisted as `skipRows`.
- **Clean numbers**: the "Clean numbers" toggle (Copy module, default on) runs
  each mapped data cell through `Transforms.cleanNumeric` in `buildMatrix` (the
  header row is never cleaned); persisted as `cleanNumbers`. US conventions only
  (`.` decimal, `,` thousands); percents pass through untouched.
```

- [ ] **Step 3: Add the test command to Testing/previewing**

In `CLAUDE.md`, under "## Testing / previewing", change:

```bash
node --check popup.js   # syntax check
```

to:

```bash
node --check popup.js transforms.js   # syntax check
node --test                            # unit tests for transforms.js
```

- [ ] **Step 4: Checkpoint**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --test && echo OK`
Expected: tests PASS, `OK`. (Git: `git commit -am "docs: document transforms + new controls"`.)

---

## Task 6: Final full verification

**Files:** none (verification only)

- [ ] **Step 1: Run unit tests**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --test`
Expected: all tests PASS (12+).

- [ ] **Step 2: Syntax check both scripts**

Run: `cd "/home/chrismjohnson/CSV to Sheets" && node --check popup.js && node --check transforms.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Full popup render sanity (Playwright)**

Run this script (save to `/tmp/check_all.py`, then `python3 /tmp/check_all.py`):

```python
from playwright.sync_api import sync_playwright
import pathlib
url = pathlib.Path('/home/chrismjohnson/CSV to Sheets/popup.html').resolve().as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width':408,'height':1200}, device_scale_factor=2)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(700)
    for sel in ['#input-skip-rows', '#chk-clean-numbers', '#preset-chips .chip-add']:
        assert pg.locator(sel).count() >= 1, f'missing {sel}'
    assert not errs, f'page errors: {errs}'
    pg.screenshot(path='/tmp/popup_final.png', full_page=True)
    print('all controls present, no page errors -> /tmp/popup_final.png')
    b.close()
```

Expected: `all controls present, no page errors -> /tmp/popup_final.png`. Read the screenshot to eyeball the two new controls.

- [ ] **Step 4: Persistence regression (existing real-extension test)**

Run: `python3 /tmp/validate_quickadd_persist.py`
Expected: `VERDICT: PASS` (confirms the new persist/restore keys didn't break the existing storage round-trip).

---

## Self-Review (completed by plan author)

**Spec coverage:**
- cleanNumeric (currency/thousands/NBSP/negatives/percent pass-through/non-number safety) → Task 1 ✓
- splitRows (skip+header combinations, blank headers, over-skip clamp, NaN/negative) → Task 2 ✓
- transforms.js dual browser/Node module + `<script>` load order → Task 1 (module), Task 3 Step 1 (load) ✓
- Skip-rows UI + applyHeaderMode integration + over-skip message → Task 3 ✓
- Clean-numbers toggle (default on) + buildMatrix integration + header row never cleaned → Task 4 ✓
- Persistence of skipRows + cleanNumbers → Task 3 Step 6, Task 4 Step 5 ✓
- CSS for number input → Task 3 Step 7 ✓
- Tests via node:test; node --check; Playwright sanity → Tasks 1–4, 6 ✓
- CLAUDE.md docs → Task 5 ✓

**Placeholder scan:** none — every code/command step shows exact content.

**Type/name consistency:** `Transforms.cleanNumeric` / `Transforms.splitRows`, `getSkip()`, `inputSkipRows`, `chkCleanNumbers`, storage keys `skipRows`/`cleanNumbers` are used identically across tasks.
