import {validateMenu,type SearchMenuItem} from './search';
export type MenuDropPosition='before'|'inside'|'after';
/** Move one branch without changing its descendants or other sibling ordering. */
export function moveMenuItem(items:SearchMenuItem[],sourceId:string,targetId:string,position:MenuDropPosition):SearchMenuItem[] {
 const source=items.find(item=>item.id===sourceId),target=items.find(item=>item.id===targetId);
 if(!source||!target||source===target||position==='inside'&&target.kind!=='group')return items;
 let ancestor:SearchMenuItem|undefined=target;while(ancestor){if(ancestor.id===sourceId)return items;ancestor=items.find(item=>item.id===ancestor!.parent);}
 const next=items.filter(item=>item.id!==sourceId).map(item=>({...item})),moved={...source,parent:position==='inside'?targetId:target.parent};
 let index=next.findIndex(item=>item.id===targetId)+(position==='before'?0:1);
 if(position==='inside'){const children=next.filter(item=>item.parent===targetId);if(children.length)index=next.findIndex(item=>item.id===children.at(-1)!.id)+1;}
 next.splice(index,0,moved);return validateMenu(next);
}
