// CSV to Sheets Paster - Popup Script
// Runs entirely in the popup (no content script, no Google access needed).

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');
  const fileDrop = document.getElementById('file-drop');
  const fileLabel = document.getElementById('file-label');
  const chkFirstRowHeader = document.getElementById('chk-first-row-header');
  const inputSkipRows = document.getElementById('input-skip-rows');
  const selectDelimiter = document.getElementById('select-delimiter');
  const csvInfo = document.getElementById('csv-info');
  const inputTargetHeaders = document.getElementById('input-target-headers');
  const btnPasteHeaders = document.getElementById('btn-paste-headers');
  const selectMappingPreset = document.getElementById('select-mapping-preset');
  const btnSavePreset = document.getElementById('btn-save-preset');
  const btnDeletePreset = document.getElementById('btn-delete-preset');
  const btnExportPresets = document.getElementById('btn-export-presets');
  const btnImportPresets = document.getElementById('btn-import-presets');
  const inputImportPresets = document.getElementById('input-import-presets');
  const selectSortBy = document.getElementById('select-sort-by');
  const selectSortDir = document.getElementById('select-sort-dir');
  const selectSortBy2 = document.getElementById('select-sort-by-2');
  const selectSortDir2 = document.getElementById('select-sort-dir-2');
  const selectGroupBy = document.getElementById('select-group-by');
  const chkConsolidate = document.getElementById('chk-consolidate');
  const selectConsolidateAgg = document.getElementById('select-consolidate-agg');
  const filterList = document.getElementById('filter-list');
  const btnAddFilter = document.getElementById('btn-add-filter');
  const selectPreviewRows = document.getElementById('select-preview-rows');
  const presetChips = document.getElementById('preset-chips');
  const mappingList = document.getElementById('mapping-list');
  const mappingHealth = document.getElementById('mapping-health');
  const btnClearFile = document.getElementById('btn-clear-file');
  const chkRememberFile = document.getElementById('chk-remember-file');
  // Collapsible heads (Upload / Headers), Step 2 text toggle + preset menu,
  // and the sticky copy bar.
  const moduleUpload = document.getElementById('module-upload');
  const moduleHeaders = document.getElementById('module-headers');
  const headUpload = document.getElementById('head-upload');
  const headHeaders = document.getElementById('head-headers');
  const uploadSummary = document.getElementById('upload-summary');
  const headersSummary = document.getElementById('headers-summary');
  const subsectionAdvanced = document.getElementById('subsection-advanced');
  const headAdvanced = document.getElementById('head-advanced');
  const advancedSummary = document.getElementById('advanced-summary');
  const headersTextEdit = document.getElementById('headers-text-edit');
  const btnToggleText = document.getElementById('btn-toggle-text');
  const btnPresetMenu = document.getElementById('btn-preset-menu');
  const presetMenu = document.getElementById('preset-menu');
  const stickyCta = document.getElementById('sticky-cta');
  const btnCopySticky = document.getElementById('btn-copy-sticky');
  const stickyCount = document.getElementById('sticky-count');
  let textEditOpen = false; // Step 2: is the textarea revealed behind "Edit as text"?

  // Quick-add header options. Each becomes its own toggle button; clicking one
  // adds the header to the target list (or removes it if already there).
  // This list is user-editable (+ Add / × remove) and persisted in storage;
  // DEFAULT_HEADER_OPTIONS is the seed used on first run.
  const DEFAULT_HEADER_OPTIONS = [
    'Date', 'Ad source', 'Format', 'Requests', 'Matched requests', 'Impressions', 'Estimated earnings'
  ];
  const DEFAULT_MAPPING_PRESETS = [
    {
      name: 'AdMob report',
      targetHeaders: 'Date, Ad source, Format, Requests, Matched requests, Impressions, Estimated earnings',
      columnMapping: {}
    },
    {
      name: 'Monthly earnings',
      targetHeaders: 'Month, App Name, Estimated earnings, Impressions',
      columnMapping: {}
    }
  ];
  const LARGE_FILE_BYTES = 5 * 1024 * 1024;
  const LARGE_ROW_COUNT = 50000;
  const PREVIEW_ROWS = 8;
  let previewRowsLimit = PREVIEW_ROWS; // current "Show" selection on the Preview card
  // Cap on remembering an uploaded file across popup sessions. The "unlimitedStorage"
  // permission lifts chrome.storage.local's default 5 MB quota, so this is just a
  // deliberate ceiling rather than a quota workaround; files above it aren't persisted
  // (the rest of the settings still are).
  const PERSIST_FILE_MAX_BYTES = 50 * 1024 * 1024;
  let headerOptions = DEFAULT_HEADER_OPTIONS.slice();
  let mappingPresets = DEFAULT_MAPPING_PRESETS.map(p => ({
    name: p.name,
    targetHeaders: p.targetHeaders,
    columnMapping: Object.assign({}, p.columnMapping),
    requiredHeaders: []
  }));
  let activePresetName = '';
  let requiredHeaders = [];
  const chkIncludeHeader = document.getElementById('chk-include-header');
  const chkCleanNumbers = document.getElementById('chk-clean-numbers');
  const chkNormalizeDates = document.getElementById('chk-normalize-dates');
  const btnCopy = document.getElementById('btn-copy');
  const btnDownloadTsv = document.getElementById('btn-download-tsv');
  const btnDownloadCsv = document.getElementById('btn-download-csv');
  const copyFallback = document.getElementById('copy-fallback');
  const fallbackTsv = document.getElementById('fallback-tsv');
  const btnSelectFallback = document.getElementById('btn-select-fallback');
  const btnDismissFallback = document.getElementById('btn-dismiss-fallback');
  const mappingWarning = document.getElementById('mapping-warning');
  const statusEl = document.getElementById('status');
  const previewCard = document.getElementById('preview-card');
  const previewTable = document.getElementById('preview-table');
  const previewNote = document.getElementById('preview-note');

  // State
  let csvHeaders = [];   // string[]
  let csvRows = [];      // string[][]
  let rawRows = [];      // parsed CSV before header handling
  let detectedDelim = ','; // delimiter used for the current file
  let loadedText = '';   // raw text of the loaded file (for opt-in persistence)
  let loadedName = '';   // name of the loaded file

  // Active row filters (ANDed). Each entry keeps the chosen output column both
  // as an index ('none' or a stringified number, matching the select values)
  // and by target header name, so the filter survives header reordering the
  // same way the sort/group selects do.
  const FILTER_OPS = ['contains', 'equals', 'not-equals', 'blank', 'not-blank', 'gt', 'lt', 'gte', 'lte'];
  const FILTER_OP_LABELS = {
    contains: 'Contains', equals: 'Equals', 'not-equals': 'Not equals',
    blank: 'Blank', 'not-blank': 'Not blank',
    gt: '> Greater than', lt: '< Less than', gte: '≥ Greater or equal', lte: '≤ Less or equal'
  };
  const AGG_OPS = ['sum', 'avg', 'count', 'min', 'max'];
  let filters = [];      // [{ target, index, op, value }]

  // ----------------- Drag-reorder placeholder -----------------
  // During a header-bubble drag, a grey dashed ghost sits at the insertion
  // point so the user can see where the bubble will land on drop.
  let _dragPlaceholder = null;   // the single placeholder DOM element
  let _dragSourceIndex = -1;     // index of the bubble currently being dragged
  let _dragInsertIndex = -1;     // where the bubble would land if dropped now

  function getDragPlaceholder(text) {
    if (!_dragPlaceholder) {
      _dragPlaceholder = document.createElement('div');
      _dragPlaceholder.className = 'drag-placeholder';
    }
    _dragPlaceholder.textContent = text;
    return _dragPlaceholder;
  }

  function removeDragPlaceholder() {
    if (_dragPlaceholder && _dragPlaceholder.parentNode) {
      _dragPlaceholder.parentNode.removeChild(_dragPlaceholder);
    }
    _dragSourceIndex = -1;
    _dragInsertIndex = -1;
  }

  // Compute the real insertion index by looking at where the placeholder sits
  // among the .header-bubble children of the container.
  function computeInsertIndex() {
    if (!_dragPlaceholder || !_dragPlaceholder.parentNode) return _dragSourceIndex;
    const container = _dragPlaceholder.parentNode;
    // Collect all header-bubbles and the placeholder in DOM order
    const children = Array.from(container.children);
    // Count how many non-dragging header-bubbles appear before the placeholder
    let idx = 0;
    for (const child of children) {
      if (child === _dragPlaceholder) break;
      if (child.classList.contains('header-bubble') && !child.classList.contains('dragging')) {
        idx++;
      }
    }
    return idx;
  }

  // Perform the drop using the tracked insertion index.
  function executeDrop() {
    if (_dragSourceIndex < 0 || _dragInsertIndex < 0) return;
    const from = _dragSourceIndex;
    const to = _dragInsertIndex;
    removeDragPlaceholder();
    if (from !== to) reorderTargets(from, to);
  }

  // Container-level dragover/drop (one-time setup) so drops landing in gaps
  // between bubbles (or on the pointer-events:none placeholder) still work.
  presetChips.addEventListener('dragover', e => {
    if (_dragSourceIndex < 0) return;  // not a header-bubble drag
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  presetChips.addEventListener('drop', e => {
    if (_dragSourceIndex < 0) return;  // not a header-bubble drag
    e.preventDefault();
    _dragInsertIndex = computeInsertIndex();
    executeDrop();
  });

  // ----------------- CSV parsing -----------------
  // CSV parsing, delimiter detection, and header-name matching are pure,
  // DOM-free transforms — they live in transforms.js and are unit-tested there.

  function delimiterName(d) {
    return d === '\t' ? 'tab' : d === ';' ? 'semicolon' : d === '|' ? 'pipe' : 'comma';
  }

  function isSupportedDelimiter(delim) {
    return delim === ',' || delim === '\t' || delim === ';' || delim === '|';
  }

  // ----------------- Async parsing (worker) -----------------
  // Large files parse in a Web Worker (parse-worker.js) so the popup never
  // freezes; small files skip the worker round-trip and parse inline. Any
  // worker failure (including file:// static previews, where Workers are
  // blocked) falls back to the same inline parse.
  const PARSE_WORKER_MIN_CHARS = 512 * 1024;
  let _parseWorker = null;   // Worker | false (unavailable) | null (not tried)
  let _parseSeq = 0;
  const _parsePending = new Map(); // id -> {resolve, reject}

  function getParseWorker() {
    if (_parseWorker !== null) return _parseWorker;
    try {
      _parseWorker = new Worker('parse-worker.js');
      _parseWorker.onmessage = e => {
        const { id, ok, rows, delim, error } = e.data || {};
        const cb = _parsePending.get(id);
        if (!cb) return;
        _parsePending.delete(id);
        if (ok) cb.resolve({ rows, delim });
        else cb.reject(new Error(error || 'worker parse failed'));
      };
      _parseWorker.onerror = () => {
        // The worker itself broke: fail pending requests (each falls back to an
        // inline parse) and don't try the worker again this session.
        _parsePending.forEach(cb => cb.reject(new Error('parse worker error')));
        _parsePending.clear();
        try { _parseWorker.terminate(); } catch (e) { /* already dead */ }
        _parseWorker = false;
      };
    } catch (e) {
      _parseWorker = false;
    }
    return _parseWorker;
  }

  // Parse text into rows, detecting the delimiter unless one is forced.
  // Resolves { rows, delim }; never rejects (worker errors fall back inline).
  function parseAsync(text, explicitDelim) {
    const inline = () => {
      const delim = explicitDelim || Transforms.detectDelimiter(text);
      return { rows: Transforms.parseCSV(text, delim), delim };
    };
    if (text.length < PARSE_WORKER_MIN_CHARS) return Promise.resolve().then(inline);
    const worker = getParseWorker();
    if (!worker) return Promise.resolve().then(inline);
    const id = ++_parseSeq;
    return new Promise((resolve, reject) => {
      _parsePending.set(id, { resolve, reject });
      worker.postMessage({ id, text, delim: explicitDelim || null });
    }).catch(inline);
  }

  // Map the delimiter <select> mode to a forced delimiter (null = auto-detect).
  function explicitDelimiter() {
    const mode = selectDelimiter.value;
    if (mode === 'tab') return '\t';
    if (mode === ',' || mode === ';' || mode === '|') return mode;
    return null;
  }

  // Parse `text` and swing the whole UI over to it. All three entry points
  // (fresh upload, delimiter re-parse, remembered-file restore) funnel through
  // here. A newer call supersedes an older in-flight one (the token check), so
  // rapid delimiter switches can't apply out of order.
  let _loadSeq = 0;
  function loadFromText(text, name, opts) {
    opts = opts || {};
    const token = ++_loadSeq;
    const textBytes = (typeof Blob !== 'undefined') ? new Blob([text]).size : text.length;
    if (textBytes >= LARGE_FILE_BYTES) setStatus('', 'Parsing…');
    const delim = 'explicitDelim' in opts ? opts.explicitDelim : explicitDelimiter();
    return parseAsync(text, delim).then(({ rows, delim: used }) => {
      if (token !== _loadSeq) return; // superseded by a newer load
      detectedDelim = used;
      rawRows = rows;
      loadedText = text;
      loadedName = name;
      applyHeaderMode();
      renderMapping();
      renderPreview();
      if (opts.collapseUpload !== false) setCollapsed(moduleUpload, headUpload, true);
      if (textBytes >= LARGE_FILE_BYTES) {
        setStatus('', `Large file (${formatBytes(textBytes)}). Preview stays capped; copy may take a moment.`);
      } else {
        setStatus('', '');
      }
      if (opts.persist !== false) {
        if (chkRememberFile.checked && textBytes <= PERSIST_FILE_MAX_BYTES) {
          persistFile(text, name, used);
        } else if (chkRememberFile.checked) {
          clearPersistedFile();
          setStatus('', `File too large to remember (${formatBytes(textBytes)}). It loads normally but won’t persist across sessions.`);
        } else {
          clearPersistedFile(); // not remembering — drop any stale copy
        }
      }
    }).catch(e => {
      console.error(e);
      if (token === _loadSeq) setStatus('err', 'Could not parse that file.');
    });
  }

  function reparseLoadedFile() {
    if (!loadedText) return;
    loadFromText(loadedText, loadedName, { collapseUpload: false });
  }

  function formatBytes(bytes) {
    if (!(bytes > 0)) return '0 B';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
  }

  function setStatus(type, msg) {
    statusEl.className = 'status' + (type ? ' ' + type : '');
    statusEl.textContent = msg;
  }

  // ----------------- Collapsible modules -----------------
  // Upload & Headers fold to a one-line summary so the popup stays short. Upload
  // auto-collapses once a file is loaded; both can be toggled by their head.
  function setCollapsed(section, head, collapsed) {
    section.classList.toggle('collapsed', collapsed);
    head.setAttribute('aria-expanded', String(!collapsed));
    updateSummaries();
  }
  function toggleCollapsed(section, head) {
    setCollapsed(section, head, !section.classList.contains('collapsed'));
  }
  [[headUpload, moduleUpload], [headHeaders, moduleHeaders], [headAdvanced, subsectionAdvanced]].forEach(([head, section]) => {
    head.addEventListener('click', () => toggleCollapsed(section, head));
    head.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapsed(section, head); }
    });
  });

  // Fill each collapsed head's summary line (cleared while expanded, where it just
  // acts as a flex spacer pinning the chevron right).
  function updateSummaries() {
    if (moduleUpload.classList.contains('collapsed')) {
      if (loadedText && csvHeaders.length) {
        uploadSummary.textContent = `${loadedName || 'File'} · ${csvRows.length} rows, ${csvHeaders.length} cols`;
      } else if (loadedText) {
        uploadSummary.textContent = loadedName || 'File loaded';
      } else {
        uploadSummary.textContent = 'No file yet';
      }
    } else {
      uploadSummary.textContent = '';
    }
    if (moduleHeaders.classList.contains('collapsed')) {
      const t = getTargets();
      if (t.length) {
        const shown = t.slice(0, 3).join(', ');
        headersSummary.textContent =
          `${t.length} header${t.length === 1 ? '' : 's'} · ${shown}${t.length > 3 ? ` +${t.length - 3}` : ''}`;
      } else {
        headersSummary.textContent = 'None yet';
      }
    } else {
      headersSummary.textContent = '';
    }
    if (subsectionAdvanced.classList.contains('collapsed')) {
      const parts = [];
      if (selectGroupBy.value !== 'none') parts.push(chkConsolidate.checked ? 'Grouped + combined' : 'Grouped');
      if (selectSortBy.value !== 'none' || selectSortBy2.value !== 'none') parts.push('Sorted');
      const nf = getFilters(getTargets()).length;
      if (nf) parts.push(nf === 1 ? 'Filtered' : `Filtered ×${nf}`);
      advancedSummary.textContent = parts.length ? parts.join(' · ') : 'No changes';
    } else {
      advancedSummary.textContent = '';
    }
  }

  // True when any sort/group/combine/filter setting is in effect; used to pop
  // the Advanced options fold open when restored or preset-applied settings
  // would otherwise be invisibly active.
  function advancedActive() {
    return selectSortBy.value !== 'none' || selectSortBy2.value !== 'none' ||
      selectGroupBy.value !== 'none' ||
      (chkConsolidate.checked && !chkConsolidate.disabled) ||
      getFilters(getTargets()).length > 0;
  }
  function maybeExpandAdvanced() {
    if (advancedActive()) setCollapsed(subsectionAdvanced, headAdvanced, false);
  }

  // ----------------- Step 2: pills vs. text -----------------
  // Pills are the primary header editor once headers exist; the textarea (the
  // source of truth) tucks behind "Edit as text". With no headers yet the textarea
  // stands alone as the entry point.
  function updateHeadersView() {
    const has = getTargets().length > 0;
    if (!has) {
      headersTextEdit.classList.remove('hidden');
      btnToggleText.classList.add('hidden');
    } else {
      btnToggleText.classList.remove('hidden');
      headersTextEdit.classList.toggle('hidden', !textEditOpen);
      btnToggleText.textContent = textEditOpen ? 'Hide text' : 'Edit as text';
      btnToggleText.setAttribute('aria-expanded', String(textEditOpen));
    }
  }
  btnToggleText.addEventListener('click', () => {
    textEditOpen = !textEditOpen;
    updateHeadersView();
    if (textEditOpen) inputTargetHeaders.focus();
  });
  // Focusing the textarea (e.g. typing the first header in the entry state) keeps
  // it open — otherwise the first keystroke flips "has headers" true and a later
  // render would hide the field mid-type.
  inputTargetHeaders.addEventListener('focus', () => {
    if (!textEditOpen) { textEditOpen = true; updateHeadersView(); }
  });

  // ----------------- Preset overflow menu -----------------
  function closePresetMenu() {
    presetMenu.classList.add('hidden');
    btnPresetMenu.setAttribute('aria-expanded', 'false');
  }
  btnPresetMenu.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = presetMenu.classList.contains('hidden');
    presetMenu.classList.toggle('hidden', !willOpen);
    btnPresetMenu.setAttribute('aria-expanded', String(willOpen));
  });
  // A click on an Export/Import item runs its handler, then bubbles here to close.
  document.addEventListener('click', closePresetMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePresetMenu(); });

  // ----------------- Sticky copy bar -----------------
  // Mirror the Step 4 button; visible only when the mapping can produce output.
  function updateStickyCta() {
    const valid = csvRows.length > 0 && getTargets().length > 0;
    stickyCta.classList.toggle('hidden', !valid);
    if (valid) {
      const n = buildMatrix._lastDataCount == null ? csvRows.length : buildMatrix._lastDataCount;
      stickyCount.textContent = n ? `${n} row${n === 1 ? '' : 's'}` : '';
    } else {
      stickyCount.textContent = '';
    }
  }

  // ----------------- File handling -----------------

  function handleFile(file) {
    if (!file) return;
    fileLabel.textContent = file.name;
    fileDrop.classList.add('has-file');
    btnClearFile.classList.remove('hidden');

    // Read raw bytes (not readAsText, which assumes UTF-8) so decodeBytes can
    // sniff BOMs / BOM-less UTF-16 — Google product exports are sometimes
    // UTF-16, which would otherwise decode to NUL-riddled garbage.
    const reader = new FileReader();
    reader.onload = () => {
      let text;
      try {
        text = Transforms.decodeBytes(reader.result);
      } catch (e) {
        console.error(e);
        setStatus('err', 'Could not decode that file.');
        return;
      }
      loadFromText(text, file.name);
    };
    reader.onerror = () => setStatus('err', 'Failed to read the file.');
    reader.readAsArrayBuffer(file);
  }

  fileInput.addEventListener('change', () => {
    handleFile(fileInput.files && fileInput.files[0]);
  });

  // Drag-and-drop onto the dropzone
  ['dragenter', 'dragover'].forEach(ev =>
    fileDrop.addEventListener(ev, e => { e.preventDefault(); fileDrop.classList.add('dragover'); }));
  ['dragleave', 'dragend'].forEach(ev =>
    fileDrop.addEventListener(ev, e => { e.preventDefault(); fileDrop.classList.remove('dragover'); }));
  fileDrop.addEventListener('drop', e => {
    e.preventDefault();
    fileDrop.classList.remove('dragover');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });

  // Remove the loaded file: reset parsed state, purge any persisted copy, and
  // return the Upload UI to its empty state.
  function clearFile() {
    rawRows = [];
    csvHeaders = [];
    csvRows = [];
    detectedDelim = ',';
    loadedText = '';
    loadedName = '';
    if (fileInput) fileInput.value = ''; // allow re-picking the same file
    fileLabel.textContent = 'Drop a file or click to browse';
    fileDrop.classList.remove('has-file');
    btnClearFile.classList.add('hidden');
    csvInfo.textContent = '';
    csvInfo.classList.add('hidden');
    setCollapsed(moduleUpload, headUpload, false); // re-open Upload to pick another file
    clearPersistedFile();
    renderMapping();
    renderPreview();
    updateCopyEnabled();
    setStatus('ok', 'File removed.');
  }
  btnClearFile.addEventListener('click', clearFile);

  // Persist the currently-loaded file when "remember last file" is on and it
  // fits the storage cap; otherwise make sure no stale copy is kept.
  function maybePersistCurrentFile() {
    if (!loadedText) return;
    const bytes = (typeof Blob !== 'undefined') ? new Blob([loadedText]).size : loadedText.length;
    if (chkRememberFile.checked && bytes <= PERSIST_FILE_MAX_BYTES) {
      persistFile(loadedText, loadedName || 'Restored file', detectedDelim);
    } else {
      clearPersistedFile();
    }
  }

  chkRememberFile.addEventListener('change', () => {
    if (chkRememberFile.checked) {
      maybePersistCurrentFile(); // opted in: remember the current file now
    } else {
      clearPersistedFile();      // opted out: purge any remembered copy
    }
    persist();
  });

  function getSkip() {
    return Math.max(0, Math.floor(Number(inputSkipRows.value)) || 0);
  }

  // Build csvHeaders / csvRows from rawRows, dropping the first N skipped rows
  // and honoring the "first row is header" toggle.
  function applyHeaderMode() {
    const split = Transforms.splitRows(rawRows, {
      skip: getSkip(),
      firstRowHeader: chkFirstRowHeader.checked
    });
    csvHeaders = split.headers;
    csvRows = split.rows;
    updateSummaries();

    if (rawRows.length === 0) {
      csvInfo.classList.add('hidden');
      return;
    }
    if (csvHeaders.length === 0) {
      csvInfo.textContent = `All ${rawRows.length} rows skipped — lower the "skip first N rows" value.`;
      csvInfo.classList.remove('hidden');
      return;
    }
    let info = `${csvRows.length} rows, ${csvHeaders.length} columns (${delimiterName(detectedDelim)}-delimited).`;
    if (csvRows.length >= LARGE_ROW_COUNT) {
      info += ` Large file - preview is capped at ${PREVIEW_ROWS} rows and copy may take a moment.`;
    }
    csvInfo.textContent = info;
    csvInfo.classList.remove('hidden');
  }

  chkFirstRowHeader.addEventListener('change', () => {
    applyHeaderMode();
    renderMapping();
    renderPreview();
    persist();
  });

  inputSkipRows.addEventListener('input', () => {
    applyHeaderMode();
    renderMapping();
    renderPreview();
    persist();
  });

  selectDelimiter.addEventListener('change', () => {
    reparseLoadedFile();
    persist();
  });

  // ----------------- Mapping UI -----------------

  function getTargets() {
    return Transforms.splitTargets(inputTargetHeaders.value);
  }

  function setTargets(targets) {
    inputTargetHeaders.value = (targets || []).join(', ');
    requiredHeaders = cleanRequiredHeaders(targets);
  }

  function cleanRequiredHeaders(targets) {
    const current = (targets || getTargets()).map(t => t.toLowerCase());
    const seen = new Set();
    return requiredHeaders.filter(h => {
      const key = String(h || '').toLowerCase();
      if (!current.includes(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isRequiredHeader(header) {
    return requiredHeaders.some(h => h.toLowerCase() === String(header || '').toLowerCase());
  }

  function toggleRequiredHeader(header) {
    const key = String(header || '').toLowerCase();
    if (!key) return;
    if (isRequiredHeader(header)) {
      requiredHeaders = requiredHeaders.filter(h => h.toLowerCase() !== key);
    } else {
      requiredHeaders.push(header);
    }
    requiredHeaders = cleanRequiredHeaders();
    markManualSetup();
    renderTargetOrder();
    renderMappingHealth();
    renderMappingWarning();
    persist();
  }

  function reorderTargets(from, to) {
    const targets = getTargets();
    if (from === to || from < 0 || to < 0 || from >= targets.length || to >= targets.length) return;
    const moved = targets.splice(from, 1)[0];
    targets.splice(to, 0, moved);
    setTargets(targets);
    markManualSetup();
    renderTargetOrder();
    renderMapping();
    renderPreview();
    persist();
    updateChipActive();
  }

  // The chip row is the single header editor; renderPresets() draws it. These
  // older entry points (called from renderMapping and various edits) just refresh
  // that one row.
  function renderTargetOrder() { renderPresets(); }

  // Remove the target at a given position (handles duplicate names correctly,
  // unlike a name filter). Re-syncs the textarea, mapping, preview, and chips.
  function removeTargetAt(index) {
    const targets = getTargets();
    if (index < 0 || index >= targets.length) return;
    targets.splice(index, 1);
    setTargets(targets);
    markManualSetup();
    renderMapping();
    renderPreview();
    persist();
    updateChipActive();
  }

  function presetNameKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  function findPreset(name) {
    const key = presetNameKey(name);
    return mappingPresets.find(p => presetNameKey(p.name) === key);
  }

  // The sort/group/combine/filter pipeline as a name-keyed snapshot (column
  // indices aren't stable across files, so everything is stored by target
  // header name and re-resolved on apply).
  function getPipelineState() {
    return {
      sortByTarget: selectedTargetName(selectSortBy),
      sortDir: selectSortDir.value,
      sortBy2Target: selectedTargetName(selectSortBy2),
      sortDir2: selectSortDir2.value,
      groupByTarget: selectedTargetName(selectGroupBy),
      consolidate: chkConsolidate.checked,
      consolidateAgg: selectConsolidateAgg.value,
      filters: filters
        .filter(f => f.target || String(f.value).trim())
        .map(f => ({ target: f.target, op: f.op, value: f.value }))
    };
  }

  // Apply a saved pipeline snapshot. Must run after renderMapping() has
  // rebuilt the sort/group option lists for the preset's targets.
  function applyPipelineState(p) {
    trySelectTarget(selectSortBy, p.sortByTarget, 'none');
    selectSortDir.value = p.sortDir === 'desc' ? 'desc' : 'asc';
    trySelectTarget(selectSortBy2, p.sortBy2Target, 'none');
    selectSortDir2.value = p.sortDir2 === 'desc' ? 'desc' : 'asc';
    trySelectTarget(selectGroupBy, p.groupByTarget, 'none');
    chkConsolidate.checked = !!p.consolidate && selectGroupBy.value !== 'none';
    if (AGG_OPS.includes(p.consolidateAgg)) selectConsolidateAgg.value = p.consolidateAgg;
    updateConsolidateEnabled();
    filters = Array.isArray(p.filters) ? p.filters.map(f => ({
      target: typeof f.target === 'string' ? f.target : '',
      index: 'none', // re-resolved from the target name by renderFilterControls
      op: FILTER_OPS.includes(f.op) ? f.op : 'contains',
      value: typeof f.value === 'string' ? f.value : ''
    })) : [];
    renderFilterControls();
    maybeExpandAdvanced();
  }

  function snapshotPreset(name) {
    return {
      name: String(name || '').trim(),
      targetHeaders: inputTargetHeaders.value.trim(),
      columnMapping: Object.assign({}, getMapping()),
      requiredHeaders: cleanRequiredHeaders(),
      pipeline: getPipelineState()
    };
  }

  function renderMappingPresets() {
    selectMappingPreset.innerHTML = '';

    const current = document.createElement('option');
    current.value = '';
    current.textContent = 'Current setup';
    selectMappingPreset.appendChild(current);

    mappingPresets.forEach(preset => {
      const opt = document.createElement('option');
      opt.value = preset.name;
      opt.textContent = preset.name;
      selectMappingPreset.appendChild(opt);
    });

    selectMappingPreset.value = findPreset(activePresetName) ? activePresetName : '';
    btnDeletePreset.disabled = selectMappingPreset.value === '';
  }

  // Wrap chrome.storage.local.set so a storage failure never breaks the UI (and
  // so the popup still runs in a plain browser where chrome.* is unavailable).
  function storageSet(obj, label) {
    try {
      chrome.storage.local.set(obj).catch(err => {
        console.warn((label || 'persist') + ' async failed:', err);
      });
    } catch (e) {
      console.warn((label || 'persist') + ' failed:', e);
    }
  }

  function persistMappingPresets() {
    storageSet({ mappingPresets, activeMappingPreset: activePresetName }, 'persist mappingPresets');
  }

  function applyMappingPreset(name) {
    const preset = findPreset(name);
    if (!preset) {
      activePresetName = '';
      renderMappingPresets();
      return;
    }

    activePresetName = preset.name;
    inputTargetHeaders.value = preset.targetHeaders || '';
    requiredHeaders = Array.isArray(preset.requiredHeaders) ? preset.requiredHeaders.slice() : [];
    renderMapping._saved = Object.assign({}, preset.columnMapping || {});
    renderTargetOrder();
    renderMapping();
    // Older presets (saved before pipelines) leave the current sort/group/filter
    // settings alone; newer ones restore the full recipe.
    if (preset.pipeline) applyPipelineState(preset.pipeline);
    renderPreview();
    persist();
    updateChipActive();
    renderMappingPresets();
    setStatus('ok', `Loaded "${preset.name}".`);
  }

  function saveMappingPreset() {
    if (getTargets().length === 0) {
      setStatus('err', 'Add at least one target header before saving a preset.');
      return;
    }
    startPresetNameInput();
  }

  // Inline preset naming: swap the preset <select> for a text input (mirrors the
  // "+ Add" header flow in startAddHeader). Commit on Enter/blur, cancel on Esc.
  function startPresetNameInput() {
    if (document.getElementById('preset-name-input')) return; // already naming
    const fallback = activePresetName || selectMappingPreset.value || 'New preset';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'preset-name-input';
    input.className = 'preset-select preset-name-input';
    input.value = fallback;
    input.setAttribute('aria-label', 'Preset name');
    selectMappingPreset.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      input.replaceWith(selectMappingPreset); // restore the original select node
      renderMappingPresets();
      if (!save) return;
      if (!name) { setStatus('err', 'Preset name cannot be blank.'); return; }
      commitMappingPreset(name);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function commitMappingPreset(name) {
    const next = snapshotPreset(name);
    const existing = mappingPresets.findIndex(p => presetNameKey(p.name) === presetNameKey(name));
    if (existing === -1) {
      mappingPresets.push(next);
    } else {
      mappingPresets[existing] = next;
    }

    activePresetName = name;
    requiredHeaders = next.requiredHeaders.slice();
    renderMapping._saved = Object.assign({}, next.columnMapping);
    persistMappingPresets();
    persist();
    renderMappingPresets();
    setStatus('ok', `Saved "${name}".`);
  }

  function deleteMappingPreset() {
    const name = selectMappingPreset.value;
    if (!name) return;
    startDeleteConfirm(name);
  }

  // Inline delete confirmation: swap the Delete button for a "Confirm?" button
  // (same swap pattern as startAddHeader). A click confirms; blur, Esc, or a
  // short timeout cancels and restores the Delete button.
  function startDeleteConfirm(name) {
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'mini-btn danger confirming';
    confirmBtn.textContent = 'Confirm?';
    confirmBtn.title = `Delete "${name}" permanently`;
    confirmBtn.setAttribute('aria-label', `Confirm deleting preset "${name}"`);
    btnDeletePreset.replaceWith(confirmBtn);
    confirmBtn.focus();

    let done = false;
    const finish = (doDelete) => {
      if (done) return;
      done = true;
      confirmBtn.replaceWith(btnDeletePreset); // restore the Delete button
      if (doDelete) commitDeletePreset(name);
      else renderMappingPresets();
    };
    confirmBtn.addEventListener('click', () => finish(true));
    confirmBtn.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    confirmBtn.addEventListener('blur', () => finish(false));
    setTimeout(() => finish(false), 4000);
  }

  function commitDeletePreset(name) {
    mappingPresets = mappingPresets.filter(p => presetNameKey(p.name) !== presetNameKey(name));
    activePresetName = '';
    persistMappingPresets();
    persist();
    renderMappingPresets();
    setStatus('ok', `Deleted "${name}".`);
  }

  function normalizePreset(preset) {
    if (!preset || typeof preset.name !== 'string' || !preset.name.trim()) return null;
    const out = {
      name: preset.name.trim(),
      targetHeaders: typeof preset.targetHeaders === 'string' ? preset.targetHeaders : '',
      columnMapping: preset.columnMapping && typeof preset.columnMapping === 'object' ? preset.columnMapping : {},
      requiredHeaders: Array.isArray(preset.requiredHeaders) ? preset.requiredHeaders.filter(h => typeof h === 'string') : []
    };
    // Optional pipeline (sort/group/combine/filter recipe); applyPipelineState
    // defends field-by-field, so passing it through mostly as-is is safe.
    if (preset.pipeline && typeof preset.pipeline === 'object') out.pipeline = preset.pipeline;
    return out;
  }

  function exportMappingPresets() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      mappingPresets
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'csv-to-sheets-presets.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('ok', `Exported ${mappingPresets.length} preset${mappingPresets.length === 1 ? '' : 's'}.`);
  }

  function importMappingPresets(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const list = Array.isArray(parsed) ? parsed : parsed.mappingPresets;
        if (!Array.isArray(list)) throw new Error('missing mappingPresets');
        const incoming = list.map(normalizePreset).filter(Boolean);
        if (incoming.length === 0) throw new Error('no valid presets');

        incoming.forEach(next => {
          const idx = mappingPresets.findIndex(p => presetNameKey(p.name) === presetNameKey(next.name));
          if (idx === -1) mappingPresets.push(next);
          else mappingPresets[idx] = next;
        });
        persistMappingPresets();
        renderMappingPresets();
        setStatus('ok', `Imported ${incoming.length} preset${incoming.length === 1 ? '' : 's'}.`);
      } catch (e) {
        console.error(e);
        setStatus('err', 'Could not import presets. Use a JSON export from this extension.');
      } finally {
        inputImportPresets.value = '';
      }
    };
    reader.onerror = () => setStatus('err', 'Could not read that preset file.');
    reader.readAsText(file);
  }

  function markManualSetup() {
    if (!activePresetName && selectMappingPreset.value === '') return;
    activePresetName = '';
    renderMappingPresets();
  }

  // Auto-match a target to a CSV column index ('__ignore__' if none). The stored
  // mapping value is the column *index* (as a string), not the header text, so
  // duplicate header names stay distinct.
  function autoMatchValue(target) {
    const idx = Transforms.autoMatchIndex(target, csvHeaders);
    return idx === -1 ? '__ignore__' : String(idx);
  }

  function sameHeaderName(a, b) {
    return Transforms.normalizeString(a) === Transforms.normalizeString(b);
  }

  function savedMappingValue(entry) {
    if (entry && typeof entry === 'object') {
      return entry.value != null ? entry.value : entry.index;
    }
    return entry;
  }

  function savedMappingHeader(entry) {
    if (!entry || typeof entry !== 'object') return '';
    return entry.sourceHeader || entry.header || entry.sourceColumn || '';
  }

  function mappingEntryFor(value) {
    const idx = resolveColumnIndex(value);
    return {
      value,
      sourceHeader: idx === -1 ? '' : csvHeaders[idx]
    };
  }

  // Resolve a saved mapping value against the current CSV. Header-aware mappings
  // are reused only if the saved source header still exists; if it moved, follow
  // the header to its new index. Legacy index-only values are used conservatively
  // only when the current header still resembles the target.
  function resolveSavedValue(entry, target) {
    const val = savedMappingValue(entry);
    if (val == null) return null;
    if (val === '__ignore__') return '__ignore__';
    const s = String(val);
    const savedHeader = savedMappingHeader(entry);

    // Header-aware: follow the remembered source header to wherever it is now,
    // even if the file shrank and the old index is out of range. The old index is
    // only a fast path when it still points at the same-named column.
    if (savedHeader) {
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        if (n >= 0 && n < csvHeaders.length && sameHeaderName(savedHeader, csvHeaders[n])) return s;
      }
      const moved = csvHeaders.findIndex(h => sameHeaderName(savedHeader, h));
      return moved === -1 ? null : String(moved);
    }

    // Legacy bare index: trust it only if the current column still resembles the
    // target name (otherwise it's a stale reference from a different layout).
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (n < 0 || n >= csvHeaders.length) return null;
      return Transforms.headerMatchConfidence(target, csvHeaders[n]) === 'none' ? null : s;
    }
    const li = csvHeaders.indexOf(s); // legacy header-text value
    return li === -1 ? null : String(li);
  }

  // Map a mapping value to a confidence tag for the badge.
  function valueConfidence(target, val) {
    const idx = resolveColumnIndex(val);
    return idx === -1 ? 'blank' : Transforms.headerMatchConfidence(target, csvHeaders[idx]);
  }

  const BADGE_TEXT = { exact: 'Exact', similar: 'Similar', none: 'Manual', blank: 'Blank' };

  function setBadge(badge, target, val) {
    const conf = valueConfidence(target, val);
    badge.className = 'map-badge ' + conf;
    badge.textContent = BADGE_TEXT[conf] || '';
  }

  function renderMapping() {
    const targets = getTargets();
    renderTargetOrder();
    renderOrderControls(targets);
    renderFilterControls(targets);
    mappingList.innerHTML = '';

    if (csvHeaders.length === 0) {
      mappingList.innerHTML = '<div class="empty-msg">Upload a CSV to map columns.</div>';
      renderMappingHealth();
      updateCopyEnabled();
      return;
    }
    if (targets.length === 0) {
      mappingList.innerHTML = '<div class="empty-msg">Enter target headers above.</div>';
      renderMappingHealth();
      updateCopyEnabled();
      return;
    }

    const saved = renderMapping._saved || {};

    targets.forEach(target => {
      const rowEl = document.createElement('div');
      rowEl.className = 'mapping-row';

      const label = document.createElement('div');
      label.className = 'mapping-target';
      label.textContent = target;
      label.title = target;

      const select = document.createElement('select');
      select.dataset.target = target;
      select.setAttribute('aria-label', `Source column for "${target}"`);

      const optIgnore = document.createElement('option');
      optIgnore.value = '__ignore__';
      optIgnore.textContent = '— leave blank —';
      select.appendChild(optIgnore);

      csvHeaders.forEach((h, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = `${h} (col ${idx + 1})`;
        select.appendChild(opt);
      });

      // Prefer a saved choice that still applies, else auto-match.
      const resolved = resolveSavedValue(saved[target], target);
      select.value = resolved != null ? resolved : autoMatchValue(target);

      // Confidence badge so users can spot a wrong/blank mapping at a glance.
      const badge = document.createElement('span');
      setBadge(badge, target, select.value);

      // Keep the in-memory saved map in sync so a later re-render (e.g. editing
      // headers or toggling the header switch) doesn't revert this choice.
      select.addEventListener('change', () => {
        setBadge(badge, target, select.value);
        markManualSetup();
        renderMapping._saved = Object.assign({}, renderMapping._saved, getMapping());
        renderMappingHealth();
        renderPreview();
        persist();
      });

      rowEl.appendChild(label);
      rowEl.appendChild(select);
      rowEl.appendChild(badge);
      mappingList.appendChild(rowEl);
    });

    updateCopyEnabled();
    renderMappingHealth();
  }

  // Name-keyed snapshot of the selects, used only for persistence/seeding so a
  // header's chosen column is remembered across files. Duplicate target names
  // collapse here (last wins) — acceptable for seeding; the *output* build below
  // reads selections positionally so duplicates stay distinct.
  function getMapping() {
    const map = {};
    mappingList.querySelectorAll('select').forEach(s => { map[s.dataset.target] = mappingEntryFor(s.value); });
    return map;
  }

  // Selected column index per target, in DOM order (which matches getTargets()
  // order because renderMapping appends one select per target in sequence).
  // Reading positionally — not by name — lets two output columns that share a
  // header name map to two different source columns.
  function getColumnIndices() {
    return Array.from(mappingList.querySelectorAll('select')).map(s => s.value);
  }

  // Resolve a mapping select value to a valid CSV column index, or -1 when the
  // target is left blank / out of range. Centralizes the check shared by output
  // building, the blank-mapping warning, and the confidence badge.
  function resolveColumnIndex(value) {
    if (!value || value === '__ignore__') return -1;
    const idx = Number(value);
    return (idx >= 0 && idx < csvHeaders.length) ? idx : -1;
  }

  function getBlankTargets() {
    const targets = getTargets();
    const values = getColumnIndices();
    if (csvHeaders.length === 0 || targets.length === 0) return [];
    return targets.filter((target, i) => resolveColumnIndex(values[i]) === -1);
  }

  function getRequiredMissingTargets() {
    const targets = getTargets();
    const values = getColumnIndices();
    if (csvHeaders.length === 0 || targets.length === 0) return [];
    return targets.filter((target, i) => isRequiredHeader(target) && resolveColumnIndex(values[i]) === -1);
  }

  function renderMappingHealth() {
    const targets = getTargets();
    if (csvHeaders.length === 0 || targets.length === 0) {
      mappingHealth.classList.add('hidden');
      mappingHealth.innerHTML = '';
      return;
    }

    const values = getColumnIndices();
    let mapped = 0, exact = 0, similar = 0, manual = 0, blank = 0;
    values.forEach((value, i) => {
      const idx = resolveColumnIndex(value);
      if (idx === -1) { blank++; return; }
      mapped++;
      const conf = Transforms.headerMatchConfidence(targets[i], csvHeaders[idx]);
      if (conf === 'exact') exact++;
      else if (conf === 'similar') similar++;
      else manual++;
    });

    const lower = targets.map(t => t.toLowerCase());
    const duplicateCount = lower.filter((t, i) => lower.indexOf(t) !== i).length;
    const requiredMissing = getRequiredMissingTargets().length;
    const chips = [
      { text: `${mapped}/${targets.length} mapped`, cls: blank ? 'warn' : 'ok' },
      { text: `${blank} blank`, cls: blank ? 'warn' : 'ok' },
      { text: `${similar} similar`, cls: similar ? 'warn' : '' },
      { text: `${manual} manual`, cls: manual ? '' : 'ok' }
    ];
    if (exact) chips.push({ text: `${exact} exact`, cls: 'ok' });
    if (requiredHeaders.length) chips.push({ text: `${requiredMissing}/${requiredHeaders.length} required blank`, cls: requiredMissing ? 'err' : 'ok' });
    if (duplicateCount) chips.push({ text: `${duplicateCount} duplicate`, cls: 'warn' });

    mappingHealth.innerHTML = chips.map(c => `<span class="health-pill ${c.cls}">${escapeHtml(c.text)}</span>`).join('');
    mappingHealth.classList.remove('hidden');
  }

  function renderMappingWarning() {
    const requiredMissing = getRequiredMissingTargets();
    if (requiredMissing.length) {
      const shownReq = requiredMissing.slice(0, 4).join(', ');
      const reqExtra = requiredMissing.length > 4 ? `, +${requiredMissing.length - 4} more` : '';
      mappingWarning.textContent =
        `Required column${requiredMissing.length === 1 ? '' : 's'} will paste blank: ${shownReq}${reqExtra}.`;
      mappingWarning.classList.remove('hidden');
      return;
    }

    const blanks = getBlankTargets();
    if (blanks.length === 0) {
      mappingWarning.classList.add('hidden');
      mappingWarning.textContent = '';
      return;
    }

    const shown = blanks.slice(0, 4).join(', ');
    const extra = blanks.length > 4 ? `, +${blanks.length - 4} more` : '';
    mappingWarning.textContent =
      `${blanks.length} output column${blanks.length === 1 ? '' : 's'} will paste blank: ${shown}${extra}.`;
    mappingWarning.classList.remove('hidden');
  }

  // ----------------- Sort & group -----------------

  // Read the sort/group selects into a Transforms.sortRows key list, referencing
  // *output* column positions (the user sorts by a target header). Returns null
  // when nothing is set. Grouping is the primary key (clusters like rows, always
  // ascending for a readable order); the sort key orders rows within each group,
  // and the secondary "Then by" key breaks its ties. When group and sort point
  // at the same column, the chosen sort direction wins; a secondary key that
  // duplicates an earlier key is ignored.
  function getOrdering(targets) {
    const n = targets.length;
    const inRange = v => /^\d+$/.test(v) && Number(v) < n;
    const groupIdx = inRange(selectGroupBy.value) ? Number(selectGroupBy.value) : -1;
    const sortIdx = inRange(selectSortBy.value) ? Number(selectSortBy.value) : -1;
    const sortDir = selectSortDir.value === 'desc' ? 'desc' : 'asc';
    const sortIdx2 = inRange(selectSortBy2.value) ? Number(selectSortBy2.value) : -1;
    const sortDir2 = selectSortDir2.value === 'desc' ? 'desc' : 'asc';

    const keys = [];
    if (groupIdx !== -1 && groupIdx === sortIdx) {
      keys.push({ index: sortIdx, dir: sortDir });
    } else {
      if (groupIdx !== -1) keys.push({ index: groupIdx, dir: 'asc' });
      if (sortIdx !== -1) keys.push({ index: sortIdx, dir: sortDir });
    }
    if (sortIdx2 !== -1 && !keys.some(k => k.index === sortIdx2)) {
      keys.push({ index: sortIdx2, dir: sortDir2 });
    }
    return keys.length ? keys : null;
  }

  function selectedTargetName(sel) {
    const opt = sel.selectedOptions && sel.selectedOptions[0];
    return opt && opt.dataset ? (opt.dataset.targetName || '') : '';
  }

  function rememberSelectedTarget(sel) {
    sel.dataset.selectedTargetName = selectedTargetName(sel);
  }

  function optionValueForTargetName(sel, name) {
    const key = String(name || '').toLowerCase();
    if (!key) return null;
    const found = Array.from(sel.options).find(opt =>
      String(opt.dataset.targetName || '').toLowerCase() === key);
    return found ? found.value : null;
  }

  // Rebuild the Sort by / Group by option lists from the current target headers,
  // preserving the prior selection by target header name when possible. This keeps
  // grouping/sorting pointed at the same metric after the user reorders headers.
  // Duplicate header names are disambiguated by their output position.
  function fillOrderSelect(sel, targets, noneLabel) {
    const prev = sel.value;
    const prevTarget = selectedTargetName(sel) || sel.dataset.selectedTargetName || '';
    sel.innerHTML = '';
    const optNone = document.createElement('option');
    optNone.value = 'none';
    optNone.textContent = noneLabel;
    sel.appendChild(optNone);

    targets.forEach((t, i) => {
      const dup = targets.filter(x => x.toLowerCase() === t.toLowerCase()).length > 1;
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = dup ? `${t} (#${i + 1})` : t;
      opt.dataset.targetName = t;
      sel.appendChild(opt);
    });

    const byName = optionValueForTargetName(sel, prevTarget);
    if (byName != null) sel.value = byName;
    else sel.value = (prev === 'none' || (/^\d+$/.test(prev) && Number(prev) < targets.length)) ? prev : 'none';
    rememberSelectedTarget(sel);
  }

  function renderOrderControls(targets) {
    const t = targets || getTargets();
    fillOrderSelect(selectSortBy, t, '— original order —');
    fillOrderSelect(selectSortBy2, t, '— none —');
    fillOrderSelect(selectGroupBy, t, '— no grouping —');
    updateConsolidateEnabled();
  }

  // "Combine matching rows" only makes sense once a group column is chosen, and
  // its aggregation picker only once combining is actually on.
  function updateConsolidateEnabled() {
    chkConsolidate.disabled = selectGroupBy.value === 'none';
    selectConsolidateAgg.disabled = chkConsolidate.disabled || !chkConsolidate.checked;
  }

  // ----------------- Filters (multiple, ANDed) -----------------

  function blankFilter() {
    return { target: '', index: 'none', op: 'contains', value: '' };
  }

  // A value input is meaningless with no column picked or a blank/not-blank op.
  function filterNeedsValue(f) {
    return f.op !== 'blank' && f.op !== 'not-blank';
  }

  // Rebuild the filter rows from the `filters` array, re-resolving each entry's
  // column against the current targets (by header name first, like the sort and
  // group selects, so filters survive header reorders). Always shows at least
  // one row so the empty state still reads as "Filter: No filter".
  function renderFilterControls(targets) {
    const t = targets || getTargets();
    if (filters.length === 0) filters.push(blankFilter());
    filterList.innerHTML = '';
    filters.forEach((f, i) => filterList.appendChild(buildFilterRow(f, i, t)));
  }

  function buildFilterRow(f, i, targets) {
    const item = document.createElement('div');
    item.className = 'filter-item';
    const row = document.createElement('div');
    row.className = 'filter-row' + (filters.length === 1 ? ' no-remove' : '');

    const label = document.createElement('label');
    label.className = 'order-label';
    label.textContent = i === 0 ? 'Filter' : 'and';

    const colSel = document.createElement('select');
    colSel.className = 'order-select';
    colSel.setAttribute('aria-label', `Filter ${i + 1} column`);
    const optNone = document.createElement('option');
    optNone.value = 'none';
    optNone.textContent = 'No filter';
    colSel.appendChild(optNone);
    targets.forEach((tName, idx) => {
      const dup = targets.filter(x => x.toLowerCase() === tName.toLowerCase()).length > 1;
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = dup ? `${tName} (#${idx + 1})` : tName;
      opt.dataset.targetName = tName;
      colSel.appendChild(opt);
    });
    // Resolve the stored column: by target name first, then the raw index.
    const byName = optionValueForTargetName(colSel, f.target);
    if (byName != null) colSel.value = byName;
    else if (/^\d+$/.test(String(f.index)) && Number(f.index) < targets.length) colSel.value = String(f.index);
    else colSel.value = 'none';
    f.index = colSel.value;
    f.target = selectedTargetName(colSel);
    label.setAttribute('for', colSel.id = `select-filter-by-${i}`);

    const opSel = document.createElement('select');
    opSel.className = 'order-dir';
    opSel.setAttribute('aria-label', `Filter ${i + 1} operation`);
    FILTER_OPS.forEach(op => {
      const opt = document.createElement('option');
      opt.value = op;
      opt.textContent = FILTER_OP_LABELS[op];
      opSel.appendChild(opt);
    });
    opSel.value = FILTER_OPS.includes(f.op) ? f.op : 'contains';
    f.op = opSel.value;

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'filter-value';
    valueInput.placeholder = 'Filter value';
    valueInput.setAttribute('aria-label', `Filter ${i + 1} value`);
    valueInput.value = f.value;
    valueInput.disabled = colSel.value === 'none' || !filterNeedsValue(f);

    colSel.addEventListener('change', () => {
      f.index = colSel.value;
      f.target = selectedTargetName(colSel);
      valueInput.disabled = colSel.value === 'none' || !filterNeedsValue(f);
      renderPreview();
      persist();
    });
    opSel.addEventListener('change', () => {
      f.op = opSel.value;
      valueInput.disabled = colSel.value === 'none' || !filterNeedsValue(f);
      renderPreview();
      persist();
    });
    valueInput.addEventListener('input', () => {
      f.value = valueInput.value;
      renderPreview();
      persist();
    });

    row.appendChild(label);
    row.appendChild(colSel);
    row.appendChild(opSel);
    if (filters.length > 1) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'filter-remove';
      rm.textContent = '×';
      rm.title = 'Remove this filter';
      rm.setAttribute('aria-label', `Remove filter ${i + 1}`);
      rm.addEventListener('click', () => {
        filters.splice(i, 1);
        renderFilterControls();
        renderPreview();
        persist();
      });
      row.appendChild(rm);
    }
    item.appendChild(row);
    item.appendChild(valueInput);
    return item;
  }

  // Set a select to a saved value only if such an option currently exists.
  function trySelect(sel, val) {
    if (val == null) { rememberSelectedTarget(sel); return; }
    const v = String(val);
    if (Array.from(sel.options).some(o => o.value === v)) sel.value = v;
    rememberSelectedTarget(sel);
  }

  function trySelectTarget(sel, targetName, fallbackValue) {
    const byName = optionValueForTargetName(sel, targetName);
    if (byName != null) {
      sel.value = byName;
      rememberSelectedTarget(sel);
      return;
    }
    trySelect(sel, fallbackValue);
  }

  // True when a sort or group is currently active.
  function hasOrdering() {
    return getOrdering(getTargets()) != null;
  }

  // The filters that are actually in effect: a valid column plus either a
  // blank/not-blank op or a non-blank value. Row matching itself lives in
  // Transforms.rowPassesFilter (unit-tested).
  function getFilters(targets) {
    targets = targets || getTargets();
    const out = [];
    for (const f of filters) {
      const v = String(f.index);
      if (!/^\d+$/.test(v) || Number(v) >= targets.length) continue;
      if (filterNeedsValue(f) && String(f.value).trim() === '') continue;
      out.push({ index: Number(v), op: f.op, value: f.value });
    }
    return out;
  }

  function hasFilter() {
    return getFilters(getTargets()).length > 0;
  }

  // Output column index selected for grouping, or -1. Mirrors the group key in
  // getOrdering so subtotal rows cluster exactly as the data was sorted.
  function getGroupIndex(targets) {
    const v = selectGroupBy.value;
    return (/^\d+$/.test(v) && Number(v) < targets.length) ? Number(v) : -1;
  }

  // True when "Combine matching rows" is on and a group column is selected
  // (the checkbox is disabled without one, but guard here too).
  function hasConsolidate() {
    return chkConsolidate.checked && getGroupIndex(getTargets()) !== -1;
  }

  // ----------------- Output building -----------------

  // Per-column number style ('us'/'eu') for Clean numbers, detected from a
  // sample of each mapped source column. null when cleaning is off. Detection
  // is per column so a US-formatted ID column can't outvote an EU money column.
  const NUMBER_STYLE_SAMPLE_ROWS = 200;
  function detectColumnStyles(values) {
    if (!chkCleanNumbers.checked) return null;
    const sample = csvRows.slice(0, NUMBER_STYLE_SAMPLE_ROWS);
    return values.map(v => {
      const idx = resolveColumnIndex(v);
      if (idx === -1) return 'us';
      return Transforms.detectNumberStyle(sample.map(r => r[idx]));
    });
  }

  // Map one source row to its output cells (mapped, optionally cleaned, sanitized).
  function buildCells(row, targets, values, styles) {
    return targets.map((t, i) => {
      const idx = resolveColumnIndex(values[i]);
      if (idx === -1) return '';
      let val = row[idx] != null ? row[idx] : '';
      if (chkNormalizeDates.checked) val = Transforms.normalizeDate(val);
      if (chkCleanNumbers.checked) val = Transforms.cleanNumeric(val, styles ? styles[i] : 'us');
      // Sanitize so TSV structure survives a paste.
      return String(val).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
    });
  }

  // Build the output matrix. Pass rowLimit to cap the data rows kept (the live
  // preview only shows a handful); omit it to build every row for copy. When a
  // sort/group/filter/consolidate is active the result depends on the whole
  // file, so the fast preview path is skipped — all rows are built,
  // transformed, then sliced.
  function buildMatrix(rowLimit) {
    const targets = getTargets();
    const values = getColumnIndices(); // value per target, positionally aligned
    const styles = detectColumnStyles(values);
    const keys = getOrdering(targets);
    const activeFilters = getFilters(targets);
    const wantConsolidate = hasConsolidate();
    const groupIndex = getGroupIndex(targets);

    const limitedPreview = rowLimit != null && !keys && !activeFilters.length && !wantConsolidate;
    const source = limitedPreview ? csvRows.slice(0, rowLimit) : csvRows;
    let dataRows = source.map(row => buildCells(row, targets, values, styles));
    if (activeFilters.length) {
      dataRows = dataRows.filter(row => activeFilters.every(f => Transforms.rowPassesFilter(row, f)));
    }
    if (wantConsolidate) {
      dataRows = Transforms.consolidateRows(dataRows, groupIndex, { agg: selectConsolidateAgg.value });
    }
    if (keys) dataRows = Transforms.sortRows(dataRows, keys);
    buildMatrix._lastDataCount = limitedPreview ? csvRows.length : dataRows.length;
    if (rowLimit != null) dataRows = dataRows.slice(0, rowLimit);

    const matrix = [];
    if (chkIncludeHeader.checked) matrix.push(targets.slice());
    for (const r of dataRows) matrix.push(r);
    return matrix;
  }

  function buildTSV() {
    return buildMatrix().map(r => r.join('\t')).join('\n');
  }

  function renderPreview() {
    updateSummaries(); // sort/group/filter selects may have just changed
    const targets = getTargets();
    hideCopyFallback();
    if (csvHeaders.length === 0 || targets.length === 0) {
      previewCard.classList.add('hidden');
      previewNote.classList.add('hidden');
      previewNote.textContent = '';
      updateCopyEnabled();
      return;
    }

    // Only the selected number of data rows are shown, so only build those — a
    // full-matrix build on every keystroke would scan the whole file (50k+ rows)
    // for nothing.
    const matrix = buildMatrix(previewRowsLimit);
    const hasHeader = chkIncludeHeader.checked;
    const headerCells = hasHeader ? matrix[0] : targets;
    const dataRows = (hasHeader ? matrix.slice(1) : matrix).slice(0, previewRowsLimit);

    let html = '<thead><tr>' + headerCells.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead>';
    html += '<tbody>' + dataRows.map(r =>
      '<tr>' + r.map(c => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>'
    ).join('') + '</tbody>';
    previewTable.innerHTML = html;
    previewCard.classList.remove('hidden');
    const visibleTotal = (hasFilter() || hasConsolidate()) ? (buildMatrix._lastDataCount || 0) : csvRows.length;
    if (visibleTotal > previewRowsLimit) {
      const tags = [];
      if (hasOrdering()) tags.push('sorted');
      if (hasConsolidate()) tags.push('combined');
      const ordered = tags.length ? ` (${tags.join(', ')})` : '';
      const filtered = hasFilter() ? ` after filter (${csvRows.length} source rows)` : '';
      const copyNote = hasFilter() ? 'Copy includes every matching row.' : 'Copy includes every row.';
      previewNote.textContent = `Showing first ${previewRowsLimit} of ${visibleTotal} rows${ordered}${filtered}. ${copyNote}`;
      previewNote.classList.remove('hidden');
    } else {
      previewNote.classList.add('hidden');
      previewNote.textContent = '';
    }

    updateCopyEnabled();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function updateCopyEnabled() {
    const canOutput = csvRows.length > 0 && getTargets().length > 0;
    btnCopy.disabled = !canOutput;
    btnDownloadTsv.disabled = !canOutput;
    btnDownloadCsv.disabled = !canOutput;
    if (!canOutput) hideCopyFallback();
    renderMappingWarning();
    updateStickyCta();
  }

  // ----------------- Copy -----------------

  // Briefly flash "Copied!" on whichever button was used (main or sticky).
  function flashCopied(btn) {
    const label = btn && btn.querySelector('.btn-text, .sticky-text');
    if (!label) return;
    const orig = label.textContent;
    label.textContent = 'Copied!';
    setTimeout(() => { label.textContent = orig; }, 1500);
  }

  function hideCopyFallback() {
    copyFallback.classList.add('hidden');
    fallbackTsv.value = '';
  }

  function showCopyFallback(tsv) {
    fallbackTsv.value = tsv;
    copyFallback.classList.remove('hidden');
    fallbackTsv.focus();
    fallbackTsv.select();
  }

  function outputFileName(ext) {
    const base = (loadedName || 'csv-to-sheets')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'csv-to-sheets';
    return `${base}-mapped.${ext}`;
  }

  function downloadBlob(text, mimeType, fileName) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    const n = buildMatrix._lastDataCount == null ? csvRows.length : buildMatrix._lastDataCount;
    return n;
  }

  function downloadTSV() {
    const n = downloadBlob(buildTSV(), 'text/tab-separated-values;charset=utf-8', outputFileName('tsv'));
    setStatus('ok', `Downloaded ${n} row${n === 1 ? '' : 's'} as TSV.`);
  }

  function downloadCSV() {
    const csv = Transforms.toCSV(buildMatrix());
    const n = downloadBlob(csv, 'text/csv;charset=utf-8', outputFileName('csv'));
    setStatus('ok', `Downloaded ${n} row${n === 1 ? '' : 's'} as CSV.`);
  }

  async function doCopy(triggerBtn) {
    const tsv = buildTSV();
    try {
      await navigator.clipboard.writeText(tsv);
      const n = buildMatrix._lastDataCount == null ? csvRows.length : buildMatrix._lastDataCount;
      setStatus('ok', `Copied ${n} row${n === 1 ? '' : 's'}. Click your sheet and press Ctrl/Cmd+V.`);
      hideCopyFallback();
      flashCopied(triggerBtn);
    } catch (e) {
      console.error(e);
      showCopyFallback(tsv);
      setStatus('err', 'Clipboard copy failed. Use the fallback below or download TSV.');
    }
  }

  btnCopy.addEventListener('click', () => doCopy(btnCopy));
  btnCopySticky.addEventListener('click', () => doCopy(btnCopySticky));
  btnDownloadTsv.addEventListener('click', downloadTSV);
  btnDownloadCsv.addEventListener('click', downloadCSV);
  btnSelectFallback.addEventListener('click', () => {
    fallbackTsv.focus();
    fallbackTsv.select();
  });
  btnDismissFallback.addEventListener('click', hideCopyFallback);

  // ----------------- Persistence -----------------

  // Remember the uploaded file across popup sessions. Stores the raw text
  // (re-parsed on restore — more compact than the parsed rows) plus the file
  // name and detected delimiter, so reopening the popup shows the same data.
  function persistFile(text, name, delim) {
    storageSet({ csvText: text, csvFileName: name, csvDelim: delim }, 'persist file');
  }

  function clearPersistedFile() {
    try {
      chrome.storage.local.remove(['csvText', 'csvFileName', 'csvDelim']);
    } catch (e) {
      console.warn('clear file failed:', e);
    }
  }

  function persist() {
    storageSet({
      targetHeaders: inputTargetHeaders.value,
      columnMapping: getMapping(),
      requiredHeaders: cleanRequiredHeaders(),
      activeMappingPreset: activePresetName,
      firstRowHeader: chkFirstRowHeader.checked,
      includeHeader: chkIncludeHeader.checked,
      skipRows: getSkip(),
      cleanNumbers: chkCleanNumbers.checked,
      normalizeDates: chkNormalizeDates.checked,
      consolidate: chkConsolidate.checked,
      consolidateAgg: selectConsolidateAgg.value,
      rememberFile: chkRememberFile.checked,
      delimiterMode: selectDelimiter.value,
      sortBy: selectSortBy.value,
      sortByTarget: selectedTargetName(selectSortBy),
      sortDir: selectSortDir.value,
      sortBy2: selectSortBy2.value,
      sortBy2Target: selectedTargetName(selectSortBy2),
      sortDir2: selectSortDir2.value,
      groupBy: selectGroupBy.value,
      groupByTarget: selectedTargetName(selectGroupBy),
      // Filters store the column by name (survives header reorders) with the
      // raw index as a fallback, mirroring the sortBy/sortByTarget pair.
      filters: filters.map(f => ({ target: f.target, by: f.index, op: f.op, value: f.value })),
      previewRows: previewRowsLimit
    });
  }

  // ----------------- Header chips -----------------

  // Add the header if absent, remove it if present. Preserves any other
  // manually-typed headers and their order; new picks append to the end.
  function toggleHeader(header) {
    const targets = getTargets();
    const idx = targets.findIndex(t => t.toLowerCase() === header.toLowerCase());
    if (idx === -1) {
      targets.push(header);
    } else {
      targets.splice(idx, 1);
    }
    setTargets(targets);
    markManualSetup();
    renderMapping();
    renderPreview();
    persist();
    updateChipActive();
  }

  // Persist just the editable header-option palette.
  function persistHeaderOptions() {
    storageSet({ headerOptions }, 'persist headerOptions');
  }

  // Add a header to the palette permanently (case-insensitive de-dupe).
  function addHeaderOption(name) {
    const h = (name || '').trim();
    if (!h) return;
    if (headerOptions.some(o => o.toLowerCase() === h.toLowerCase())) return;
    headerOptions.push(h);
    persistHeaderOptions();
  }

  // Remove a header from the palette permanently, and also drop it from the
  // current target headers (the text field) if it's selected there.
  function removeHeaderOption(name) {
    headerOptions = headerOptions.filter(o => o.toLowerCase() !== name.toLowerCase());
    persistHeaderOptions();

    const targets = getTargets().filter(t => t.toLowerCase() !== name.toLowerCase());
    setTargets(targets);
    markManualSetup();

    renderPresets();
    renderMapping();
    renderPreview();
    persist();
  }

  // Swap the "+ Add" button for an inline input; commit on Enter/blur, cancel on Esc.
  function startAddHeader(addBtn) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chip chip-add-input';
    input.placeholder = 'Header name';
    input.setAttribute('aria-label', 'New header name');
    addBtn.replaceWith(input);
    input.focus();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) addHeaderOption(input.value);
      renderPresets();           // restores the + Add button and shows any new chip
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // The single header editor. Selected headers render first as red, draggable
  // bubbles in column order — dragging one reorders the target list (and therefore
  // the output/preview columns). Unselected quick-add options follow as grey chips
  // (click to add), then the "+ Add" affordance.
  function renderPresets() {
    const targets = getTargets();
    requiredHeaders = cleanRequiredHeaders(targets);
    const activeLower = targets.map(t => t.toLowerCase());
    presetChips.innerHTML = '';

    // Active header bubbles (draggable, ordered)
    targets.forEach((target, index) => {
      const bubble = document.createElement('div');
      bubble.className = 'header-bubble' + (isRequiredHeader(target) ? ' required' : '');
      bubble.draggable = true;
      bubble.dataset.index = String(index);
      bubble.title = 'Drag to reorder columns';
      bubble.setAttribute('tabindex', '0');
      bubble.setAttribute('role', 'option');

      const name = document.createElement('span');
      name.className = 'bubble-name';
      name.textContent = target;

      const req = document.createElement('button');
      req.type = 'button';
      req.className = 'bubble-req' + (isRequiredHeader(target) ? ' active' : '');
      req.textContent = 'Req';
      req.title = `Toggle required field for "${target}"`;
      req.addEventListener('click', e => { e.stopPropagation(); toggleRequiredHeader(target); });

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'bubble-remove';
      rm.textContent = '×';
      rm.title = `Remove "${target}"`;
      rm.setAttribute('aria-label', `Remove ${target}`);
      rm.addEventListener('click', e => { e.stopPropagation(); removeTargetAt(index); });

      bubble.addEventListener('dragstart', e => {
        bubble.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        _dragSourceIndex = index;
        _dragInsertIndex = index;
        // Insert placeholder next to the dragged bubble on the next frame
        // (requestAnimationFrame ensures the browser captures the drag image first).
        requestAnimationFrame(() => {
          const ph = getDragPlaceholder(target);
          bubble.after(ph);
        });
      });
      bubble.addEventListener('dragend', () => {
        bubble.classList.remove('dragging');
        removeDragPlaceholder();
      });
      bubble.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (_dragSourceIndex === index) return; // hovering over self — no-op
        const ph = getDragPlaceholder(targets[_dragSourceIndex] || '');
        const rect = bubble.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        if (e.clientX < midX) {
          bubble.before(ph);
        } else {
          bubble.after(ph);
        }
        _dragInsertIndex = computeInsertIndex();
      });
      bubble.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        _dragInsertIndex = computeInsertIndex();
        executeDrop();
      });

      bubble.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (index > 0) {
            reorderTargets(index, index - 1);
            setTimeout(() => {
              const el = presetChips.querySelector(`.header-bubble[data-index="${index - 1}"]`);
              if (el) el.focus();
            }, 0);
          }
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (index < targets.length - 1) {
            reorderTargets(index, index + 1);
            setTimeout(() => {
              const el = presetChips.querySelector(`.header-bubble[data-index="${index + 1}"]`);
              if (el) el.focus();
            }, 0);
          }
        }
      });

      bubble.appendChild(name);
      bubble.appendChild(req);
      bubble.appendChild(rm);
      presetChips.appendChild(bubble);
    });

    // Unselected quick-add options (click to add; corner × deletes from palette)
    headerOptions.forEach(header => {
      if (activeLower.includes(header.toLowerCase())) return;
      const wrap = document.createElement('div');
      wrap.className = 'chip-wrap';

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = header;
      chip.dataset.header = header;
      chip.addEventListener('click', () => toggleHeader(header));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chip-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Delete ${header} from quick add`);
      remove.title = `Delete "${header}" from quick add`;
      remove.addEventListener('click', e => { e.stopPropagation(); removeHeaderOption(header); });

      wrap.appendChild(remove);
      wrap.appendChild(chip);
      presetChips.appendChild(wrap);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'chip chip-add';
    addBtn.textContent = '+ Add';
    addBtn.title = 'Add a new quick-add header';
    addBtn.addEventListener('click', () => startAddHeader(addBtn));
    presetChips.appendChild(addBtn);

    updateHeadersView();
  }

  // Active state now lives in renderPresets (selected headers become bubbles), so
  // refreshing it is just a re-render.
  function updateChipActive() { renderPresets(); }

  // "Paste headers from sheet": read a copied header row off the clipboard. A row
  // copied from Google Sheets arrives tab-separated; a column copied down arrives
  // newline-separated. splitTargets handles tabs/newlines/commas, so we just
  // re-emit a clean comma list into the textarea.
  btnPasteHeaders.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const headers = Transforms.splitTargets(text);
      if (headers.length === 0) {
        setStatus('err', 'Clipboard had no headers to paste. Copy a header row from your sheet first.');
        return;
      }
      setTargets(headers);
      markManualSetup();
      renderMapping();
      renderPreview();
      persist();
      updateChipActive();
      setStatus('ok', `Pasted ${headers.length} header${headers.length === 1 ? '' : 's'} from the clipboard.`);
    } catch (e) {
      console.error(e);
      setStatus('err', 'Could not read the clipboard. Paste into the box above instead.');
    }
  });

  selectMappingPreset.addEventListener('change', () => {
    if (selectMappingPreset.value) {
      applyMappingPreset(selectMappingPreset.value);
    } else {
      activePresetName = '';
      renderMappingPresets();
      persist();
    }
  });
  btnSavePreset.addEventListener('click', saveMappingPreset);
  btnDeletePreset.addEventListener('click', deleteMappingPreset);
  btnExportPresets.addEventListener('click', exportMappingPresets);
  btnImportPresets.addEventListener('click', () => inputImportPresets.click());
  inputImportPresets.addEventListener('change', () => {
    importMappingPresets(inputImportPresets.files && inputImportPresets.files[0]);
  });

  inputTargetHeaders.addEventListener('input', () => { markManualSetup(); renderMapping(); renderPreview(); persist(); updateChipActive(); });
  chkIncludeHeader.addEventListener('change', () => { renderPreview(); persist(); });
  chkCleanNumbers.addEventListener('change', () => { renderPreview(); persist(); });
  chkNormalizeDates.addEventListener('change', () => { renderPreview(); persist(); });
  chkConsolidate.addEventListener('change', () => {
    updateConsolidateEnabled(); // the agg picker follows the checkbox
    renderPreview();
    persist();
  });
  selectConsolidateAgg.addEventListener('change', () => { renderPreview(); persist(); });
  [selectSortBy, selectSortDir, selectSortBy2, selectSortDir2, selectGroupBy].forEach(sel => {
    sel.addEventListener('change', () => {
      if (sel === selectSortBy || sel === selectSortBy2 || sel === selectGroupBy) {
        rememberSelectedTarget(sel);
      }
      if (sel === selectGroupBy) {
        updateConsolidateEnabled();
        if (chkConsolidate.disabled) chkConsolidate.checked = false;
        updateConsolidateEnabled(); // unchecking above also disables the agg picker
      }
      renderPreview();
      persist();
    });
  });
  btnAddFilter.addEventListener('click', () => {
    filters.push(blankFilter());
    renderFilterControls();
    const rows = filterList.querySelectorAll('.filter-item select.order-select');
    if (rows.length) rows[rows.length - 1].focus();
    persist();
  });
  selectPreviewRows.addEventListener('change', () => {
    previewRowsLimit = Number(selectPreviewRows.value) || PREVIEW_ROWS;
    renderPreview();
    persist();
  });

  async function restore() {
    let data = {};
    try {
      data = await chrome.storage.local.get(
        [
          'targetHeaders', 'columnMapping', 'activeMappingPreset',
          'mappingPresets', 'requiredHeaders', 'firstRowHeader', 'includeHeader',
          'headerOptions', 'skipRows', 'cleanNumbers', 'normalizeDates',
          'consolidate', 'consolidateAgg', 'rememberFile',
          'delimiterMode', 'sortBy', 'sortByTarget', 'sortDir',
          'sortBy2', 'sortBy2Target', 'sortDir2', 'groupBy', 'groupByTarget',
          // filters is the current shape; filterBy/filterByTarget/filterOp/
          // filterValue are the pre-multi-filter keys, read once to migrate.
          'filters', 'filterBy', 'filterByTarget', 'filterOp', 'filterValue',
          'previewRows', 'csvText', 'csvFileName', 'csvDelim'
        ]
      ) || {};
      if (typeof data.targetHeaders === 'string') inputTargetHeaders.value = data.targetHeaders;
      if (Array.isArray(data.requiredHeaders)) requiredHeaders = data.requiredHeaders.filter(h => typeof h === 'string');
      if (typeof data.firstRowHeader === 'boolean') chkFirstRowHeader.checked = data.firstRowHeader;
      if (typeof data.includeHeader === 'boolean') chkIncludeHeader.checked = data.includeHeader;
      if (data.columnMapping) renderMapping._saved = data.columnMapping;
      if (Array.isArray(data.mappingPresets)) {
        mappingPresets = data.mappingPresets
          .map(normalizePreset)
          .filter(Boolean);
      }
      if (typeof data.activeMappingPreset === 'string') activePresetName = data.activeMappingPreset;
      if (Array.isArray(data.headerOptions)) headerOptions = data.headerOptions.slice();
      if (typeof data.skipRows === 'number') inputSkipRows.value = String(data.skipRows);
      if (typeof data.cleanNumbers === 'boolean') chkCleanNumbers.checked = data.cleanNumbers;
      if (typeof data.normalizeDates === 'boolean') chkNormalizeDates.checked = data.normalizeDates;
      if (typeof data.consolidate === 'boolean') chkConsolidate.checked = data.consolidate;
      if (AGG_OPS.includes(data.consolidateAgg)) selectConsolidateAgg.value = data.consolidateAgg;
      if ([8, 25, 50, 100, 250].includes(data.previewRows)) {
        previewRowsLimit = data.previewRows;
        selectPreviewRows.value = String(data.previewRows);
      }
      if (typeof data.rememberFile === 'boolean') chkRememberFile.checked = data.rememberFile;
      if (['auto', ',', 'tab', ';', '|'].includes(data.delimiterMode)) selectDelimiter.value = data.delimiterMode;
      if (data.sortDir === 'asc' || data.sortDir === 'desc') selectSortDir.value = data.sortDir;
      if (data.sortDir2 === 'asc' || data.sortDir2 === 'desc') selectSortDir2.value = data.sortDir2;

      if (Array.isArray(data.filters)) {
        filters = data.filters.map(f => f && typeof f === 'object' ? {
          target: typeof f.target === 'string' ? f.target : '',
          index: typeof f.by === 'string' ? f.by : 'none',
          op: FILTER_OPS.includes(f.op) ? f.op : 'contains',
          value: typeof f.value === 'string' ? f.value : ''
        } : null).filter(Boolean);
      } else if (typeof data.filterBy === 'string' || typeof data.filterOp === 'string') {
        // Migrate the pre-multi-filter single-filter keys into one entry.
        filters = [{
          target: typeof data.filterByTarget === 'string' ? data.filterByTarget : '',
          index: typeof data.filterBy === 'string' ? data.filterBy : 'none',
          op: FILTER_OPS.includes(data.filterOp) ? data.filterOp : 'contains',
          value: typeof data.filterValue === 'string' ? data.filterValue : ''
        }];
      }

      // Rebuild the parsed CSV from the remembered file — only when the user has
      // opted in. Done after skipRows / firstRowHeader are restored above, since
      // applyHeaderMode reads them. Legacy data (saved before this toggle, so
      // rememberFile is absent → unchecked) is purged cleanly rather than restored.
      if (typeof data.csvText === 'string' && data.csvText !== '') {
        if (chkRememberFile.checked) {
          const name = (typeof data.csvFileName === 'string' && data.csvFileName) || 'Restored file';
          fileLabel.textContent = name;
          fileDrop.classList.add('has-file');
          btnClearFile.classList.remove('hidden');
          const explicit = explicitDelimiter() ||
            (isSupportedDelimiter(data.csvDelim) ? data.csvDelim : null);
          // persist:false — this text just came out of storage; don't rewrite it.
          await loadFromText(data.csvText, name, { explicitDelim: explicit, persist: false });
        } else {
          clearPersistedFile(); // opted out / legacy data: purge the stale copy
        }
      }
    } catch (e) {
      console.warn('restore failed:', e);
    }
    renderMappingPresets();
    renderPresets();   // re-render with the restored palette (also refreshes active state)
    renderMapping();   // populates the Sort by / Group by option lists
    // Apply saved sort/group now that the option lists exist. Prefer the target
    // header name so reordering headers doesn't change the selected metric.
    // (Filters resolve their own names inside renderFilterControls.)
    trySelectTarget(selectSortBy, data.sortByTarget, data.sortBy);
    trySelectTarget(selectSortBy2, data.sortBy2Target, data.sortBy2);
    trySelectTarget(selectGroupBy, data.groupByTarget, data.groupBy);
    updateConsolidateEnabled(); // re-check now that the restored group selection is applied
    renderFilterControls(getTargets());
    maybeExpandAdvanced(); // active settings shouldn't hide behind the fold
    renderPreview();
  }

  renderMappingPresets();
  renderPresets();  // independent of storage so chips always appear
  restore();
});
