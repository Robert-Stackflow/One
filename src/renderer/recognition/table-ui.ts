import { q } from '../ui';
import {
  blankTable,
  tableDocument,
  tableColumn,
  tableRange,
  mergeTable,
  splitTable,
  resizeTable,
  TABLE_CELL_TEXT,
  type TableDocument,
  type TableRange,
  type TableCell,
} from '../../shared/recognition/table';
import type { OCRAPI, OCRState } from '../../shared/recognition/ocr';

export function mountTable(
  api: OCRAPI,
  state: () => OCRState | undefined,
  message: (value: unknown) => void,
  changed: () => void,
) {
  let document: TableDocument | undefined,
    mode = false,
    working = false,
    hasOCR = false;
  let gridLock: boolean | undefined,
    selectionKey = '';
  let anchor = { row: 0, column: 0 },
    end = { ...anchor },
    history: TableDocument[] = [];
  const busy = () => working;
  const editor = q<HTMLTextAreaElement>('table-cell-text'),
    grid = q('table-grid');
  const range = (): TableRange | undefined =>
    document ? tableRange(document, anchor, end) : undefined;
  const selected = (): TableCell | undefined =>
    document?.cells.find((c) => c.row === anchor.row && c.column === anchor.column);
  function render() {
    q('table-panel').hidden = !mode;
    q('table-tools').hidden = !mode;
    q('table-copy').hidden = !mode;
    q('table-save').hidden = !mode;
    const locked =
      working || !!state()?.running || !!state()?.translating || !!state()?.formulaRecognizing;
    for (const id of ['table-copy', 'table-save', 'table-apply'])
      q<HTMLButtonElement>(id).disabled = locked || !document;
    q<HTMLButtonElement>('table-rebuild').disabled = locked || !hasOCR;
    q<HTMLButtonElement>('table-new').disabled = locked;
    q<HTMLButtonElement>('table-undo').disabled = locked || !history.length;
    q<HTMLSelectElement>('table-operation').disabled = locked || !document;
    editor.disabled = locked || !document;
    if (gridLock !== locked) {
      for (const button of grid.querySelectorAll<HTMLButtonElement>('button'))
        button.disabled = locked;
      gridLock = locked;
    }
    q('table-empty').hidden = !!document;
    q('table-workspace').hidden = !document;
    if (!mode) return;
    const r = range();
    q('summary').textContent = document
      ? `${document.rows} 行 × ${document.columns} 列 · ${document.method === 'grid' ? '边框重建' : document.method === 'aligned' ? '文字对齐推断' : '手动表格'} · 请核对结构`
      : '识别后重建行列，或新建空表格';
    q('table-selection').textContent = r
      ? `选区 ${tableColumn(r.left)}${r.top + 1}:${tableColumn(r.right)}${r.bottom + 1} · 按住 Shift 点击扩选`
      : '选择单元格校正文字';
    const nextSelection = r
      ? `${r.top},${r.left},${r.bottom},${r.right},${anchor.row},${anchor.column}`
      : '';
    if (r && nextSelection !== selectionKey) {
      for (const button of grid.querySelectorAll<HTMLButtonElement>('button[data-row]')) {
        const row = Number(button.dataset.row),
          col = Number(button.dataset.column),
          active = row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
        button.classList.toggle('selected', active);
        button.ariaPressed = String(active);
        button.tabIndex = row === anchor.row && col === anchor.column ? 0 : -1;
      }
      selectionKey = nextSelection;
    }
  }
  function draw() {
    gridLock = undefined;
    selectionKey = '';
    if (!document) {
      grid.replaceChildren();
      render();
      return;
    }
    const table = window.document.createElement('table'),
      head = table.createTHead().insertRow(),
      corner = window.document.createElement('th');
    corner.textContent = '';
    head.append(corner);
    for (let col = 0; col < document.columns; col++) {
      const th = window.document.createElement('th');
      th.scope = 'col';
      th.textContent = tableColumn(col);
      head.append(th);
    }
    const lookup = new Map(document.cells.map((c) => [c.row * document!.columns + c.column, c])),
      body = table.createTBody();
    for (let row = 0; row < document.rows; row++) {
      const tr = body.insertRow(),
        th = window.document.createElement('th');
      th.scope = 'row';
      th.textContent = String(row + 1);
      tr.append(th);
      for (let col = 0; col < document.columns; col++) {
        const cell = lookup.get(row * document.columns + col);
        if (!cell) continue;
        const td = tr.insertCell(),
          button = window.document.createElement('button');
        td.rowSpan = cell.rowSpan;
        td.colSpan = cell.columnSpan;
        button.type = 'button';
        button.className = 'table-cell';
        button.textContent = cell.text || '\u00a0';
        button.dataset.row = String(row);
        button.dataset.column = String(col);
        button.setAttribute(
          'aria-label',
          `${tableColumn(col)}${row + 1}${cell.rowSpan * cell.columnSpan > 1 ? ' 合并单元格' : ''} ${cell.text}`,
        );
        button.onclick = (event) => select(cell.row, cell.column, event.shiftKey);
        button.onkeydown = (event) => {
          const delta = (
            {
              ArrowLeft: [0, -1],
              ArrowRight: [0, 1],
              ArrowUp: [-1, 0],
              ArrowDown: [1, 0],
            } as Record<string, number[]>
          )[event.key];
          if (!delta || !document) return;
          event.preventDefault();
          const start = event.shiftKey ? end : anchor,
            current = document.cells.find((c) => c.row === start.row && c.column === start.column)!,
            r = Math.max(0, Math.min(document.rows - 1, start.row + delta[0])),
            c = Math.max(
              0,
              Math.min(
                document.columns - 1,
                start.column + (delta[1] > 0 ? current.columnSpan : delta[1]),
              ),
            );
          const next = document.cells.find(
            (cell) =>
              (delta[0] > 0 ? Math.min(document!.rows - 1, start.row + current.rowSpan) : r) >=
                cell.row &&
              (delta[0] > 0 ? Math.min(document!.rows - 1, start.row + current.rowSpan) : r) <
                cell.row + cell.rowSpan &&
              c >= cell.column &&
              c < cell.column + cell.columnSpan,
          );
          if (next) {
            select(next.row, next.column, event.shiftKey);
            grid
              .querySelector<HTMLButtonElement>(
                `button[data-row="${next.row}"][data-column="${next.column}"]`,
              )
              ?.focus();
          }
        };
        td.append(button);
      }
    }
    grid.replaceChildren(table);
    editor.value = selected()?.text || '';
    render();
  }
  function select(row: number, column: number, extend = false) {
    if (working) return;
    if (!extend) anchor = { row, column };
    end = { row, column };
    editor.value = selected()?.text || '';
    render();
  }
  function remember() {
    if (document) {
      history.push(tableDocument(document));
      if (history.length > 30) history.shift();
    }
  }
  function operation(task: () => TableDocument) {
    try {
      const next = task();
      remember();
      document = next;
      anchor = {
        row: Math.min(anchor.row, next.rows - 1),
        column: Math.min(anchor.column, next.columns - 1),
      };
      const owner = next.cells.find(
        (c) =>
          anchor.row >= c.row &&
          anchor.row < c.row + c.rowSpan &&
          anchor.column >= c.column &&
          anchor.column < c.column + c.columnSpan,
      )!;
      anchor = { row: owner.row, column: owner.column };
      end = { ...anchor };
      draw();
      changed();
      message('表格已更新，可撤销本次校正');
    } catch (error) {
      message(error);
    }
  }
  editor.maxLength = TABLE_CELL_TEXT;
  editor.onchange = () => {
    const c = selected();
    if (!document || !c || editor.value === c.text) return;
    const text = editor.value;
    operation(() =>
      tableDocument({
        ...document!,
        cells: document!.cells.map((cell) => (cell === c ? { ...cell, text } : cell)),
      }),
    );
  };
  q('table-apply').onclick = () => {
    if (!document) return;
    const action = q<HTMLSelectElement>('table-operation').value;
    operation(() =>
      action === 'merge'
        ? mergeTable(document!, range()!)
        : action === 'split'
          ? splitTable(document!, anchor.row, anchor.column)
          : resizeTable(
              document!,
              action.endsWith('row') ? 'row' : 'column',
              action.endsWith('row') ? anchor.row : anchor.column,
              action.startsWith('insert'),
            ),
    );
  };
  q('table-undo').onclick = () => {
    if (!history.length || working) return;
    document = history.pop();
    anchor = { row: 0, column: 0 };
    end = { ...anchor };
    draw();
    changed();
    message('已撤销表格校正');
  };
  q('table-new').onclick = () => {
    if (working) return;
    remember();
    document = blankTable();
    anchor = { row: 0, column: 0 };
    end = { ...anchor };
    draw();
    changed();
    message('已新建 2 × 2 表格，可校正文字和行列');
  };
  async function rebuild() {
    if (working || !state()) return;
    working = true;
    render();
    changed();
    try {
      const next = await api.table(state()!.token);
      remember();
      document = tableDocument(next);
      anchor = { row: 0, column: 0 };
      end = { ...anchor };
      draw();
      message(
        document.method === 'grid'
          ? '已按边框重建表格，请核对内容和合并区域'
          : '已按文字对齐推断行列，请核对空格、多行和合并区域',
      );
    } catch (error) {
      message(error);
    } finally {
      working = false;
      render();
      changed();
    }
  }
  q('table-rebuild').onclick = () => void rebuild();
  async function output(save: boolean) {
    if (!document || working || !state()) return;
    working = true;
    render();
    changed();
    try {
      if (save) {
        const name = await api.saveTable(state()!.token, document);
        message(name ? `已导出 ${name}` : '已取消导出');
      } else {
        await api.copyTable(state()!.token, document);
        message('已复制表格，可粘贴到 Excel；以公式符号开头的文字按文本复制');
      }
    } catch (error) {
      message(error);
    } finally {
      working = false;
      render();
      changed();
    }
  }
  q('table-copy').onclick = () => void output(false);
  q('table-save').onclick = () => void output(true);
  return {
    render,
    busy,
    setMode: (value: boolean) => {
      mode = value;
      render();
    },
    recognized: async () => {
      hasOCR = true;
      if (mode) await rebuild();
      else render();
    },
  };
}
