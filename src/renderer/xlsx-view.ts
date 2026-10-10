import {XlsxViewer, XlsxWorkbook} from '@silurus/ooxml/xlsx';
import type {SetOutline} from './preview-outline';
import './xlsx-view.css';

type Viewer = ReturnType<typeof XlsxViewer.fromWorkbook>;
interface Session {
  closed: boolean;
  controller: AbortController;
  workbook?: XlsxWorkbook;
  viewer?: Viewer;
}

/** The library owns the grid. One owns file lifetime, navigation and error UI. */
export function renderXlsx(
  host: HTMLElement,
  url: string,
  metadata: (value: Record<string, string>) => void,
  outline: SetOutline,
  openDefault: () => void,
) {
  const stage = document.createElement('div');
  stage.className = 'xlsx-preview';
  host.append(stage);
  let disposed = false;
  let current: Session | undefined;

  const close = (session?: Session) => {
    if (!session || session.closed) return;
    session.closed = true;
    session.controller.abort();
    session.viewer?.destroy();
    // fromWorkbook borrows the engine; the caller must release it separately.
    session.workbook?.destroy();
  };
  const panel = (message: string, state: string, retry = false) => {
    stage.replaceChildren();
    stage.dataset.state = state;
    const content = document.createElement('div');
    content.className = 'xlsx-preview-status';
    content.setAttribute('role', state === 'loading' ? 'status' : 'alert');
    const label = document.createElement('p');
    label.textContent = message;
    content.append(label);
    const actions = document.createElement('div');
    actions.className = 'xlsx-preview-actions';
    const button = (text: string, callback: () => void) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = text;
      item.onclick = callback;
      actions.append(item);
    };
    if (retry) button('重试', start);
    if (state === 'loading') button('取消加载', () => {
      close(current);
      outline([]);
      panel('已取消加载', 'cancelled', true);
    });
    button('用默认程序打开', openDefault);
    content.append(actions);
    stage.append(content);
  };
  const fail = (session: Session, error: unknown) => {
    if (disposed || current !== session || session.closed) return;
    close(session);
    outline([]);
    const message = error instanceof Error ? error.message : '';
    panel(/limit|exceed|too large|过大|上限/i.test(message)
      ? '工作簿内容超过预览上限，请用默认程序打开'
      : '工作簿无法读取，请重试或用默认程序打开', 'error', true);
  };
  function start() {
    if (disposed) return;
    close(current);
    const session: Session = {closed: false, controller: new AbortController()};
    current = session;
    outline([]);
    panel('正在加载工作簿…', 'loading');
    void (async () => {
      const response = await fetch(url, {signal: session.controller.signal});
      if (!response.ok) throw new Error('工作簿读取失败');
      const bytes = await response.arrayBuffer();
      if (session.closed) return;
      const workbook = await XlsxWorkbook.load(bytes, {
        useGoogleFonts: false,
        cjkFallback: 'sc',
        mode: 'main',
        workerTimeoutMs: 15000,
        resourceLimits: {
          maxArchiveEntries: 20000,
          maxArchiveEntryBytes: 32 * 1024 * 1024,
          maxTotalInflatedBytes: 128 * 1024 * 1024,
        },
      });
      if (session.closed || disposed) { workbook.destroy(); return; }
      session.workbook = workbook;
      const visible = workbook.sheetNames.flatMap((label, index) => workbook.isHidden(index) ? [] : [{label, index}]);
      if (!visible.length) throw new Error('工作簿没有可见的工作表');
      // A fulfilled load may contain parser diagnostic pages. Check the model,
      // rather than treating Promise completion or sheetCount as success.
      const first = await workbook.getWorksheet(visible[0].index);
      if (session.closed) return;
      if (first.parseError) throw new Error(first.parseError);
      const surface = document.createElement('div');
      surface.className = 'xlsx-preview-surface';
      stage.replaceChildren(surface);
      session.viewer = XlsxViewer.fromWorkbook(surface, workbook, {
        hiddenSheetMode: 'skip',
        enableHyperlinks: false,
        resizable: false,
        onReady: () => {
          if (session.closed || disposed) return;
          stage.dataset.state = 'ready';
          metadata({'工作表': String(visible.length)});
          outline(visible.map(({label, index}) => ({label, icon: 'file', activate: () => {
            if (!session.closed && !workbook.isHidden(index)) {
              void session.viewer?.goToSheet(index).catch(error => fail(session, error));
            }
          }})));
        },
        onSheetChange: index => {
          if (session.closed) return;
          void workbook.getWorksheet(index).then(sheet => {
            if (sheet.parseError) fail(session, new Error(sheet.parseError));
          }).catch(error => fail(session, error));
        },
        onError: error => fail(session, error),
      });
    })().catch(error => fail(session, error));
  }
  start();
  return () => {
    disposed = true;
    close(current);
    stage.remove();
  };
}
