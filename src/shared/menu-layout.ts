import {builtinById} from './menu-builtins';
import {moveMenuItem,type MenuDropPosition} from './menu-tree';
import {validateMenu,validateMenuBar,type SearchMenuItem,type MenuBarSettings,type MenuBarSection,type MenuBarPosition} from './search';
export interface MenuLayout {menu:SearchMenuItem[];menuBar:MenuBarSettings}
export const barKeys=(bar:MenuBarSettings)=>[...bar.top.actions,...bar.bottom.actions];
export function barOrder(bar:MenuBarSection){const right=new Set(bar.right);return [...bar.actions.filter(key=>!right.has(key)),...bar.actions.filter(key=>right.has(key))];}
export function barPosition(bar:MenuBarSettings,key:string):MenuBarPosition|undefined{return bar.top.actions.includes(key)?'top':bar.bottom.actions.includes(key)?'bottom':undefined;}
export function removeBarKey(bar:MenuBarSettings,key:string):MenuBarSettings {
 const remove=(section:MenuBarSection)=>({actions:section.actions.filter(action=>action!==key),right:section.right.filter(action=>action!==key)});
 return {top:remove(bar.top),bottom:remove(bar.bottom)};
}
export function barItem(menu:SearchMenuItem[],key:string,id:string):SearchMenuItem|undefined {
 if(key.startsWith('item:'))return menu.find(item=>item.id===key.slice(5));
 const command=builtinById(key==='favorite'?'favorite-current':key.slice(8));
 return command?{id,parent:'',kind:'builtin',target:command.id,label:command.label,icon:command.icon,args:[],cwd:'',enabled:true}:undefined;
}
/** A menu item has one visible home: a row, the top bar, or the bottom bar. */
export function reorderBar(layout:MenuLayout,key:string,position:MenuBarPosition,before?:string,align:'left'|'right'='left'):MenuLayout {
 if(!barPosition(layout.menuBar,key))return layout;
 const destination=layout.menuBar[position];
 if(!destination.actions.includes(key)&&destination.actions.length>=7)throw new Error('每个快捷操作栏最多放置 7 项');
 const menuBar=removeBarKey(layout.menuBar,key),actions=menuBar[position].actions,at=before===key?destination.actions.indexOf(key):before?actions.indexOf(before):-1;
 actions.splice(at<0?actions.length:at,0,key);if(align==='right')menuBar[position].right.push(key);
 return {...layout,menuBar};
}
export function placeInBar(layout:MenuLayout,id:string,position:MenuBarPosition,before?:string,align:'left'|'right'='left'):MenuLayout {
 const item=layout.menu.find(item=>item.id===id),key='item:'+id;if(!item)return layout;
 if(barPosition(layout.menuBar,key))return reorderBar(layout,key,position,before,align);
 if(layout.menuBar[position].actions.length>=7)throw new Error('每个快捷操作栏最多放置 7 项');
 const menu=validateMenu(layout.menu.map(item=>item.id===id?{...item,parent:''}:item)),menuBar=structuredClone(layout.menuBar),actions=menuBar[position].actions,at=before?actions.indexOf(before):-1;
 actions.splice(at<0?actions.length:at,0,key);if(align==='right')menuBar[position].right.push(key);
 return {menu,menuBar:validateMenuBar(menuBar,menu)};
}
export function materializeBar(layout:MenuLayout,key:string,id:string):MenuLayout {
 const position=barPosition(layout.menuBar,key);if(!position)return layout;
 const item=barItem(layout.menu,key,id);if(!item||key.startsWith('item:'))return layout;
 if(layout.menu.length>=200)throw new Error('菜单最多包含 200 项');
 const section=layout.menuBar[position];
 return {menu:validateMenu([...layout.menu,item]),menuBar:{...layout.menuBar,[position]:{actions:section.actions.map(action=>action===key?'item:'+id:action),right:section.right.map(action=>action===key?'item:'+id:action)}}};
}
export function placeInMenu(layout:MenuLayout,key:string,id:string,target?:string,position:MenuDropPosition='after'):MenuLayout {
 if(!barPosition(layout.menuBar,key))return layout;const item=barItem(layout.menu,key,id);if(!item)return layout;
 const items=key.startsWith('item:')?layout.menu:validateMenu([...layout.menu,item]);
 const moved=target?moveMenuItem(items,item.id,target,position):validateMenu([...items.filter(row=>row.id!==item.id),{...item,parent:''}]);
 if(target&&moved===items)return layout;
 return {menu:moved,menuBar:removeBarKey(layout.menuBar,key)};
}
