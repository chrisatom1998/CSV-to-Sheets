# CSV to Sheets — gTech ads

A Chrome extension (Manifest V3) that takes a CSV/TSV file, maps its columns onto
headers the user chooses, and copies a clean **tab-separated** block to the clipboard,
ready to paste into Google Sheets.

## Why this exists (the core constraint)

This tool was built for a **managed Chrome environment where enterprise policy
(`runtime_blocked_hosts`) blocks all extensions from running on `*.google.com`** —
including Google Sheets, AdMob, and `ics.corp.google.com`. That means an extension
**cannot** inject a content script into a Google page or `fetch` a Google host.

Consequence for the design: **the extension never touches a Google page.** It does all
its work inside its own popup (which is not a `google.com` page, so the policy can't
reach it), prepares the clipboard, and the *user* pastes into the Sheet manually
(Ctrl/Cmd+V). Do not add content scripts, host permissions, or Google API calls to
"automate" the paste — they will be blocked by policy and break the whole premise.

## Architecture

Everything runs in the **popup**. There is no background service worker and no content
script. Permissions are `storage` (remembering the last headers/mapping), `clipboardRead`
(the "Paste headers from sheet" button), and `unlimitedStorage` (lifts `storage.local`'s
default 5 MB quota so larger remembered files fit). All are plain API permissions,
**not host permissions** — they don't touch `*.google.com`, so the enterprise policy
above doesn't reach them.

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest. `permissions: ["storage", "clipboardRead", "unlimitedStorage"]`, popup-only, **no host permissions / no content scripts** (intentional — see above). |
| `popup.html` | 4-step modular UI (Upload → Headers → Map → Copy) + preview. Element IDs are the contract with `popup.js` — keep them stable. |
| `popup.css` | Material-modular light theme. The gTech logo's four-color ring is the palette system: step 1 blue, 2 red, 3 yellow, 4 green (`--accent` per `.module`). |
| `popup.js` | All DOM logic: CSV parsing, delimiter detection, skip-rows/header handling, quick-add header chips, column mapping, number cleaning, TSV build, clipboard copy, persistence. Pure transforms live in `transforms.js`. |
| `transforms.js` | **Pure, DOM-free** data transforms shared by the popup and the Node tests: `parseCSV(text, delim)` (RFC-4180-ish), `detectDelimiter(text)` (multi-row sampling sniffer), `cleanNumeric(value)` (normalize currency/thousands; leave percents/text untouched), `splitRows(rawRows, {skip, firstRowHeader})`, `splitTargets(value)`, plus header-matching helpers `autoMatchIndex(target, csvHeaders)` (returns a column **index**, -1 if none) and `headerMatchConfidence(target, header)` (`'exact'`/`'similar'`/`'none'`). Exposed as `globalThis.Transforms` and `module.exports`; loaded via `<script>` before `popup.js`. |
| `test/transforms.test.js` | Node `node:test` unit tests for `transforms.js`. Run `node --test`. No deps, offline. |
| `gtech_logo_horizontal.png` | Brand logo, background made transparent. |
| `icons/` | Extension icons (16/32/48/128) registered in `manifest.json` under both `icons` and `action.default_icon`. **Dark-tile design** (deep slate squircle `#1E2436`→`#11151F` so the icon stays visible on a white toolbar) + enlarged gTech four-color ring + bold white "CSV" wordmark centered inside it. **Size-specific**: 16px is ring-only (text is illegible at that size); 32/48/128 include the CSV wordmark. Regenerate with `python3 icons/_gen_icons.py` — it composes the SVG ring + Outfit text in HTML and renders/downscales via Playwright+PIL (LANCZOS). |
| `fonts/` | **Locally bundled** woff2 (Outfit display, Spline Sans Mono for data) + `fonts.css`. No CDN refs — must stay fully offline/policy-proof. |

## Data flow (popup.js)

