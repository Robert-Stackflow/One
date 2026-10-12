export const TABLE_ROWS = 200,
  TABLE_COLUMNS = 50,
  TABLE_CELLS = 10000,
  TABLE_TEXT = 1_000_000,
  TABLE_CELL_TEXT = 32767;
export interface TableCell {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  text: string;
}
export interface TableDocument {
  rows: number;
  columns: number;
  cells: TableCell[];
  method: 'grid' | 'aligned' | 'manual';
}
export interface TableRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}
export function tableDocument(value: unknown): TableDocument {
  const v = value as TableDocument;
  if (
    !v ||
    !Number.isInteger(v.rows) ||
    !Number.isInteger(v.columns) ||
    v.rows < 1 ||
    v.rows > TABLE_ROWS ||
    v.columns < 1 ||
    v.columns > TABLE_COLUMNS ||
    v.rows * v.columns > TABLE_CELLS ||
    !['grid', 'aligned', 'manual'].includes(v.method) ||
    !Array.isArray(v.cells) ||
    v.cells.length > TABLE_CELLS
  )
    throw Error('表格支持最多 200 行、50 列');
  const occupied = new Uint8Array(v.rows * v.columns);
  let length = 0;
  const cells = v.cells.map((c) => {
    if (
      !c ||
      ![c.row, c.column, c.rowSpan, c.columnSpan].every(Number.isInteger) ||
      c.row < 0 ||
      c.column < 0 ||
      c.rowSpan < 1 ||
      c.columnSpan < 1 ||
      c.row + c.rowSpan > v.rows ||
      c.column + c.columnSpan > v.columns ||
      typeof c.text !== 'string' ||
      c.text.length > TABLE_CELL_TEXT ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        c.text,
      )
    )
      throw Error('表格单元格无效或文字过长');
    length += c.text.length;
    if (length > TABLE_TEXT) throw Error('表格文字过多，请先裁剪图片');
    for (let r = c.row; r < c.row + c.rowSpan; r++)
      for (let col = c.column; col < c.column + c.columnSpan; col++) {
        const at = r * v.columns + col;
        if (occupied[at]) throw Error('表格单元格重叠');
        occupied[at] = 1;
      }
    return {
      row: c.row,
      column: c.column,
      rowSpan: c.rowSpan,
      columnSpan: c.columnSpan,
      text: c.text,
    };
  });
  if (occupied.includes(0)) throw Error('表格存在未定义单元格');
  return {
    rows: v.rows,
    columns: v.columns,
    method: v.method,
    cells: cells.sort((a, b) => a.row - b.row || a.column - b.column),
  };
}
function fill(document: TableDocument) {
  const occupied = new Uint8Array(document.rows * document.columns);
  for (const c of document.cells)
    for (let r = c.row; r < c.row + c.rowSpan; r++)
      for (let col = c.column; col < c.column + c.columnSpan; col++)
        occupied[r * document.columns + col] = 1;
  for (let r = 0; r < document.rows; r++)
    for (let col = 0; col < document.columns; col++)
      if (!occupied[r * document.columns + col])
        document.cells.push({ row: r, column: col, rowSpan: 1, columnSpan: 1, text: '' });
  return tableDocument(document);
}
export function blankTable(rows = 2, columns = 2): TableDocument {
  return fill({ rows, columns, cells: [], method: 'manual' });
}
export function tableRange(
  document: TableDocument,
  a: { row: number; column: number },
  b = a,
): TableRange {
  const range = {
    top: Math.min(a.row, b.row),
    left: Math.min(a.column, b.column),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.column, b.column),
  };
  if (
    range.top < 0 ||
    range.left < 0 ||
    range.bottom >= document.rows ||
    range.right >= document.columns
  )
    throw Error('请选择有效单元格');
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const c of document.cells) {
      if (
        c.row > range.bottom ||
        c.column > range.right ||
        c.row + c.rowSpan - 1 < range.top ||
        c.column + c.columnSpan - 1 < range.left
      )
        continue;
      const next = {
        top: Math.min(range.top, c.row),
        left: Math.min(range.left, c.column),
        bottom: Math.max(range.bottom, c.row + c.rowSpan - 1),
        right: Math.max(range.right, c.column + c.columnSpan - 1),
      };
      if (
        Object.keys(next).some((k) => next[k as keyof TableRange] !== range[k as keyof TableRange])
      ) {
        Object.assign(range, next);
        expanded = true;
      }
    }
  }
  return range;
}
export function mergeTable(value: TableDocument, range: TableRange) {
  const d = tableDocument(value),
    full = tableRange(
      d,
      { row: range.top, column: range.left },
      { row: range.bottom, column: range.right },
    );
  const selected = d.cells.filter(
    (c) =>
      c.row >= full.top && c.row <= full.bottom && c.column >= full.left && c.column <= full.right,
  );
  if (selected.length < 2) throw Error('按住 Shift 选择多个单元格后合并');
  d.cells = d.cells.filter((c) => !selected.includes(c));
  d.cells.push({
    row: full.top,
    column: full.left,
    rowSpan: full.bottom - full.top + 1,
    columnSpan: full.right - full.left + 1,
    text: selected
      .map((c) => c.text)
      .filter(Boolean)
      .join('\n'),
  });
  return tableDocument(d);
}
export function splitTable(value: TableDocument, row: number, column: number) {
  const d = tableDocument(value),
    c = d.cells.find((c) => c.row === row && c.column === column);
  if (!c || c.rowSpan * c.columnSpan === 1) throw Error('请选择已合并的单元格');
  c.rowSpan = 1;
  c.columnSpan = 1;
  return fill(d);
}
export function resizeTable(
  value: TableDocument,
  axis: 'row' | 'column',
  index: number,
  insert: boolean,
) {
  const d = tableDocument(value),
    size = axis === 'row' ? 'rows' : 'columns',
    span = axis === 'row' ? 'rowSpan' : 'columnSpan';
  if (!Number.isInteger(index) || index < 0 || index >= d[size]) throw Error('请选择有效行列');
  if (!insert && d[size] === 1) throw Error('至少保留一行一列');
  if (insert && d[size] >= (axis === 'row' ? TABLE_ROWS : TABLE_COLUMNS))
    throw Error('表格已达到行列上限');
  const at = insert ? index + 1 : index;
  d[size] += insert ? 1 : -1;
  d.cells = d.cells.filter((c) => insert || c[axis] !== at || c[span] !== 1);
  for (const c of d.cells) {
    if (insert) {
      if (c[axis] >= at) c[axis]++;
      else if (c[axis] + c[span] > at) c[span]++;
    } else {
      if (c[axis] > at) c[axis]--;
      else if (c[axis] + c[span] > at) c[span]--;
    }
  }
  return fill(d);
}
export const tableColumn = (n: number) => {
  let text = '';
  for (n++; n; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + ((n - 1) % 26)) + text;
  return text;
};
export const escapeTableText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function tableClipboard(value: unknown) {
  const d = tableDocument(value),
    lookup = new Map(d.cells.map((c) => [c.row * d.columns + c.column, c]));
  const safe = (text: string) => (/^\s*[=+\-@]/u.test(text) ? "'" + text : text);
  const rows: string[] = [],
    html: string[] = [];
  for (let r = 0; r < d.rows; r++) {
    const values: string[] = [],
      cells: string[] = [];
    for (let col = 0; col < d.columns; col++) {
      const c = lookup.get(r * d.columns + col),
        text = safe(c?.text || '');
      values.push(/[\t\r\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text);
      if (c)
        cells.push(
          `<td rowspan="${c.rowSpan}" colspan="${c.columnSpan}" style="mso-number-format:'\\@';white-space:pre-wrap">${escapeTableText(text).replace(/\r\n|\r|\n/g, '<br>')}</td>`,
        );
    }
    rows.push(values.join('\t'));
    html.push('<tr>' + cells.join('') + '</tr>');
  }
  return { text: rows.join('\r\n'), html: '<table>' + html.join('') + '</table>' };
}
