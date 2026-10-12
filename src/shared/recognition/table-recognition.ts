import { ocrResult, type OCRResult, type OCRWord } from './ocr';
import {
  tableDocument,
  TABLE_ROWS,
  TABLE_COLUMNS,
  type TableDocument,
  type TableCell,
} from './table';

type WordRow = OCRWord[];
function rowsOf(words: OCRWord[]): WordRow[] {
  const rows: WordRow[] = [],
    centres: number[] = [],
    heights: number[] = [];
  for (const word of [...words].sort(
    (a, b) => a.y + a.height / 2 - b.y - b.height / 2 || a.x - b.x,
  )) {
    const centre = word.y + word.height / 2;
    let at = rows.length - 1;
    if (
      at < 0 ||
      Math.abs(centres[at] - centre) > Math.max(2, Math.min(heights[at], word.height) * 0.55)
    ) {
      rows.push([]);
      centres.push(centre);
      heights.push(word.height);
      at++;
    }
    const row = rows[at];
    centres[at] = (centres[at] * row.length + centre) / (row.length + 1);
    heights[at] = Math.max(heights[at], word.height);
    row.push(word);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}
function cellText(words: OCRWord[]) {
  return rowsOf(words)
    .map((row) =>
      row
        .map((w, i) => {
          if (!i) return w.text;
          const previous = row[i - 1],
            gap = w.x - previous.x - previous.width;
          return (
            (/\p{Script=Han}$/u.test(previous.text) &&
            /^\p{Script=Han}/u.test(w.text) &&
            gap < Math.max(w.height, previous.height) * 0.5
              ? ''
              : ' ') + w.text
          );
        })
        .join(''),
    )
    .join('\n');
}
function centres(lines: { at: number; start: number; end: number }[]) {
  const result: { at: number; start: number; end: number }[] = [];
  for (const line of lines) {
    const last = result.at(-1);
    if (last && line.at - last.at <= 3) {
      last.at = (last.at + line.at) / 2;
      last.start = Math.min(last.start, line.start);
      last.end = Math.max(last.end, line.end);
    } else result.push({ ...line });
  }
  return result.map((l) => ({ ...l, at: Math.round(l.at) }));
}
function grid(result: OCRResult, bitmap: Uint8Array): TableDocument | undefined {
  const { width: w, height: h } = result;
  if (bitmap.length !== w * h * 4) throw Error('表格图片数据无效');
  const samples: number[] = [];
  for (let p = 0; p < w * h; p += 97) {
    const alpha = bitmap[p * 4 + 3] / 255;
    samples.push(
      ((bitmap[p * 4] + bitmap[p * 4 + 1] + bitmap[p * 4 + 2]) / 3) * alpha + 255 * (1 - alpha),
    );
  }
  samples.sort((a, b) => a - b);
  const light = samples[Math.floor(samples.length / 2)] > 128,
    ink = new Uint8Array(w * h);
  for (let p = 0; p < ink.length; p++) {
    const alpha = bitmap[p * 4 + 3] / 255,
      gray =
        ((bitmap[p * 4] + bitmap[p * 4 + 1] + bitmap[p * 4 + 2]) / 3) * alpha + 255 * (1 - alpha);
    ink[p] = +(light ? gray < 180 : gray > 90);
  }
  function scan(horizontal: boolean) {
    const count = horizontal ? h : w,
      length = horizontal ? w : h,
      min = Math.max(30, length * 0.2),
      lines: { at: number; start: number; end: number }[] = [];
    for (let a = 0; a < count; a++) {
      let start = -1,
        last = -1,
        best = { at: a, start: 0, end: 0 };
      for (let b = 0; b < length + 2; b++) {
        const dark = b < length && ink[horizontal ? a * w + b : b * w + a];
        if (dark) {
          if (start < 0) start = b;
          last = b;
        } else if (start >= 0 && b - last > 1) {
          if (last - start > best.end - best.start) best = { at: a, start, end: last };
          start = -1;
        }
      }
      if (best.end - best.start >= min) lines.push(best);
    }
    return centres(lines);
  }
  const horizontal = scan(true),
    vertical = scan(false);
  if (horizontal.length < 2 || vertical.length < 2) return;
  // A table must have intersecting outer borders; isolated underlines are not a grid.
  const left = Math.max(horizontal[0].start, horizontal.at(-1)!.start),
    right = Math.min(horizontal[0].end, horizontal.at(-1)!.end);
  const xs = vertical.filter((l) => l.at >= left - 3 && l.at <= right + 3).map((l) => l.at),
    ys = horizontal
      .filter((l) => l.at >= vertical[0].start - 3 && l.at <= vertical.at(-1)!.end + 3)
      .map((l) => l.at);
  if (xs.length < 2 || ys.length < 2) return;
  const columns = xs.length - 1,
    rows = ys.length - 1;
  if (rows > TABLE_ROWS || columns > TABLE_COLUMNS) throw Error('检测到的表格过大，请先裁剪图片');
  function edge(horizontal: boolean, at: number, start: number, end: number) {
    const pad = Math.min(5, Math.floor((end - start) / 4));
    let hits = 0,
      total = 0;
    for (let b = start + pad; b <= end - pad; b++) {
      let dark = false;
      for (let k = -2; k <= 2; k++) {
        const x = horizontal ? b : at + k,
          y = horizontal ? at + k : b;
        if (x >= 0 && x < w && y >= 0 && y < h && ink[y * w + x]) dark = true;
      }
      hits += +dark;
      total++;
    }
    return hits / Math.max(1, total) > 0.55;
  }
  if (
    !edge(true, ys[0], xs[0], xs.at(-1)!) ||
    !edge(true, ys.at(-1)!, xs[0], xs.at(-1)!) ||
    !edge(false, xs[0], ys[0], ys.at(-1)!) ||
    !edge(false, xs.at(-1)!, ys[0], ys.at(-1)!)
  )
    return;
  const parents = Array.from({ length: rows * columns }, (_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parents[r] !== r) r = parents[r];
    while (parents[i] !== i) {
      const next = parents[i];
      parents[i] = r;
      i = next;
    }
    return r;
  };
  const unite = (a: number, b: number) => {
    parents[root(a)] = root(b);
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      if (c + 1 < columns && !edge(false, xs[c + 1], ys[r], ys[r + 1]))
        unite(r * columns + c, r * columns + c + 1);
      if (r + 1 < rows && !edge(true, ys[r + 1], xs[c], xs[c + 1]))
        unite(r * columns + c, (r + 1) * columns + c);
    }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < parents.length; i++) {
    const key = root(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }
  const cells: TableCell[] = [];
  for (const group of groups.values()) {
    const rs = group.map((i) => Math.floor(i / columns)),
      cs = group.map((i) => i % columns),
      top = Math.min(...rs),
      bottom = Math.max(...rs),
      left = Math.min(...cs),
      right = Math.max(...cs);
    if ((bottom - top + 1) * (right - left + 1) !== group.length)
      throw Error('表格边框不完整，无法确定合并区域，请裁剪或手动校正');
    cells.push({
      row: top,
      column: left,
      rowSpan: bottom - top + 1,
      columnSpan: right - left + 1,
      text: '',
    });
  }
  const assigned = new Map(cells.map((c) => [c, [] as OCRWord[]])),
    owners = new Array<TableCell>(rows * columns);
  for (const c of cells)
    for (let r = c.row; r < c.row + c.rowSpan; r++)
      for (let col = c.column; col < c.column + c.columnSpan; col++) owners[r * columns + col] = c;
  const interval = (positions: number[], at: number) => {
    let low = 0,
      high = positions.length - 1;
    if (at <= positions[0] || at >= positions[high]) return -1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (at < positions[mid]) high = mid;
      else low = mid;
    }
    return low;
  };
  for (const word of result.words) {
    const x = word.x + word.width / 2,
      y = word.y + word.height / 2;
    const row = interval(ys, y),
      col = interval(xs, x),
      c = row >= 0 && col >= 0 ? owners[row * columns + col] : undefined;
    if (c) assigned.get(c)!.push(word);
  }
  for (const c of cells) c.text = cellText(assigned.get(c)!);
  return tableDocument({ rows, columns, cells, method: 'grid' });
}
function aligned(result: OCRResult): TableDocument {
  const words = result.words.filter((w) => w.text.trim() && w.width && w.height),
    rows = rowsOf(words);
  if (rows.length < 2) throw Error('无法确定表格行列，请裁剪到表格或新建空表格校正');
  const heights = words.map((w) => w.height).sort((a, b) => a - b),
    gap = Math.max(8, heights[Math.floor(heights.length / 2)] * 0.9),
    counts = new Int32Array(result.width + 1);
  for (const row of rows) {
    const occupied = new Uint8Array(result.width);
    for (const w of row) occupied.fill(1, w.x, w.x + w.width);
    for (let x = 0; x < occupied.length; x++) counts[x] += occupied[x];
  }
  const left = Math.min(...words.map((w) => w.x)),
    right = Math.max(...words.map((w) => w.x + w.width)),
    cuts: number[] = [];
  let start = -1;
  for (let x = left; x <= right; x++) {
    if (counts[x] <= Math.floor(rows.length * 0.2)) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      if (x - start >= gap) cuts.push((start + x) / 2);
      start = -1;
    }
  }
  if (!cuts.length) throw Error('无法确定表格列，请裁剪到表格或新建空表格校正');
  const columns = cuts.length + 1;
  if (rows.length > TABLE_ROWS || columns > TABLE_COLUMNS)
    throw Error('检测到的表格过大，请先裁剪图片');
  const cells: TableCell[] = [];
  rows.forEach((words, row) => {
    for (let column = 0; column < columns; column++)
      cells.push({
        row,
        column,
        rowSpan: 1,
        columnSpan: 1,
        text: cellText(
          words.filter((w) => {
            const x = w.x + w.width / 2;
            return x > (cuts[column - 1] ?? -1) && x <= (cuts[column] ?? Infinity);
          }),
        ),
      });
  });
  return tableDocument({ rows: rows.length, columns, cells, method: 'aligned' });
}
export function recognizeTable(value: OCRResult, bitmap?: Uint8Array) {
  const result = ocrResult(value, value, value.language);
  return (bitmap && grid(result, bitmap)) || aligned(result);
}