1. File loaded (`handleFile`) → `Transforms.detectDelimiter` sniffs comma/tab/semicolon/pipe
   by **sampling several rows** (parses a sample with each candidate and scores by
   column-count consistency, so a metadata line or a quoted comma can't mislead it) →
   `Transforms.parseCSV(text, delimiter)` (RFC-4180-ish: quotes, embedded
   delimiters/newlines, `""` escapes, CRLF, BOM).
2. `applyHeaderMode()` calls `Transforms.splitRows(rawRows, {skip: getSkip(), firstRowHeader})`
   — it drops the first N "skip" rows, then splits the rest into `csvHeaders` + `csvRows`
   per the "first row is header" toggle.
3. User types target headers, loads a named **mapping preset**, clicks **Paste headers
   from sheet** (reads a tab/newline header row off the clipboard via `splitTargets`),
   or toggles **quick-add** header chips (`toggleHeader`). `renderMapping()` builds one
   `<select>` per target. Each select's
   **value is the column index** (not the header text), so duplicate header names stay
   distinct. The name-based auto-match (`Transforms.autoMatchIndex`) seeds the selection,
   and a confidence **badge** (Exact / Similar / Manual / Blank, via
   `Transforms.headerMatchConfidence`) sits beside each row so users can spot a wrong or
   blank mapping before copying.
4. `buildMatrix()` / `buildTSV()` reorder/subset CSV columns to the target headers (by the
   stored column index) and
   emit tab-separated text. When "Clean numbers" is on, each mapped **data** cell is run
   through `Transforms.cleanNumeric` (header row excluded). The `#btn-copy` click handler
   writes the TSV via `navigator.clipboard.writeText`.
5. Settings persist via `chrome.storage.local` (`persist` / `restore`): `targetHeaders`,
   `columnMapping`, `activeMappingPreset`, `mappingPresets`, `firstRowHeader`,
   `includeHeader`, `headerOptions`, `skipRows`, `cleanNumbers`, `sortBy`,
   `sortDir`, `groupBy`. The **uploaded file** also persists across popup sessions
   (`persistFile` / `clearPersistedFile`, keys `csvText` / `csvFileName` / `csvDelim`):
   the raw text is stored on upload and re-parsed by `restore` (more compact than the
   parsed rows), so reopening the popup shows the same data. Capped at
   `PERSIST_FILE_MAX_BYTES` (20 MB; the `unlimitedStorage` permission lifts the default
   5 MB `storage.local` quota) — larger files aren't remembered. Stored unencrypted on
   disk like all `storage.local` data.

## Key conventions

- **Output is TSV** (`\t` separated, `\n` rows). Google Sheets splits a pasted TSV into
  cells. Cell values are sanitized (tabs/newlines → spaces) so the grid never breaks.
- **Quick-add headers**: `headerOptions` (seeded from `DEFAULT_HEADER_OPTIONS`) is the
  palette of per-header toggle chips. Clicking a chip adds its header to the target list
  (appended in click order) or removes it if already present (`toggleHeader`); each chip
  shows an active state while selected. The `<textarea>` stays the editable source of truth.
- The palette itself is **user-editable and persisted** (`headerOptions` key in
  `chrome.storage.local`): the dashed **+ Add** chip swaps to an inline input that commits
  on Enter or blur and cancels on Escape (`startAddHeader` → `addHeaderOption`, case-
  insensitive de-dupe); each chip has a corner **×** badge that deletes it permanently
  (`removeHeaderOption`). Removing a chip also strips that header from the current
  target list (the `<textarea>`), so it disappears from the selection too.
- **Mapping presets**: `mappingPresets` is an array of named snapshots with
  `targetHeaders` plus the current name-keyed `columnMapping`. Applying a preset fills
  the textarea and seeds `renderMapping._saved`; if a preset has no saved mapping, the
  existing auto-match behavior seeds the selects from CSV headers.
- **Blank mapping warning**: `#mapping-warning` appears above copy whenever one or more
  target headers are mapped to `__ignore__` or an invalid column. Copy is still allowed,
  but users can see which output columns will paste blank.
- **Large CSV guardrails**: files at/above 5 MB and parsed CSVs at/above 50k rows show
  warnings. Preview remains capped to `PREVIEW_ROWS` rows; full copy still processes all
  parsed rows.
- **Skip rows**: the "Skip first N rows" input (Upload module) drops metadata
  rows above the header before `splitRows` runs; persisted as `skipRows`.
- **Clean numbers**: the "Clean numbers" toggle (Copy module, default on) runs
  each mapped data cell through `Transforms.cleanNumeric` in `buildMatrix` (the
  header row is never cleaned); persisted as `cleanNumbers`. US conventions only
  (`.` decimal, `,` thousands); percents pass through untouched.
- `chrome.*` calls (`persist`, `restore`) are wrapped in try/catch so a storage failure
  never breaks the UI — also lets the popup render in a plain browser for testing.
- Respect the four-color step system and the `--accent` pattern when adding UI. Fonts:
  Outfit for UI, Spline Sans Mono for any data/readout/code-like surface.

## Testing / previewing

No build step — load unpacked at `chrome://extensions` (Developer mode → Load unpacked →
select this folder). After editing, reload the extension card.

Static rendering for visual checks (no Chrome extension APIs needed; the UI degrades
gracefully because `chrome.*` is guarded):

```bash
node --check popup.js transforms.js   # syntax check
node --test                            # unit tests for transforms.js
# Render with Playwright (chromium) for screenshots:
python3 - <<'PY'
from playwright.sync_api import sync_playwright
import pathlib
url = pathlib.Path('popup.html').resolve().as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width':408,'height':1100}, device_scale_factor=2)
    pg.goto(url); pg.wait_for_timeout(800)
    pg.screenshot(path='/tmp/popup.png', full_page=True)
    b.close()
PY
```

## Out of scope / do not add

- Content scripts, host permissions, or scraping of Google pages (policy-blocked).
- Remote font/script/style loading — keep everything bundled and offline.
- Direct Sheets API writes (OAuth goes through the blocked `accounts.google.com`).
