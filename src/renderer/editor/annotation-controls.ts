import { setSelectLoader,selectSource } from '../controls';
import type { Annotation, CaptureTool } from '../../shared/capture/image-document';
import type { WatermarkStyle } from '../../shared/capture/watermark';

export { imageAnnotationIds } from './annotation-config';
import { annotationFields } from './annotation-config';

export function readAnnotationStyle(
  root: ParentNode,
  tool: CaptureTool,
  ids: Record<string, string> = {},
  watermark?: WatermarkStyle,
) {
  const value = (name: string) =>
    root.querySelector<HTMLInputElement | HTMLSelectElement>('#' + (ids[name] || name))!.value;
  const brush = ['mosaic', 'blur'].includes(tool) && value('mark-mode') === 'brush';
  return {
    color: value('mark-color'),
    width: Number(value(tool === 'erasebrush' || brush ? 'mark-size' : 'mark-width')),
    brush,
    strength: Number(value('mark-strength')),
    strokeStyle: value('mark-stroke') as Annotation['strokeStyle'],
    fontSize: Number(value('mark-font')),
    fontFamily: value('mark-family'),
    fontWeight: Number(value('mark-weight')),
    italic: !!root.querySelector<HTMLInputElement>('#' + (ids['mark-italic'] || 'mark-italic'))
      ?.checked,
    textOutline: !!root.querySelector<HTMLInputElement>(
      '#' + (ids['mark-outline'] || 'mark-outline'),
    )?.checked,
    filled: root.querySelector<HTMLInputElement>('#' + (ids['mark-filled'] || 'mark-filled'))!
      .checked,
    text: value('watermark-text'),
    ...(tool === 'watermark' ? { watermark } : {}),
  };
}
const styleFields = [
  ['mark-color', 'color'],
  ['mark-width', 'width'],
  ['mark-stroke', 'strokeStyle'],
  ['mark-strength', 'strength'],
  ['mark-font', 'fontSize'],
  ['mark-filled', 'filled'],
  ['mark-size', 'width'],
  ['mark-family', 'fontFamily'],
  ['mark-weight', 'fontWeight'],
  ['mark-italic', 'italic'],
  ['mark-outline', 'textOutline'],
] as const;
export function bindAnnotationStyle(
  root: ParentNode,
  ids: Record<string, string>,
  host: {
    locked(): boolean;
    update(style: Partial<Annotation>, preview: boolean): void;
  },
) {
  for (const [name, property] of styleFields) {
    const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(
      '#' + (ids[name] || name),
    )!;
    if (!input) continue;
    for (const event of ['input', 'change'])
      input.addEventListener(event, () => {
        if (host.locked() || !input.checkValidity()) return;
        const value = ['color', 'fontFamily', 'strokeStyle'].includes(property)
          ? input.value
          : ['filled', 'italic', 'textOutline'].includes(property)
            ? (input as HTMLInputElement).checked
            : Number(input.value);
        host.update({ [property]: value }, event === 'input');
      });
  }
}
export function fillAnnotationStyle(
  root: ParentNode,
  mark: Pick<Annotation,'tool'|'color'|'width'> & Partial<Annotation>,
  ids: Record<string, string> = {},
) {
  for (const [name, property] of styleFields) {
    const control = root.querySelector<HTMLInputElement | HTMLSelectElement>(
      '#' + (ids[name] || name),
    )!;
    if (!control) continue;
    const input=selectSource(control)||control;
    const value =
      property === 'fontSize'
        ? mark.fontSize || Math.max(12, mark.width * 6)
        : property === 'fontFamily'
          ? mark.fontFamily || 'Segoe UI'
          : property === 'fontWeight'
            ? mark.fontWeight || 400
            : property === 'strokeStyle'
              ? mark.strokeStyle || 'solid'
              : mark[property];
    if (['filled', 'italic', 'textOutline'].includes(property))
      (input as HTMLInputElement).checked = !!value;
    else {
      if (
        property === 'fontFamily' &&
        input instanceof HTMLSelectElement &&
        ![...input.options].some((option) => option.value === value)
      )
        input.add(new Option(String(value), String(value)));
      input.value = String(value);
    }
  }
  if (mark.tool === 'mosaic' || mark.tool === 'blur')
    root.querySelector<HTMLSelectElement>('#' + (ids['mark-mode'] || 'mark-mode'))!.value =
      mark.brush ? 'brush' : 'rectangle';
}

/** Both layouts expose exactly the same fields for the active annotation. */
export function showAnnotationProperties(
  root: ParentNode,
  tool: CaptureTool,
  brush: boolean,
  image: boolean,
  ids: Record<string, string> = {},
  watermarkContainer?: HTMLElement,
) {
  const fields = annotationFields(tool, brush, image);
  const emphasis = root.querySelector<HTMLElement>('[data-text-emphasis]');
  if (emphasis) emphasis.hidden = !fields.font;
  for (const [name, visible] of Object.entries({
    'mark-color': fields.color,
    'mark-width': fields.width,
    'mark-size': fields.brushSize,
    'mark-strength': fields.redaction,
    'mark-font': fields.font,
    'mark-family': fields.font,
    'mark-weight': fields.font,
    'mark-mode': fields.redaction,
    'mark-filled': fields.fill,
    'mark-stroke': fields.stroke,
  }))
    root
      .querySelector<HTMLElement>('#' + (ids[name] || name))!
      .closest<HTMLElement>('label,.capture-property')!.hidden = !visible;
  for (const name of [
    'watermark-text',
    'watermark-position',
    'watermark-opacity',
    'watermark-angle',
    'watermark-spacing',
  ]) {
    const input = root.querySelector<HTMLInputElement | HTMLSelectElement>('#' + name)!;
    input.closest<HTMLElement>('label')!.hidden =
      !fields.watermark ||
      (name === 'watermark-text' && image) ||
      (name === 'watermark-spacing' &&
        root.querySelector<HTMLSelectElement>('#watermark-position')!.value !== 'tile');
  }
  for (const [name, visible] of Object.entries({
    'watermark-image-controls': fields.watermark,
    'watermark-date': fields.watermark && !image,
    'mosaic-controls': fields.mosaic,
    'sensitive-controls': fields.mosaic,
  }))
    root.querySelector<HTMLElement>('#' + name)!.hidden = !visible;
  if (watermarkContainer) watermarkContainer.hidden = !fields.watermark;
  return fields;
}

/** Load the same local font list when either font menu is opened. */
export function bindAnnotationFonts(
  root: ParentNode,
  load: () => Promise<{ family: string; label: string }[]>,
  ids: Record<string, string> = {},
) {
  const control = root.querySelector<HTMLElement>(
    '#' + (ids['mark-family'] || 'mark-family'),
  )!;
  const select=selectSource(control)!;
  setSelectLoader(select, async () => {
    const fonts=await load(),options=[...select.options].map(option=>({label:option.label,value:option.value}));
    for(const font of fonts)if(!options.some(option=>option.value===font.family))options.push({label:font.label,value:font.family});
    return options;
  });
}
