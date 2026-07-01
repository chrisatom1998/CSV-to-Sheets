// Parses CSV text off the popup's main thread so a large file doesn't freeze
// the UI. Pure delegation to transforms.js: the popup posts { id, text, delim }
// (delim null → auto-detect) and gets back { id, ok, rows, delim } or
// { id, ok: false, error }. popup.js falls back to a synchronous parse when
// workers are unavailable (e.g. the file:// static preview).
importScripts('transforms.js');

self.onmessage = (e) => {
  const { id, text, delim } = e.data || {};
  try {
    const used = delim || Transforms.detectDelimiter(text);
    const rows = Transforms.parseCSV(text, used);
    self.postMessage({ id, ok: true, rows, delim: used });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
