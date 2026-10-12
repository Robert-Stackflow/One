import './image-watermark-controls.css';
import { watermarkImage, type WatermarkImage } from '../../shared/capture/watermark';
import { customControls } from '../controls';

interface Host {
  locked(): boolean;
  choose(): Promise<WatermarkImage | null>;
  pending(value: boolean): void;
  change(image: WatermarkImage | undefined, preview: boolean): void;
  refresh(): void;
  error(error: unknown): void;
}
export function imageWatermarkControls(root: HTMLElement, host: Host) {
  root.classList.add('watermark-image-controls');
  root.innerHTML = `<label>内容<select id="watermark-type" aria-label="水印内容"><option value="text">文字</option><option value="image">图片</option></select></label>
  <button id="watermark-image-choose" type="button" class="quiet">导入图片</button>
  <label id="watermark-image-scale-field" hidden>大小<input id="watermark-image-scale" aria-label="图片水印大小" type="range" min="10" max="800" value="100" /></label>
  <span id="watermark-image-info" class="help" hidden></span>`;
  const type = root.querySelector<HTMLSelectElement>('select')!,
    button = root.querySelector<HTMLButtonElement>('button')!,
    scale = root.querySelector<HTMLInputElement>('input')!,
    info = root.querySelector<HTMLElement>('#watermark-image-info')!,
    scaleField = scale.parentElement!;
  let image: WatermarkImage | undefined,
    lastImage: WatermarkImage | undefined,
    pending = false;
  const refresh = () => {
    type.value = image ? 'image' : 'text';
    type.disabled = button.disabled = scale.disabled = pending || host.locked();
    scaleField.hidden = info.hidden = !image;
    button.hidden = !image;
    button.textContent = image ? '替换图片' : '导入图片';
    if (image) {
      scale.value = String(Math.round(image.scale * 100));
      info.textContent = `${image.width} × ${image.height} · ${Math.round(image.scale * 100)}%`;
    }
  };
  const apply = (value: WatermarkImage | undefined, preview = false) => {
    image = value;
    if (value) lastImage = value;
    host.change(value, preview);
    refresh();
    host.refresh();
  };
  const choose = async () => {
    if (pending || host.locked()) return;
    pending = true;
    host.pending(true);
    refresh();
    let value: WatermarkImage | null | undefined;
    try {
      value = await host.choose();
      if (value) value = watermarkImage(value);
    } catch (error) {
      host.error(error);
    } finally {
      pending = false;
      host.pending(false);
    }
    if (value) apply(value);
    else {
      refresh();
      host.refresh();
    }
  };
  button.onclick = () => {
    void choose();
  };
  type.onchange = () => {
    if (pending || host.locked()) {
      refresh();
      return;
    }
    if (type.value === 'image') {
      if (lastImage) apply(lastImage);
      else void choose();
    } else apply(undefined);
  };
  for (const event of ['input', 'change'])
    scale.addEventListener(event, () => {
      if (!image || pending || host.locked()) return;
      try {
        apply(watermarkImage({ ...image, scale: Number(scale.value) / 100 }), event === 'input');
      } catch (error) {
        host.error(error);
        refresh();
      }
    });
  customControls(root);
  refresh();
  return {
    get image() {
      return image;
    },
    fill(value?: WatermarkImage) {
      image = value;
      if (value) lastImage = value;
      refresh();
    },
    refresh,
  };
}
