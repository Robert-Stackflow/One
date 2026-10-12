import type { CaptureTool } from '../../shared/capture/image-document';
export const imageAnnotationIds: Record<string, string> = {
  'mark-color': 'color',
  'mark-palette': 'editor-palette',
  'mark-width': 'width',
  'mark-size': 'brush-size',
  'mark-strength': 'strength',
  'mark-font': 'text-size',
  'mark-family': 'font-family',
  'mark-weight': 'font-weight',
  'mark-italic': 'text-italic',
  'mark-outline': 'text-outline',
  'mark-mode': 'redaction-mode',
  'mark-filled': 'shape-filled',
  'mark-stroke': 'stroke-style',
};
export const annotationRanges = {
  'mark-width': { min: 1, max: 80, unit: 'px', presets: [1, 3, 6, 10], dots: true },
  'mark-size': { min: 6, max: 80, unit: 'px', presets: [8, 16, 32, 64], dots: true },
  'mark-strength': { min: 1, max: 64, unit: '', presets: [4, 12, 24] },
  'watermark-opacity': { min: 0, max: 100, unit: '%', presets: [10, 25, 50] },
  'watermark-angle': { min: -180, max: 180, unit: '°', presets: [-45, 0, 45] },
  'watermark-spacing': { min: 8, max: 600, unit: 'px', presets: [24, 60, 120] },
};

/** Tool capabilities drive both property surfaces; layout is owned by each host. */
export function annotationFields(tool: CaptureTool, brush: boolean, image: boolean) {
  const redaction = tool === 'mosaic' || tool === 'blur',
    brushSize = tool === 'erasebrush' || (redaction && brush),
    font = (tool === 'text' || tool === 'watermark') && !image;
  return {
    redaction,
    brushSize,
    font,
    color:
      !image &&
      !redaction &&
      !['select', 'move', 'erase', 'erasebrush', 'spotlight'].includes(tool),
    width:
      !brushSize &&
      !redaction &&
      !['select', 'move', 'text', 'watermark', 'erase', 'spotlight'].includes(tool),
    fill: ['rectangle', 'roundrect', 'ellipse', 'triangle', 'diamond'].includes(tool),
    stroke: ['line', 'arrow', 'brush', 'highlight'].includes(tool),
    watermark: tool === 'watermark',
    mosaic: tool === 'mosaic',
  };
}
