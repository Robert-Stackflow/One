import katex from 'katex';
import { formulaText, FORMULA_PREVIEW } from './formula';
export function renderFormulaPreview(text: string) {
  let blocked = false;
  const html = katex.renderToString(formulaText(text), {
    displayMode: true,
    output: 'htmlAndMathml',
    throwOnError: true,
    trust: () => {
      blocked = true;
      return false;
    },
    strict: 'error',
    maxSize: 10,
    maxExpand: 500,
    macros: {},
    globalGroup: false,
  });
  if (blocked) throw Error('预览不支持链接、图片或 HTML 扩展命令');
  if (html.length > FORMULA_PREVIEW) throw Error('公式预览过大，请分段处理');
  return html;
}
