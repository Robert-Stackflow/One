import './annotation-brush-cursor.css';
import type { Point } from '../../shared/capture/image-document';

/** Visible brush footprint uses source pixels in both capture and image editing. */
export function annotationBrushCursor(parent: HTMLElement, existing?: HTMLElement) {
  const root = existing || document.createElement('div');
  root.classList.add('annotation-brush-cursor');
  root.hidden = true;
  if (!existing) parent.append(root);
  return {
    refresh(point: Point | null | undefined, diameter: number, scale: number, visible: boolean) {
      root.hidden = !point || !visible;
      if (!point || !visible) return;
      const size = diameter * scale;
      Object.assign(root.style, {
        left: point.x - size / 2 + 'px',
        top: point.y - size / 2 + 'px',
        width: size + 'px',
        height: size + 'px',
      });
    },
    hide() {
      root.hidden = true;
    },
  };
}
