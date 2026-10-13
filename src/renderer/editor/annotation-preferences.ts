import { annotationStylesFrom, remembersAnnotationTool, type AnnotationStyles } from '../../shared/capture/annotation-preferences';
import type { CaptureTool } from '../../shared/capture/image-document';
import type { RecordingAnnotationStyle } from '../../shared/recording/recording-annotations';
import { fillAnnotationStyle, readAnnotationStyle } from './annotation-controls';

export function annotationPreferences(
  root: ParentNode,
  ids: Record<string,string>,
  save: (tool: CaptureTool, style: RecordingAnnotationStyle) => Promise<unknown>,
  failed: (error: unknown) => void,
) {
  let styles: AnnotationStyles = annotationStylesFrom();
  const input = (name:string) => root.querySelector<HTMLInputElement>('#'+(ids[name]||name))!;
  return {
    load(value?: AnnotationStyles) { styles = annotationStylesFrom(value); },
    restore(tool: CaptureTool) {
      if (!remembersAnnotationTool(tool)) return;
      const style = styles[tool];
      fillAnnotationStyle(root,{...style,tool},ids);
      input('mark-size').value = String(style.brushSize ?? 24);
    },
    remember(tool: CaptureTool) {
      if (!remembersAnnotationTool(tool)) return;
      const style = {
        ...readAnnotationStyle(root,tool,ids),
        width:Number(input('mark-width').value),
        brushSize:Number(input('mark-size').value),
      };
      // Do not persist text, watermark content or the selected object itself.
      const next = annotationStylesFrom({...styles,[tool]:style});
      if (JSON.stringify(next[tool]) === JSON.stringify(styles[tool])) return;
      styles = next;
      void save(tool,styles[tool]).catch(failed);
    },
  };
}
