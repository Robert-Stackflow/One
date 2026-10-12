import type { BrowserWindow } from 'electron';
import type { OCRService } from './service';
import type { TranslationLanguage } from '../../shared/recognition/translation';

/** Keep the screen overlay from covering the recognition window; failed/canceled work can return intact. */
export async function captureTranslation(
  parent: BrowserWindow,
  service: OCRService,
  owner: string,
  png: Buffer,
  target: TranslationLanguage,
) {
  service.checkWorkflow(png);
  parent.hide();
  let completed = false;
  try {
    completed = await service.workflow.run(owner, png, target);
    return completed;
  } finally {
    const recognition = service.window;
    const restore = () => {
      recognition?.removeListener('hide', restore);
      recognition?.removeListener('closed', restore);
      parent.removeListener('closed', abandon);
      if (service.workflow.state) service.workflow.state.returnToCapture = false;
      if (!parent.isDestroyed()) parent.show();
    };
    const abandon = () => {
      recognition?.removeListener('hide', restore);
      recognition?.removeListener('closed', restore);
      if (service.workflow.state) service.workflow.state.returnToCapture = false;
    };
    if (completed || !recognition || recognition.isDestroyed()) restore();
    else if (!parent.isDestroyed()) {
      if (service.workflow.state) service.workflow.state.returnToCapture = true;
      recognition.once('hide', restore);
      recognition.once('closed', restore);
      parent.once('closed', abandon);
    }
  }
}
