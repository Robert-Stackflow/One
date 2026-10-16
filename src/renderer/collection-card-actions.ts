import {Copy,Download,Trash2} from 'lucide';
import {esc,icon,registerIcons} from './ui';
import './collection-card-actions.css';
registerIcons({'collection-copy':Copy,'collection-export':Download,'collection-remove':Trash2});
type Action={attributes:Record<string,string>;label?:string;disabled?:boolean};
function button(kind:'copy'|'export'|'remove',action:Action){
  const label=action.label||({copy:'复制原内容',export:'保存原内容',remove:'删除'}[kind]);
  return `<button type="button" class="quiet icon-button collection-card-${kind}" ${Object.entries(action.attributes).map(([name,value])=>`${name}="${esc(value)}"`).join(' ')} title="${esc(label)}" aria-label="${esc(label)}" ${action.disabled?'disabled':''}>${icon('lucide:collection-'+kind)}</button>`;
}
/** Shared order and geometry; page-specific actions occupy only the extra slot. */
export function collectionCardActions(value:{copy?:Action;save?:Action;remove:Action;extra?:string;className:string}){
  return `<div class="collection-card-actions ${value.className}">${value.copy?button('copy',value.copy):''}${value.save?button('export',value.save):''}${value.extra?`<div class="collection-card-extras">${value.extra}</div>`:''}${button('remove',value.remove)}</div>`;
}
