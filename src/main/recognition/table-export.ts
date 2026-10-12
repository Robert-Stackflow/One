import { deflateRawSync } from 'node:zlib';
import { dialog, type BrowserWindow } from 'electron';
import { basename } from 'node:path';
import { rename, lstat } from 'node:fs/promises';
import { atomicWrite } from '../materials/atomic-file';
import { tableDocument, tableColumn, escapeTableText } from '../../shared/recognition/table';
const workbookText = (text: string) =>
  escapeTableText(
    text
      .replace(/_x[0-9a-f]{4}_/gi, (match) => '_x005F_' + match.slice(1))
      .replace(/\r/g, '_x000D_'),
  );

// Small, fixed OOXML package. All cells are inline strings, including text starting with '='.
export function tableWorkbook(value: unknown) {
  const d = tableDocument(value),
    xml = (body: string) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body;
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rows = Array.from(
    { length: d.rows },
    (_, row) =>
      `<row r="${row + 1}">${d.cells
        .filter((c) => c.row === row)
        .map(
          (c) =>
            `<c r="${tableColumn(c.column)}${row + 1}" t="inlineStr" s="1"><is><t xml:space="preserve">${workbookText(c.text)}</t></is></c>`,
        )
        .join('')}</row>`,
  ).join('');
  const merges = d.cells
    .filter((c) => c.rowSpan * c.columnSpan > 1)
    .map(
      (c) =>
        `<mergeCell ref="${tableColumn(c.column)}${c.row + 1}:${tableColumn(c.column + c.columnSpan - 1)}${c.row + c.rowSpan}"/>`,
    );
  const files: Record<string, string> = {
    '[Content_Types].xml': xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ),
    '_rels/.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': xml(
      `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="识别表格" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    'xl/styles.xml': xml(
      `<styleSheet xmlns="${ns}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ),
    'xl/worksheets/sheet1.xml': xml(
      `<worksheet xmlns="${ns}"><dimension ref="A1:${tableColumn(d.columns - 1)}${d.rows}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols><col min="1" max="${d.columns}" width="22" customWidth="1"/></cols><sheetData>${rows}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}</worksheet>`,
    ),
  };
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const path = Buffer.from(name),
      raw = Buffer.from(text),
      compressed = deflateRawSync(raw),
      crc = crc32(raw),
      header = Buffer.alloc(30),
      record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(path.length, 26);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(path.length, 28);
    record.writeUInt32LE(offset, 42);
    local.push(header, path, compressed);
    central.push(record, path);
    offset += header.length + path.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(local.length / 3, 8);
  end.writeUInt16LE(local.length / 3, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function saveTable(window: BrowserWindow, value: unknown, valid: () => boolean, protect:(path:string)=>void) {
  const bytes = tableWorkbook(value);
  const choice = await dialog.showSaveDialog(window, {
    title: '导出识别表格',
    defaultPath: 'One-table.xlsx',
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
  });
  if (choice.canceled || !choice.filePath) return null;
  if (!valid()) throw Error('识别窗口已关闭，导出已取消');
  const file = choice.filePath.toLowerCase().endsWith('.xlsx')
    ? choice.filePath
    : choice.filePath + '.xlsx';
  protect(file);
  const inspect = async () => {
    try {
      return await lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  };
  const previous = await inspect();
  if (previous && (!previous.isFile() || previous.isSymbolicLink()))
    throw Error('请选择普通文件作为导出目标');
  if (previous && file !== choice.filePath)
    throw Error('目标工作簿已存在，请使用 .xlsx 文件名重新确认覆盖');
  await atomicWrite(file, bytes, async (stage, destination) => {
    if (!valid()) throw Error('识别窗口已关闭，导出已取消');
    protect(destination);
    const current = await inspect();
    if (
      !!previous !== !!current ||
      (previous &&
        current &&
        (previous.ino !== current.ino ||
          previous.size !== current.size ||
          previous.mtimeMs !== current.mtimeMs))
    )
      throw Error('目标文件已改变，请重新导出');
    await rename(stage, destination);
  });
  return basename(file);
}
