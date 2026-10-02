import {esc,icon} from './ui';
import './path-field.css';
/** A single outline around the editable path and its browse action. */
export function pathField(id: string, label: string, action: {id?: string; attributes?: string; label: string; glyph?: string}, placeholder = '选择文件夹或粘贴路径') {
 return `<div class="one-path-field"><span class="one-path-field-icon">${icon('folder')}</span><input id="${esc(id)}" aria-label="${esc(label)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"><button type="button" ${action.id ? `id="${esc(action.id)}"` : ''} ${action.attributes || ''} class="one-path-field-action" aria-label="${esc(action.label)}" title="${esc(action.label)}">${action.glyph ? icon(action.glyph) : '浏览'}</button></div>`;
}
export const initialPickerPath = (value: string) => /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(value.trim()) ? value.trim() : undefined;
