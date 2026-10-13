import type { CaptureTool } from './image-document';
import { annotationCommand, defaultAnnotationStyle, type RecordingAnnotationStyle } from '../recording/recording-annotations';

// Watermarks have their own content/layout preset. Navigation and object erasing have no style.
export const rememberedAnnotationTools = ['rectangle','roundrect','ellipse','triangle','diamond','solid','mosaic','blur','arrow','line','brush','highlight','text','step','erasebrush'] as const;
export type RememberedAnnotationTool = typeof rememberedAnnotationTools[number];
export type AnnotationStyles = Record<RememberedAnnotationTool, RecordingAnnotationStyle>;
export function remembersAnnotationTool(tool: CaptureTool): tool is RememberedAnnotationTool {
  return (rememberedAnnotationTools as readonly string[]).includes(tool);
}
export function annotationStylePreference(tool: unknown, value: unknown) {
  if (typeof tool !== 'string' || !remembersAnnotationTool(tool as CaptureTool)) throw Error('标注偏好工具无效');
  const command = annotationCommand({kind:'style',style:value});
  if (command.kind !== 'style') throw Error('标注偏好样式无效');
  return {tool:tool as RememberedAnnotationTool,style:command.style};
}
export function annotationStylesFrom(value?: unknown): AnnotationStyles {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw Error('标注偏好格式无效');
  const source = (value || {}) as Partial<AnnotationStyles>;
  if (Object.keys(source).some(key=>!(rememberedAnnotationTools as readonly string[]).includes(key))) throw Error('标注偏好工具无效');
  return Object.fromEntries(rememberedAnnotationTools.map(tool=>[tool,annotationStylePreference(tool,source[tool] ?? defaultAnnotationStyle()).style])) as AnnotationStyles;
}
export interface AnnotationPreferencesHost {
  annotationStyles?(): AnnotationStyles;
  saveAnnotationStyle?(tool: CaptureTool, style: RecordingAnnotationStyle): Promise<void>;
}
