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
import { recognitionReady, prepareRecognitionImage } from './recognition/ready';
import { needsImagePreview } from '../shared/recognition/image-preview';
export async function renderFormulaRecognition() {
  document.body.dataset.view = 'formula-recognition';
  q('app').innerHTML = `<header class="media-header"><strong>公式识别</strong><span id="source-name"></span>${windowControls()}</header><main class="formula-workbench">
    <div id="formula-tools" class="formula-commandbar"><select id="formula-source" aria-label="公式识别来源"><option value="service">公式服务</option><option value="local">本地模型</option></select><button id="formula-recognize" class="primary" disabled>识别公式（发送图片）</button><button id="formula-model-configure" class="quiet">公式模型</button><button id="formula-configure" class="quiet">公式服务</button><button id="formula-image-reset" class="quiet" hidden>恢复原图</button><div id="formula-image-tools" class="image-header-tools"></div></div>
    <p id="formula-destination" hidden></p><div class="formula-workspace"><section class="formula-source"><img id="source" alt="公式原图"><div id="image-loading" class="image-loading" role="status" aria-live="polite" hidden><div class="image-loading-card"><span class="recognition-spinner" aria-hidden="true"></span><span id="formula-loading-label">识别中</span><button id="overlay-cancel" class="quiet">取消</button></div></div></section><section id="formula-panel"><label for="formula-text">LaTeX <small id="formula-confidence" hidden></small></label><textarea id="formula-text" spellcheck="false" placeholder="输入 LaTeX"></textarea><p id="formula-preview-status" role="status"></p><div id="formula-preview"></div></section></div>
    <footer><span id="message" role="status" hidden></span><button id="formula-copy" class="quiet" disabled>复制 LaTeX</button><button id="formula-copy-image" class="quiet" disabled>复制图片</button><button id="formula-export" class="primary" aria-haspopup="menu" aria-expanded="false" disabled>导出</button></footer></main><dialog id="formula-settings" class="one-dialog one-form-dialog"></dialog>`;
  setupChrome(); let state: OCRState | undefined, disposed = false,imageToken="",refreshSerial=0;
  const message = recognitionNotice(q('message'));
  const canvas = mountTextSelection(q<HTMLImageElement>('source'), { copy: async () => {}, translate: () => {},region:region=>void formula.crop({region,rotation:canvas.viewState().rotation}), message });
  q('formula-image-tools').append(document.querySelector('.text-image-tools')!);
  const loadImage=prepareRecognitionImage(q<HTMLImageElement>('source'),message);
  const formula = mountFormula(window.one.formulaRecognition!, () => state, message, () => refresh(),{rotation:()=>canvas.viewState().rotation,busy:value=>canvas.setEnabled(!value)}); formula.setMode(true);
  async function refresh() { const serial=++refreshSerial;try { const next = await window.one.formulaRecognition!.state(); if (disposed||serial!==refreshSerial) return; state = next; applyCaptureScale(q('app'), state.uiScale);if(imageToken!==state.token){imageToken=state.token;const value=state;q('source-name').textContent=value.name;canvas.setImageSize(value);loadImage(needsImagePreview(value)?canvas.setImagePreview(value,region=>window.one.formulaRecognition!.imagePreview(value.token,region)):value.image);}formula.render(); } catch (error) { if (!disposed) message(error); } }
  void refresh();
  customControls(document.body); const timer = setInterval(() => void refresh(), 500);
  window.addEventListener('beforeunload', () => { disposed = true; canvas.dispose(); clearInterval(timer); }, { once: true });
  await recognitionReady(()=>window.one.formulaRecognition!.ready());
}
