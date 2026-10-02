export interface PickerPreferences { showHidden: boolean; showExtensions: boolean }
export interface PickerBounds { x: number; y: number; width: number; height: number }
export function fitPickerBounds(saved: PickerBounds, area: PickerBounds): PickerBounds {
 const width=Math.min(area.width,Math.max(620,saved.width)),height=Math.min(area.height,Math.max(500,saved.height));
 return {width,height,x:Math.max(area.x,Math.min(saved.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(saved.y,area.y+area.height-height))};
}
/** Native frames and fractional DPI can add pixels to constructor/setBounds sizes. */
export function restorePickerBounds(window: {setBounds(bounds: PickerBounds, animate?: boolean): unknown; getBounds(): PickerBounds}, target: PickerBounds) {
 let requested={...target};
 for(let attempt=0;attempt<3;attempt++){
  window.setBounds(requested,false);const actual=window.getBounds();
  if(['x','y','width','height'].every(key=>actual[key as keyof PickerBounds]===target[key as keyof PickerBounds]))break;
  requested={x:requested.x+target.x-actual.x,y:requested.y+target.y-actual.y,width:Math.max(1,requested.width+target.width-actual.width),height:Math.max(1,requested.height+target.height-actual.height)};
 }
}
export interface PickerPlace { path: string; name: string }
export interface PickerPlaces { common: PickerPlace[]; bookmarks: PickerPlace[]; recent: PickerPlace[]; drives: PickerPlace[] }
export interface PickerOpened { places: PickerPlace[]; error: string }
export interface PickerEntry { name: string; path: string; directory: boolean; hidden: boolean }
export interface PickerData {
 mode: 'file' | 'directory' | 'save'; title: string; path: string; parent: string; name: string;
 preferences: PickerPreferences; entries: PickerEntry[];
}
export function pickerDisplayName(entry: PickerEntry, showExtensions: boolean) {
 const dot = entry.name.lastIndexOf('.');
 return !entry.directory && !showExtensions && dot > 0 ? entry.name.slice(0, dot) : entry.name;
}
