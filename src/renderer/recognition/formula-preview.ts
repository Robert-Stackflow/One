import { renderFormulaPreview } from '../../shared/recognition/formula-preview';
self.onmessage = (event: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = event.data;
  try {
    const html = renderFormulaPreview(text);
    self.postMessage({ id, html, error: '' });
  } catch (error) {
    self.postMessage({
      id,
      html: '',
      error:
        error instanceof Error ? error.message.slice(0, 200) : '公式语法无效，请检查括号和命令',
    });
  }
};
