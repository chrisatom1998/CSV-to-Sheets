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
| `popup.html` | 4-step modular UI (Upload → Headers → Map → Copy) + preview. Steps 1 & 2 have **collapsible heads** (`.collapsible` / `.module-head[role=button]` + `.module-summary` + `.collapse-chevron`). A **sticky copy bar** (`#sticky-cta` / `#btn-copy-sticky`) is pinned to the popup bottom. Element IDs are the contract with `popup.js` — keep them stable. |
| `popup.css` | Material-modular light theme. The gTech logo's four-color ring is the palette system: step 1 blue, 2 red, 3 yellow, 4 green (`--accent` per `.module`). |
| `popup.js` | All DOM logic: CSV parsing, delimiter detection, skip-rows/header handling, quick-add header chips, column mapping, number cleaning, TSV build, clipboard copy, persistence. Pure transforms live in `transforms.js`. |
| `transforms.js` | **Pure, DOM-free** data transforms shared by the popup, the parse worker, and the Node tests: `parseCSV(text, delim)` (RFC-4180-ish), `detectDelimiter(text)` (multi-row sampling sniffer), `decodeBytes(buffer)` (BOM/heuristic UTF-8 / UTF-16LE / UTF-16BE decoding of a file's raw bytes), `cleanNumeric(value, style)` (normalize currency/thousands; `style` `'us'` default or `'eu'` for `1.234,56`-style input; percents/text untouched), `detectNumberStyle(values)` (per-column `'us'`/`'eu'` sniffer; ambiguous → `'us'`), `splitRows(rawRows, {skip, firstRowHeader})`, `splitTargets(value)`, `toCSV(matrix)` (RFC-4180 CSV encoding, the inverse of `parseCSV`), `sortRows(rows, keys)` (stable multi-key), `rowPassesFilter(row, {index, op, value})` (one filter predicate; ops contains/equals/not-equals/blank/not-blank/gt/lt/gte/lte), `consolidateRows(rows, groupIndex, {agg})` (merges rows that share every non-numeric column into one, aggregating the numeric ones by `sum`/`avg`/`count`/`min`/`max`), plus header-matching helpers `autoMatchIndex(target, csvHeaders)` (returns a column **index**, -1 if none) and `headerMatchConfidence(target, header)` (`'exact'`/`'similar'`/`'none'`). Exposed as `globalThis.Transforms` and `module.exports`; loaded via `<script>` before `popup.js` and via `importScripts` in `parse-worker.js`. |
| `parse-worker.js` | Web Worker that runs `Transforms.detectDelimiter` + `Transforms.parseCSV` off the main thread so large files don't freeze the popup. `popup.js` (`parseAsync`) only uses it for text ≥ 512 KB and falls back to an inline parse whenever workers are unavailable (e.g. `file://` static previews) or fail. |
| `test/transforms.test.js` | Node `node:test` unit tests for `transforms.js`. Run `node --test`. No deps, offline. |
| `gtech_logo_horizontal.png` | Brand logo, background made transparent. |
| `icons/` | Extension icons (16/32/48/128) registered in `manifest.json` under both `icons` and `action.default_icon`. **Dark-tile design** (deep slate squircle `#1E2436`→`#11151F` so the icon stays visible on a white toolbar) + enlarged gTech four-color ring + bold white "CSV" wordmark centered inside it. **Size-specific**: 16px is ring-only (text is illegible at that size); 32/48/128 include the CSV wordmark. Regenerate with `python3 icons/_gen_icons.py` — it composes the SVG ring + Outfit text in HTML and renders/downscales via Playwright+PIL (LANCZOS). |
| `fonts/` | **Locally bundled** woff2 (Outfit display, Spline Sans Mono for data) + `fonts.css`. No CDN refs — must stay fully offline/policy-proof. |

## Data flow (popup.js)

1. File loaded (`handleFile`) → raw bytes read with `readAsArrayBuffer` and decoded by
   `Transforms.decodeBytes` (UTF-8 default; UTF-16LE/BE by BOM or NUL-byte heuristic) →
   `loadFromText` → `parseAsync`, which parses **in `parse-worker.js`** for text ≥ 512 KB
   (inline below that, or when workers are unavailable/fail). `Transforms.detectDelimiter`
   sniffs comma/tab/semicolon/pipe by **sampling several rows** (parses a sample with each
   candidate and scores by column-count consistency, so a metadata line or a quoted comma
   can't mislead it) → `Transforms.parseCSV(text, delimiter)` (RFC-4180-ish: quotes,
   embedded delimiters/newlines, `""` escapes, CRLF, BOM). All three load paths (fresh
   upload, delimiter re-parse, remembered-file restore) funnel through `loadFromText`,
   which drops superseded in-flight parses (`_loadSeq` token).
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
4. `buildMatrix()` reorders/subsets CSV columns to the target headers (by the stored
   column index), then applies the pipeline in order: **filters** (every active filter
   must pass, `Transforms.rowPassesFilter`) → **combine** (`Transforms.consolidateRows`
   with the chosen aggregation) → **sort** (`Transforms.sortRows` with group / sort /
   then-by keys from `getOrdering`). `buildTSV()` joins it with tabs/newlines and
   `Transforms.toCSV()` joins it as RFC-4180 CSV (comma-separated, `""`-escaped quoting,
   CRLF rows) — both read the same mapped matrix, so they always cover exactly the mapped
   columns. When "Clean numbers" is on, each mapped **data** cell is run through
   `Transforms.cleanNumeric` with a per-column `'us'`/`'eu'` style from
   `detectColumnStyles` (samples the first 200 source rows per mapped column via
   `Transforms.detectNumberStyle`); the header row is excluded. The `#btn-copy` click
   handler writes the TSV via `navigator.clipboard.writeText`; `#btn-download-tsv` /
   `#btn-download-csv` save the same matrix as a `.tsv` / `.csv` file
   (`downloadTSV` / `downloadCSV`, named `<source-file>-mapped.<ext>`).
5. Settings persist via `chrome.storage.local` (`persist` / `restore`): `targetHeaders`,
   `columnMapping`, `activeMappingPreset`, `mappingPresets`, `firstRowHeader`,
   `includeHeader`, `headerOptions`, `skipRows`, `cleanNumbers`, `sortBy`/`sortDir` (+
   `sortBy2`/`sortDir2` and the `*Target` name keys), `groupBy`, `consolidate`,
   `consolidateAgg`, `filters` (array of `{target, by, op, value}`; the legacy
   single-filter keys `filterBy`/`filterOp`/`filterValue` are migrated on restore),
   `previewRows`. The **uploaded file** also persists across popup sessions
   (`persistFile` / `clearPersistedFile`, keys `csvText` / `csvFileName` / `csvDelim`):
   the raw text is stored on upload and re-parsed by `restore` (more compact than the
   parsed rows), so reopening the popup shows the same data. Capped at
   `PERSIST_FILE_MAX_BYTES` (50 MB; the `unlimitedStorage` permission lifts the default
   5 MB `storage.local` quota) — larger files aren't remembered. Stored unencrypted on
   disk like all `storage.local` data.

## Key conventions

- **Copy output is TSV** (`\t` separated, `\n` rows) — Google Sheets splits a pasted TSV
  into cells. Cell values are sanitized (tabs/newlines → spaces) so the grid never breaks.
  The **TSV / CSV download buttons** (Copy module) save the same mapped columns as a file
  instead of the clipboard — CSV via `Transforms.toCSV` (comma-separated, quoted per
  RFC-4180) for opening elsewhere (Excel, re-importing, etc.).
- **Unified header chips** (`renderPresets`, container `#preset-chips`): one row that is
  both the selection palette and the column-order editor. **Selected** headers render first
  as red, draggable **`.header-bubble`**s in output-column order — dragging one calls
  `reorderTargets(from, to)` which reorders the target list and therefore the output/preview
  columns (`buildMatrix` reads `getTargets()` order). Each bubble has a **Req** toggle and a
  **× remove** (`removeTargetAt(index)`, position-based so duplicates stay distinct).
  **Unselected** `headerOptions` follow as grey chips (click → `toggleHeader` adds to the
  target list, appended). The `<textarea>` stays the editable source of truth.
  `renderTargetOrder` and `updateChipActive` are thin aliases of `renderPresets`.
- The palette itself is **user-editable and persisted** (`headerOptions` key in
  `chrome.storage.local`): the dashed **+ Add** chip swaps to an inline input that commits
  on Enter or blur and cancels on Escape (`startAddHeader` → `addHeaderOption`, case-
  insensitive de-dupe); each chip has a corner **×** badge that deletes it permanently
  (`removeHeaderOption`). Removing a chip also strips that header from the current
  target list (the `<textarea>`), so it disappears from the selection too.
- **Collapsing / summaries**: `setCollapsed(section, head, bool)` toggles `.collapsed`
  and `updateSummaries()` fills each collapsed head's `.module-summary` (cleared while
  expanded, where it just spaces the chevron to the right). Only **Upload auto-collapses**
  — after a file loads (`handleFile`), on a remembered-file restore, and re-expands on
  `clearFile`. Headers is collapsible by click but never auto-collapses. Both heads toggle
  on click / Enter / Space. The same pattern nests one level deeper for **Advanced options**
  (`#subsection-advanced` / `#head-advanced`, styled via `.subsection`/`.subsection-head`
  rather than `.module`/`.module-head`) inside the Copy module — it wraps Sort/Group/Combine/
  Filter and starts collapsed (state isn't persisted), but `maybeExpandAdvanced()` pops it
  open on restore / preset-apply when any of those settings are active (`advancedActive()`),
  so live settings never hide behind the fold. Its `#advanced-summary` line (filled in
  `updateSummaries()`, refreshed from `renderPreview()` since nearly every relevant control
  change already calls it) reads "Grouped", "Sorted", "Filtered ×N" (or combinations, or
  "No changes") so the settings are visible while collapsed.
- **Step 2 editing model**: the red header bubbles (above) are the primary editor once
  headers exist; the `<textarea>` is still the source of truth but tucks behind an
  **"Edit as text"** toggle (`#btn-toggle-text` → `updateHeadersView`, session-only
  `textEditOpen`; a `focus` listener keeps it open so the first keystroke can't hide it),
  and with no headers yet it stands alone as the entry point. Export/Import live in a `⋯`
  overflow menu (`#btn-preset-menu` → inline `#preset-menu`, not an absolute popover so
  `.module`'s `overflow:hidden` can't clip it).
- **Sticky copy**: `doCopy(btn)` is shared by `#btn-copy` and `#btn-copy-sticky`
  (`flashCopied` flashes whichever was clicked). `updateStickyCta()` (called from
  `updateCopyEnabled`) shows the bar only when a copy is possible and stamps the row count.
- **Mapping presets**: `mappingPresets` is an array of named snapshots with
  `targetHeaders`, the current name-keyed `columnMapping`, and a `pipeline` snapshot
  (`getPipelineState`: sort/then-by/group by target **name**, consolidate + agg, filters)
  so a preset is a full one-click recipe. Applying a preset fills the textarea, seeds
  `renderMapping._saved`, and — for presets that have one — replays the pipeline via
  `applyPipelineState` (which re-resolves names against the preset's targets and expands
  Advanced options if anything is active). Presets saved before pipelines existed leave
  the current sort/group/filter settings untouched. If a preset has no saved mapping, the
  existing auto-match behavior seeds the selects from CSV headers.
- **Blank mapping warning**: `#mapping-warning` appears above copy whenever one or more
  target headers are mapped to `__ignore__` or an invalid column. Copy is still allowed,
  but users can see which output columns will paste blank.
- **Large CSV guardrails**: files at/above 5 MB and parsed CSVs at/above 50k rows show
  warnings. Preview defaults to `PREVIEW_ROWS` (8) rows but the **"Show" select** on the
  Preview card (`#select-preview-rows` → `previewRowsLimit`, persisted as `previewRows`)
  lets the user raise it to 25/50/100/250; full copy always processes all parsed rows
  regardless of the preview cap.
- **Sort / Then by**: two stable sort keys (`#select-sort-by` + `#select-sort-by-2`, each
  with its own asc/desc). `getOrdering` builds the `Transforms.sortRows` key list: group
  key first (always ascending), then the sort key, then the secondary key (ignored if it
  duplicates an earlier key; when group and sort point at the same column the chosen sort
  direction wins).
- **Group by / Combine matching rows**: "Group by" (`#select-group-by`) clusters rows by a
  target column for sorting. The **"Combine matching rows"** toggle (`#chk-consolidate`,
  disabled until a group column is chosen) goes further and actually merges rows:
  `buildMatrix` runs `Transforms.consolidateRows(dataRows, groupIndex, {agg})` before
  sorting, collapsing rows that match on every *non-numeric* column (the group column and
  any other text column) into one row per unique combination, aggregating the numeric
  columns (`Transforms.asNumber`-parseable in every non-blank cell) by the **aggregation
  picker** (`#select-consolidate-agg`: Sum / Average / Count / Min / Max, enabled only
  while combining) instead of dropping duplicates. A column with even one non-numeric
  value is treated as a key column, not aggregated, so it must match exactly to merge —
  e.g. grouping by Date only combines rows that also share App/Ad source/etc; a different
  app on the same date stays a separate row. Persisted as `consolidate` + `consolidateAgg`.
- **Filters (multiple, ANDed)**: the `filters` array (`[{target, index, op, value}]`)
  renders as one row each in `#filter-list` (`renderFilterControls`/`buildFilterRow`);
  "+ Add filter" (`#btn-add-filter`) appends, the per-row × removes (hidden while only one
  row exists — the empty state is a single "No filter" row). Each filter remembers its
  column by target header **name** first (index as fallback) so it survives header
  reorders, mirroring the sort/group selects. Only complete filters count
  (`getFilters`: valid column + value unless the op is blank/not-blank); rows must pass
  **every** active filter (`Transforms.rowPassesFilter`).
- **Skip rows**: the "Skip first N rows" input (Upload module) drops metadata
  rows above the header before `splitRows` runs; persisted as `skipRows`.
- **Clean numbers**: the "Clean numbers" toggle (Copy module, default on) runs
  each mapped data cell through `Transforms.cleanNumeric` in `buildMatrix` (the
  header row is never cleaned); persisted as `cleanNumbers`. Handles US (`.` decimal,
  `,` thousands) and EU (`,` decimal, `.` thousands) conventions — the style is detected
  **per mapped column** (`detectColumnStyles` → `Transforms.detectNumberStyle` over a
  200-row sample; ambiguous columns default to US) and EU values are rewritten to the
  `.`-decimal form Sheets expects. Percents pass through untouched.
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
node --check popup.js transforms.js parse-worker.js   # syntax check
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
