import {api,esc,icon} from './ui';

/** A neutral placeholder until Windows supplies the associated file icon. */
export function systemFileIcon(path:string,directory=false){return `<span class="file-type-icon" data-file-icon="${esc(path)}">${icon(directory?'folder':'file')}</span>`;}

/** Hydrate visible file rows without blocking layout or applying results to replaced rows. */
export function hydrateFileIcons(root:HTMLElement,available:()=>boolean=()=>true){
 hydrateIconRows([...root.querySelectorAll<HTMLElement>('[data-file-icon]')],available);
}

/** Search refreshes hydrate only newly created rows, retaining existing native icons. */
export function hydrateIconRows(candidates:HTMLElement[],available:()=>boolean=()=>true){
 const rows=candidates.filter(row=>!!row.dataset.fileIcon&&!row.querySelector('.windows-file-icon')).map(row=>({row,path:row.dataset.fileIcon!}));
 if(!rows.length)return;
 const paths=[...new Set(rows.map(({path})=>path))].slice(0,150);
 void api.fileIcons(paths).then(images=>{if(!available())return;for(const {row,path} of rows){const image=images[path];if(!image||!row.isConnected||row.dataset.fileIcon!==path)continue;const img=document.createElement('img');img.className='windows-file-icon';img.alt='';img.draggable=false;img.src=image;row.replaceChildren(img);}}).catch(()=>{});
}
