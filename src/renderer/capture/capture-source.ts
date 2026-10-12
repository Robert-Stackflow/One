import type { CaptureData } from '../../shared/capture/capture-session';
import { imageDimensions } from '../../shared/capture/image-limits';
import { captureWindowLayout } from '../../shared/capture/capture-window-layout';
import { captureLayerLayout } from '../../shared/capture/capture-layout';
/** Build the same ordered, transparent source used by preview, annotations and output. */
export async function captureSource(
  data: Pick<CaptureData, 'image' | 'width' | 'height' | 'layers' | 'composition'>,
) {
  imageDimensions(data.width, data.height);
  const load = async (url: string, width: number, height: number) => {
    const image = new Image();
    image.crossOrigin='anonymous';
    image.src = url;
    await image.decode();
    if (image.naturalWidth !== width || image.naturalHeight !== height)
      throw Error('截图像素尺寸不符');
    return image;
  };
  if (!data.layers) return load(data.image, data.width, data.height);
  const layout =
    data.composition === 'desktop'
      ? captureLayerLayout(data.layers)
      : captureWindowLayout(data.layers);
  if (
    layout.x !== 0 ||
    layout.y !== 0 ||
    layout.width !== data.width ||
    layout.height !== data.height
  )
    throw Error('窗口组合尺寸不符');
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  try {
    const ctx = canvas.getContext('2d')!;
    for (const layer of data.layers) {
      const image = await load(layer.image, layer.width, layer.height);
      ctx.drawImage(image, layer.x, layer.y);
      image.src = '';
    }
    // Keep decoded pixels as the shared drawing source. PNG encoding and a
    // second image decode were only needed to satisfy an overly narrow type;
    // canvas.toBlob may also wait for idle rendering in a hidden window.
    return canvas;
  } catch (error) {
    canvas.width = canvas.height = 0;
    throw error;
  }
}
