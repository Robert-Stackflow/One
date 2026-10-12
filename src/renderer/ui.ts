import {transientNotice,feedbackMessage} from './feedback';
export const api = window.one;
export const q = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (text: unknown) => String(text).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
import {icon} from './icons';
export {icon,registerIcons} from './icons';
export const button = (id: string, text: string, glyph = '', primary = false) => `<button id="${id}"${primary ? ' class="primary"' : ''}>${glyph ? icon(glyph) : ''}${text}</button>`;
export const iconButton = (id: string, label: string, glyph: string) => `<button id="${id}" class="icon-button quiet" aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
export const switchControl = (id: string, name: string) => `<label class="switch"><input type="checkbox" role="switch" id="${id}" aria-label="${name}"><span class="switch-track"></span></label>`;
export const size = (n: number) => { if (n < 1024) return `${n} B`; const power = Math.min(4,Math.floor(Math.log(n)/Math.log(1024))); return `${(n/1024**power).toFixed(power > 1 ? 2 : 1)} ${['B','KB','MB','GB','TB'][power]}`; };
const notices=new WeakMap<HTMLElement,ReturnType<typeof transientNotice>>();
export const errorMessage=feedbackMessage;
export function toast(message: unknown) { let node = q('toast'); const dialog=document.querySelector<HTMLDialogElement>('dialog[open]');if(dialog){node=dialog.querySelector<HTMLElement>('.dialog-error')!;if(!node){node=document.createElement('p');node.className='dialog-error';node.setAttribute('role','alert');(dialog.querySelector('.one-dialog-body')||dialog).append(node);}} if (!node) return;let notice=notices.get(node);if(!notice){notice=transientNotice(node,5000);notices.set(node,notice);}notice(message); }
export function action(id: string, work: () => unknown | Promise<unknown>) { q(id).addEventListener('click',() => Promise.resolve().then(work).catch(toast)); }
