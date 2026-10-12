import './annotation-selection.css';
import type {
  Annotation,
  CaptureTool,
  ImageDocument,
  Point,
  SelectionHandle,
} from '../../shared/capture/image-document';
import { magnifierBounds, type MagnifierPart } from '../../shared/capture/magnifier';
import type { AnnotationEditor } from './annotation-editor';

/** One selection frame, eight handles and resize entry point for all annotation tools. */
export class AnnotationSelection {
  constructor(
    readonly root: HTMLElement,
    readonly handles: HTMLElement,
  ) {
    root.classList.add('annotation-selection');
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      const grip = document.createElement('div');
      grip.dataset.annotationMove = edge;
      root.append(grip);
    }
    for (const [handle, x, y] of [
      ['nw', 0, 0],
      ['n', 50, 0],
      ['ne', 100, 0],
      ['e', 100, 50],
      ['se', 100, 100],
      ['s', 50, 100],
      ['sw', 0, 100],
      ['w', 0, 50],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.annotationHandle = handle;
      button.ariaLabel = '调整标注 ' + handle;
      Object.assign(button.style, { left: x + '%', top: y + '%', cursor: handle + '-resize' });
      handles.append(button);
    }
  }
  refresh(
    scene: ImageDocument,
    mark: Annotation | undefined,
    tool: CaptureTool,
    editing: boolean,
    part: MagnifierPart,
    position: (point: Point) => Point,
    scale: number,
  ) {
    const stroke =
      mark &&
      (['brush', 'highlight', 'erasebrush'].includes(mark.tool) ||
        (['mosaic', 'blur'].includes(mark.tool) && mark.brush));
    this.root.hidden = !mark || editing || (!!stroke && tool !== 'move');
    if (!mark) return;
    const global = mark.tool === 'watermark' && mark.watermark?.position !== 'custom';
    this.root.classList.toggle('global-watermark', global);
    const rect = global ? scene.selection! : magnifierBounds(mark, scene, part),
      point = position(rect);
    this.handles.hidden = global;
    Object.assign(this.root.style, {
      left: point.x - 3 + 'px',
      top: point.y - 3 + 'px',
      width: rect.width * scale + 6 + 'px',
      height: rect.height * scale + 6 + 'px',
    });
  }
  begin(event: PointerEvent, point: Point, editor: AnnotationEditor) {
    const target = event.target as Element;
    const handle = target.closest<HTMLElement>('[data-annotation-handle]')?.dataset
      .annotationHandle as SelectionHandle | undefined;
    const moving = !!target.closest('[data-annotation-move]');
    if (!(handle ? editor.resize(handle, point) : moving && editor.moveSelected(point)))
      return false;
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    return true;
  }
}
