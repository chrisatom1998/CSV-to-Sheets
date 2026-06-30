const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const html = fs.readFileSync('popup.html', 'utf8');
const js = fs.readFileSync('popup.js', 'utf8');
const css = fs.readFileSync('popup.css', 'utf8');

test('popup output fallback controls are present and wired', () => {
  const ids = [
    'btn-download-tsv',
    'copy-fallback',
    'fallback-tsv',
    'btn-select-fallback',
    'btn-dismiss-fallback'
  ];

  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`), `HTML should include #${id}`);
    assert.match(js, new RegExp(`getElementById\\('${id}'\\)`), `JS should reference #${id}`);
  }
});

test('popup output fallback behavior and styles are present', () => {
  for (const name of ['showCopyFallback', 'hideCopyFallback', 'downloadTSV']) {
    assert.match(js, new RegExp(`function ${name}\\(`), `JS should define ${name}`);
  }

  assert.match(js, /navigator\.clipboard\.writeText\(tsv\)/, 'copy should use the clipboard API');
  assert.match(js, /showCopyFallback\(tsv\)/, 'copy failure should show the fallback TSV');
  assert.match(js, /text\/tab-separated-values;charset=utf-8/, 'download should emit TSV');

  for (const selector of ['.output-actions', '.btn-download-tsv', '.copy-fallback']) {
    assert.ok(css.includes(selector), `CSS should include ${selector}`);
  }
});
