import { matchContent } from '../../shared/capture/content-matching';
const worker = self as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(value: unknown): void;
};
worker.onmessage = ({ data }) => {
  try {
    worker.postMessage({
      matches: matchContent(
        new Uint8ClampedArray(data.pixels),
        data.width,
        data.height,
        data.template,
      ),
    });
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : '匹配失败' });
  }
};
