import type { OCRResult, OCRWord } from './ocr';

export interface TextPoint { x: number; y: number }
export type TextQuad = [TextPoint, TextPoint, TextPoint, TextPoint];
export interface TextToken {
  id: string;
  wordId: string;
  lineId: string;
  order: number;
  text: string;
  separatorAfter: string;
  quad: TextQuad;
  geometry: 'character' | 'word' | 'ctc';
  confidence?: number;
  sourceStart?: number;
  sourceEnd?: number;
  recognitionRevision?: number;
}
export interface TextLine {
  id: string;
  order: number;
  quad: TextQuad;
  tokens: TextToken[];
}
export interface TextBlock {
  id: string;
  order: number;
  quad: TextQuad;
  lines: TextLine[];
}
export interface TextDocument {
  schema: 1;
  id: string;
  source: { sha256: string; width: number; height: number; transform: [number, number, number, number, number, number] };
  engine: { id: string; version: string; model: string; device: string; confidenceScale?: number };
  language: string;
  text: string;
  alignment: 'source' | 'reconstructed';
  blocks: TextBlock[];
  revision?:number;
  revisions?:{revision:number;region:{left:number;top:number;width:number;height:number};context?:{left:number;top:number;width:number;height:number};contextToSource?:[number,number,number,number,number,number];engine:TextDocument['engine'];language:string}[];
}
export function textBounds(quad: TextQuad) {
  const x = Math.min(...quad.map(point => point.x)), y = Math.min(...quad.map(point => point.y));
  return { x, y, width: Math.max(...quad.map(point => point.x)) - x, height: Math.max(...quad.map(point => point.y)) - y };
}
function quad(rect: { x: number; y: number; width: number; height: number }): TextQuad {
  const { x, y, width, height } = rect;
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}
function union(quads: TextQuad[]): TextQuad {
  if (!quads.length) return quad({ x: 0, y: 0, width: 0, height: 0 });
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const shape of quads) for (const point of shape) {
    x = Math.min(x, point.x); y = Math.min(y, point.y);
    right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
  }
  return quad({ x, y, width: right - x, height: bottom - y });
}
export function readingTokens(document: TextDocument): TextToken[] {
  return document.blocks.flatMap(block => block.lines.flatMap(line => line.tokens)).sort((a, b) => a.order - b.order);
}
/** Actual engine glyph boxes are used only when their text matches the word. Never split a box evenly. */
export function textDocument(result: OCRResult, sha256: string, engine: TextDocument['engine']): TextDocument {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw Error('识别原图标识无效');
  const id = `${sha256}:${engine.id}:${engine.version}:${engine.model}:${result.language}`;
  const blocks: TextBlock[] = [], byBlock = new Map<number, TextBlock>(), byLine = new Map<string, TextLine>();
  const tokens: TextToken[] = [];
  let alignment: TextDocument['alignment'] = 'source', cursor = 0;
  const offsets: { start: number; end: number }[] = [];
  result.words.forEach((word, wordIndex) => {
    let block = byBlock.get(word.block ?? 0);
    if (!block) {
      block = { id: `b${blocks.length}`, order: blocks.length, quad: quad(word), lines: [] };
      blocks.push(block);
      byBlock.set(word.block ?? 0, block);
    }
    const key = `${block.id}/l${word.line}`;
    let line = byLine.get(key);
    if (!line) {
      line = { id: key, order: byLine.size, quad: quad(word), tokens: [] };
      block.lines.push(line);
      byLine.set(key, line);
    }
    const glyphs = word.symbols?.length && word.symbols.every(symbol => symbol.text.length && symbol.width > 0 && symbol.height > 0) &&
      word.symbols.map(symbol => symbol.text).join('') === word.text ? word.symbols : undefined;
    const units: (OCRWord | NonNullable<OCRWord['symbols']>[number])[] = glyphs || [word];
    for (const unit of units) {
      if (!unit.text || unit.width <= 0 || unit.height <= 0) continue;
      const token: TextToken = { id: `t${tokens.length}`, wordId: `w${wordIndex}`, lineId: line.id,
        order: tokens.length, text: unit.text, separatorAfter: '', quad: quad(unit),
        geometry: glyphs ? 'character' : 'word', confidence: unit.confidence };
      line.tokens.push(token);
      tokens.push(token);
      const start = result.text.indexOf(unit.text, cursor);
      if (start < 0) { alignment = 'reconstructed'; offsets.push({ start: -1, end: -1 }); }
      else {
        offsets.push({ start, end: start + unit.text.length }); cursor = start + unit.text.length;
        token.sourceStart = start; token.sourceEnd = cursor;
      }
    }
  });
  for (let index = 0; index < tokens.length - 1; index++) {
    const current = offsets[index], next = offsets[index + 1];
    const gap = current.end >= 0 && next.start >= current.end ? result.text.slice(current.end, next.start) : undefined;
    if (gap !== undefined && /^\s*$/.test(gap)) tokens[index].separatorAfter = gap;
    else {
      alignment = 'reconstructed';
      tokens[index].separatorAfter = tokens[index].lineId !== tokens[index + 1].lineId ? '\n' :
        tokens[index].wordId === tokens[index + 1].wordId ? '' : ' ';
    }
  }
  for (const block of blocks) {
    for (const line of block.lines) line.quad = union(line.tokens.map(token => token.quad));
    block.quad = union(block.lines.map(line => line.quad));
  }
  return { schema: 1, id, source: { sha256, width: result.width, height: result.height, transform: [1, 0, 0, 1, 0, 0] },
    engine, language: result.language, text: result.text, alignment, blocks };
}
export function selectedText(tokens: readonly TextToken[], anchor: number, focus: number) {
  const start = Math.max(0, Math.min(anchor, focus)), end = Math.min(tokens.length - 1, Math.max(anchor, focus));
  if (anchor < 0 || focus < 0) return '';
  return tokens.slice(start, end + 1).map((token, index) => token.text + (index < end - start ? token.separatorAfter : '')).join('');
}
export function textGroup(tokens: readonly TextToken[], index: number, kind: 'word' | 'line') {
  const key = kind === 'word' ? 'wordId' : 'lineId';
  if (!tokens[index]) return { anchor: -1, focus: -1 };
  let anchor = index, focus = index;
  while (anchor > 0 && tokens[anchor - 1][key] === tokens[index][key]) anchor--;
  while (focus + 1 < tokens.length && tokens[focus + 1][key] === tokens[index][key]) focus++;
  return { anchor, focus };
}
/** Follow adjacent lines in reading order while keeping the closest image-space column. */
export function textVertical(tokens: readonly TextToken[], index: number, direction: -1 | 1) {
  if (!tokens[index]) return 0;
  const current = textGroup(tokens, index, 'line'), adjacent = direction < 0 ? current.anchor - 1 : current.focus + 1;
  if (!tokens[adjacent]) return index;
  const target = textGroup(tokens, adjacent, 'line'), box = textBounds(tokens[index].quad), x = box.x + box.width / 2;
  let nearest = adjacent, distance = Infinity;
  for (let i = target.anchor; i <= target.focus; i++) {
    const rect = textBounds(tokens[i].quad), difference = Math.abs(rect.x + rect.width / 2 - x);
    if (difference < distance) { distance = difference; nearest = i; }
  }
  return nearest;
}
