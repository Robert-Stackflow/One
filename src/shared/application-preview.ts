export type PreviewFact={label:string;value:string};
export interface ApplicationPreview{
  kind:'pe'|'package';
  title:string;
  sections:{title:string;facts:PreviewFact[]}[];
  dependencies?:string[];
  exports?:string[];
  packages?:{name:string;architecture:string;version:string;size:string}[];
}
export interface RichTextRun{text:string;bold?:boolean;italic?:boolean;underline?:boolean;strike?:boolean;fontSize?:number}
export interface RichTextParagraph{align:'left'|'center'|'right'|'justify';runs:RichTextRun[]}
export interface RichTextPreview{paragraphs:RichTextParagraph[]}
export const pePreviewExtensions=/^(exe|dll|ocx|cpl|scr|sys|drv|mui|com)$/i;
export const packagePreviewExtensions=/^(msix|msixbundle|appx|appxbundle)$/i;
export const applicationPreviewExtension=(extension:string)=>pePreviewExtensions.test(extension)||packagePreviewExtensions.test(extension);
