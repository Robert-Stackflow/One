import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import {
  blankTable,
  tableDocument,
  tableRange,
  mergeTable,
  splitTable,
  resizeTable,
  tableClipboard,
  tableColumn,
} from '../../src/shared/recognition/table';
import { recognizeTable } from '../../src/shared/recognition/table-recognition';
import { tableWorkbook } from '../../src/main/recognition/table-export';
import type { OCRResult, OCRWord } from '../../src/shared/recognition/ocr';

const word = (text: string, x: number, y: number, width = 70, height = 20): OCRWord => ({
  text,
  x,
  y,
  width,
  height,
  line: 0,
  confidence: 90,
});
const ocr = (words: OCRWord[], width = 600, height = 240): OCRResult => ({
  text: words.map((w) => w.text).join(' '),
  confidence: 90,
  width,
  height,
  words,
  language: 'eng',
});
function ruled(dark = false) {
  const raster = new Uint8Array(600 * 240 * 4);
  for (let i = 0; i < raster.length; i += 4) {
    raster[i] = raster[i + 1] = raster[i + 2] = dark ? 24 : 255;
    raster[i + 3] = 255;
  }
  function line(x1: number, y1: number, x2: number, y2: number) {
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++) {
        const at = (y * 600 + x) * 4;
        raster[at] = raster[at + 1] = raster[at + 2] = dark ? 220 : 40;
      }
  }
  for (const y of [20, 80, 140, 200]) line(20, y, 580, y);
  for (const x of [20, 420, 580]) line(x, 20, x, 200);
  line(220, 80, 220, 200);
  return raster;
}
test('Table validation rejects overlaps, holes, invalid spans and unexportable or excessive text', () => {
  const d = blankTable();
  assert.equal(d.cells.length, 4);
  for (const bad of [
    { ...d, rows: 201 },
    { ...d, columns: 51 },
    { ...d, cells: d.cells.slice(1) },
    { ...d, cells: [...d.cells, d.cells[0]] },
    { ...d, cells: [{ ...d.cells[0], rowSpan: 3 }, ...d.cells.slice(1)] },
    { ...d, cells: [{ ...d.cells[0], text: 'x'.repeat(32768) }, ...d.cells.slice(1)] },
    { ...d, cells: [{ ...d.cells[0], text: '\u0000' }, ...d.cells.slice(1)] },
    { ...d, cells: [{ ...d.cells[0], text: '\ud800' }, ...d.cells.slice(1)] },
  ])
    assert.throws(() => tableDocument(bad));
  const big = blankTable(40, 1);
  big.cells.forEach((c) => (c.text = 'a'.repeat(30000)));
  assert.throws(() => tableDocument(big), /文字过多/);
  assert.deepEqual(['A', 'Z', 'AA', 'AX'], [0, 25, 26, 49].map(tableColumn));
});
test('Ruled tables preserve empty cells, merged headers and multiline content in both themes', () => {
  const result = ocr([
    word('Inventory', 40, 40, 120),
    word('Total', 450, 40),
    word('Apple', 40, 100),
    word('12', 450, 100),
    word('Line one', 40, 150),
    word('Line two', 40, 175),
    word('Fresh', 240, 160),
    word('09', 450, 160),
  ]);
  for (const dark of [false, true]) {
    const d = recognizeTable(result, ruled(dark));
    assert.equal(d.method, 'grid');
    assert.equal(d.rows, 3);
    assert.equal(d.columns, 3);
    assert.deepEqual(d.cells[0], {
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 2,
      text: 'Inventory',
    });
    assert.equal(d.cells.find((c) => c.row === 1 && c.column === 1)?.text, '');
    assert.equal(d.cells.find((c) => c.row === 2 && c.column === 0)?.text, 'Line one\nLine two');
  }
  const empty = recognizeTable(ocr([]), ruled());
  const transparent = ruled();
  for (let i = 0; i < transparent.length; i += 4)
    if (transparent[i] === 255) {
      transparent[i] = transparent[i + 1] = transparent[i + 2] = transparent[i + 3] = 0;
    }
  assert.equal(recognizeTable(result, transparent).method, 'grid');
  const chinese = recognizeTable(
    ocr([word('文字', 40, 100, 40), word('识别', 82, 100, 40)]),
    ruled(),
  );
  assert.equal(chinese.cells.find((c) => c.row === 1 && c.column === 0)?.text, '文字识别');
  assert.equal(empty.cells.length, 8);
  assert.ok(empty.cells.every((c) => c.text === ''));
  assert.throws(() => recognizeTable(result, new Uint8Array(4)), /图片数据/);
});
test('Borderless aligned text infers columns without turning phrase spaces into columns and keeps missing cells', () => {
  const d = recognizeTable(
    ocr([
      word('Item', 20, 20, 40),
      word('name', 70, 20, 50),
      word('Qty', 220, 20),
      word('Price', 450, 20),
      word('Apple', 20, 75),
      word('12', 220, 75, 20),
      word('001.00', 450, 75, 80),
      word('Orange', 20, 130),
      word('9.50', 470, 130, 60),
    ]),
  );
  assert.equal(d.method, 'aligned');
  assert.equal(d.rows, 3);
  assert.equal(d.columns, 3);
  assert.equal(d.cells[0].text, 'Item name');
  assert.equal(d.cells[7].text, '');
  assert.equal(d.cells[5].text, '001.00');
  assert.throws(
    () => recognizeTable(ocr([word('paragraph', 20, 20), word('only', 20, 75)])),
    /无法确定表格列/,
  );
  assert.throws(() => recognizeTable(ocr([])), /无法确定表格行列/);
});
test('Structure correction expands selections over merges and preserves text through insert, delete and split', () => {
  let d = blankTable(3, 3);
  d.cells[0].text = 'A';
  d.cells[1].text = 'B';
  d = mergeTable(d, { top: 0, left: 0, bottom: 0, right: 1 });
  assert.equal(d.cells[0].text, 'A\nB');
  assert.deepEqual(tableRange(d, { row: 0, column: 1 }, { row: 1, column: 1 }), {
    top: 0,
    left: 0,
    bottom: 1,
    right: 1,
  });
  d = resizeTable(d, 'column', 0, true);
  assert.equal(d.cells[0].columnSpan, 3);
  assert.equal(d.columns, 4);
  d = resizeTable(d, 'column', 0, false);
  assert.equal(d.cells[0].columnSpan, 2);
  assert.equal(d.cells[0].text, 'A\nB');
  d = splitTable(d, 0, 0);
  assert.equal(d.cells.length, 9);
  assert.equal(d.cells[0].text, 'A\nB');
  assert.equal(d.cells[1].text, '');
  d = mergeTable(d, { top: 0, left: 0, bottom: 2, right: 0 });
  d = resizeTable(d, 'row', 0, false);
  assert.equal(d.cells[0].rowSpan, 2);
  assert.equal(d.cells[0].text, 'A\nB');
  assert.throws(() => resizeTable(blankTable(1, 1), 'row', 0, false), /至少保留/);
  assert.throws(() => mergeTable(blankTable(), { top: 0, left: 0, bottom: 0, right: 0 }), /Shift/);
  assert.throws(() => splitTable(blankTable(), 0, 0), /已合并/);
  assert.throws(() => resizeTable(blankTable(200, 1), 'row', 0, true), /上限/);
});
test('Successive structure corrections retain a complete nonoverlapping rectangular table', () => {
  let d = mergeTable(blankTable(4, 4), { top: 1, left: 1, bottom: 2, right: 2 });
  for (let i = 0; i < 80; i++) {
    const axis = i % 2 ? 'row' : 'column',
      size = axis === 'row' ? d.rows : d.columns;
    d = resizeTable(d, axis, i % size, i % 4 < 2 || size === 1);
    assert.deepEqual(tableDocument(d), d);
  }
});
test('Table clipboard preserves rectangular empty slots, quotes and merges while guarding spreadsheet formulas and HTML', () => {
  let d = blankTable(2, 3);
  d.cells[0].text = '=1+2';
  d.cells[1].text = '<script>alert(1)</script>';
  d.cells[2].text = 'a\tb\n"c"';
  d.cells[3].text = ' \t@SUM(A1)';
  d = mergeTable(d, { top: 1, left: 1, bottom: 1, right: 2 });
  const c = tableClipboard(d);
  assert.match(c.text, /^'=1\+2\t/);
  assert.match(c.text, /"a\tb\n""c"""/);
  assert.match(c.html, /colspan="2"/);
  assert.ok(!c.html.includes('<script>'));
  assert.ok(c.html.includes('&lt;script&gt;'));
  assert.match(c.text, /' \t@SUM/);
});
test('Workbook is a CRC-valid ZIP with required OOXML relationships, inline strings, text formatting and real merged ranges', () => {
  let d = blankTable(2, 3);
  d.cells[0].text = '=HYPERLINK("https://example.test")';
  d.cells[1].text = '001.00';
  d.cells[2].text = '中文 & <tag>';
  d.cells[3].text = 'first\nsecond\rthird _x0041_';
  d = mergeTable(d, { top: 1, left: 1, bottom: 1, right: 2 });
  const bytes = tableWorkbook(d),
    files = new Map<string, string>();
  let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(at + 8), 8);
    const length = bytes.readUInt32LE(at + 18),
      rawLength = bytes.readUInt32LE(at + 22),
      nameLength = bytes.readUInt16LE(at + 26),
      name = bytes.toString('utf8', at + 30, at + 30 + nameLength),
      raw = inflateRawSync(bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + length));
    assert.equal(raw.length, rawLength);
    let crc = 0xffffffff;
    for (const b of raw) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32LE(at + 14));
    files.set(name, raw.toString());
    at += 30 + nameLength + length;
  }
  assert.equal(bytes.readUInt32LE(at), 0x02014b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(files.size, 6);
  const sheet = files.get('xl/worksheets/sheet1.xml')!;
  assert.match(sheet, /mergeCell ref="B2:C2"/);
  assert.match(sheet, /t="inlineStr" s="1"/);
  assert.match(sheet, /001.00/);
  assert.match(sheet, /中文 &amp; &lt;tag&gt;/);
  assert.match(sheet, /first\nsecond_x000D_third _x005F_x0041_/);
  assert.ok(!sheet.includes('<f>'));
  assert.match(files.get('xl/_rels/workbook.xml.rels')!, /styles.xml/);
});
