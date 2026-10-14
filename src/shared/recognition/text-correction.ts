import { OCR_TEXT, type OCRResult } from './ocr';
import { readingTokens, selectedText, textBounds, textGroup, type TextQuad } from './text-document';
import { validateOCRSelection } from './text-region';

/** A correction retains the source word's coverage. It never invents character boxes for new text. */
export function correctOCRWord(base: OCRResult, selected: unknown, value: unknown): OCRResult {
  const {document,tokens,selection}=validateOCRSelection(base,selected);
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/.test(value))
    throw Error('校正文字须为 1 至 2,048 个字符，不能包含换行');
  const first = Math.min(selection.anchor, selection.focus), last = Math.max(selection.anchor, selection.focus);
  const range = textGroup(tokens, first, 'word');
  if (last > range.focus) throw Error('请只选择一个词进行校正');
  if ((document.corrections?.length || 0) >= 256) throw Error('校正次数已满，请重新识别全文');
  const before = selectedText(tokens, range.anchor, range.focus);
  if (before === value) return base;
  const old = tokens.slice(range.anchor, range.focus + 1), head = old[0], tail = old.at(-1)!;
  if (old.length > 2048) throw Error('原词过长，请重新识别该区域');
  if (head.sourceStart === undefined || tail.sourceEnd === undefined) throw Error('当前文字没有可用的全文位置，请重新识别');
  // Paddle exposes legacy line boxes while the shared document has word/glyph groups.
  // Resolve the containing legacy box by its exact source offset, not by assuming identical group counts.
  let cursor=0,wordIndex=-1,wordStart=0;
  for(let index=0;index<base.words.length;index++){
    const word=base.words[index],start=base.text.indexOf(word.text,cursor);
    if(start<0)throw Error('原文与词列表不一致，请重新识别');
    cursor=start+word.text.length;
    if(head.sourceStart>=start&&tail.sourceEnd<=cursor){wordIndex=index;wordStart=start;break;}
  }
  if(wordIndex<0)throw Error('原文与词列表不一致，请重新识别');
  const text = base.text.slice(0, head.sourceStart) + value + base.text.slice(tail.sourceEnd);
  if (text.length > OCR_TEXT) throw Error('校正后文字过长，原文已保留');
  const revision = (document.revision || 0) + 1;
  const sourceQuads = old.flatMap(token => token.sourceQuads || [token.quad]).map(quad => structuredClone(quad));
  const sourceGeometry = old.flatMap(token => token.sourceGeometry || [token.geometry]);
  const bounds = sourceQuads.map(textBounds), x = Math.min(...bounds.map(box => box.x)), y = Math.min(...bounds.map(box => box.y));
  const right = Math.max(...bounds.map(box => box.x + box.width)), bottom = Math.max(...bounds.map(box => box.y + box.height));
  const quad: TextQuad = [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }];
  const corrected = { ...structuredClone(head), text: value, separatorAfter: tail.separatorAfter, quad,
    geometry: 'word' as const, confidence: undefined, sourceQuads, sourceGeometry, correctionRevision: revision };
  const next = structuredClone(document);
  for (const block of next.blocks) for (const line of block.lines) {
    const index = line.tokens.findIndex(token => token.id === head.id);
    if (index >= 0) line.tokens.splice(index, old.length, corrected);
  }
  // Preserve all block/line geometry and every untouched token. Only offsets and reading order change.
  let offset = head.sourceStart, order = range.anchor;
  for (const token of readingTokens(next).slice(range.anchor)) {
    token.order = order++; token.sourceStart = offset; offset += token.text.length; token.sourceEnd = offset; offset += token.separatorAfter.length;
  }
  next.text = text; next.revision = revision; next.id = next.id.replace(/:r\d+$/, '') + `:r${revision}`;
  const recorded = next.corrections?.some(correction => correction.wordId === head.wordId && correction.tokenIds.includes(head.id));
  next.corrections = [...(next.corrections || []), { revision, wordId: head.wordId, before, after: value, tokenIds: old.map(token => token.id), sourceQuads: recorded ? undefined : sourceQuads }];
  const relativeStart=head.sourceStart-wordStart,relativeEnd=tail.sourceEnd-wordStart;
  const words = base.words.map((word, at) => at === wordIndex ? { ...word, text: word.text.slice(0,relativeStart)+value+word.text.slice(relativeEnd), symbols: undefined, confidence: 0 } : structuredClone(word));
  return { ...base, text, words, confidence: 0, document: next };
}
