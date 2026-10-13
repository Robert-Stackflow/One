import { q } from './ui';
import { windowControls, setupChrome } from './chrome';
import { mountFormula } from './recognition/formula-ui';
import { customControls } from './controls';
import { applyCaptureScale } from './capture/appearance';
import type { OCRState } from '../shared/recognition/ocr';
import './recognition/formula-window.css';
import './recognition/workbench.css';
import { mountTextSelection } from './recognition/text-selection';
import { recognitionNotice } from './recognition/notice';
export async function renderFormulaRecognition() {
  document.body.dataset.view = 'formula-recognition';
  q('app').innerHTML = `<header class="media-header"><strong>公式识别</strong><span id="source-name"></span>${windowControls()}</header><main class="formula-workbench">
    <div id="formula-tools" class="formula-commandbar"><button id="formula-recognize" class="primary" disabled>识别公式（发送图片）</button><button id="formula-configure" class="quiet">视觉服务</button><div id="formula-image-tools" class="image-header-tools"></div></div>
    <p id="formula-destination" hidden></p><div class="formula-workspace"><section class="formula-source"><img id="source" alt="公式原图"><div id="image-loading" class="image-loading" role="status" aria-live="polite" hidden><div class="image-loading-card"><span class="recognition-spinner" aria-hidden="true"></span><span>识别中</span><button id="overlay-cancel" class="quiet">取消</button></div></div></section><section id="formula-panel"><label for="formula-text">LaTeX</label><textarea id="formula-text" spellcheck="false" placeholder="输入 LaTeX"></textarea><p id="formula-preview-status" role="status"></p><div id="formula-preview"></div></section></div>
    <footer><span id="message" role="status" hidden></span><button id="formula-copy" class="primary" disabled>复制 LaTeX</button></footer></main><dialog id="formula-settings" class="one-dialog one-form-dialog"></dialog>`;
  setupChrome(); let state: OCRState | undefined, disposed = false;
  const message = recognitionNotice(q('message'));
  const canvas = mountTextSelection(q<HTMLImageElement>('source'), { copy: async () => {}, translate: () => {}, message });
  q('formula-image-tools').append(document.querySelector('.text-image-tools')!);
  const formula = mountFormula(window.one.formulaRecognition!, () => state, message, () => {}); formula.setMode(true);
  async function refresh() { try { const next = await window.one.formulaRecognition!.state(); if (disposed) return; state = next; applyCaptureScale(q('app'), state.uiScale); formula.render(); } catch (error) { if (!disposed) message(error); } }
  await refresh(); if (state) { q('source-name').textContent = state.name; q<HTMLImageElement>('source').src = state.image; }
  customControls(document.body); const timer = setInterval(() => void refresh(), 500);
  window.addEventListener('beforeunload', () => { disposed = true; canvas.dispose(); clearInterval(timer); }, { once: true });
}
