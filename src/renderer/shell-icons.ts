import {api} from './ui';

/** Hydrate visible file rows without blocking layout or applying results to replaced rows. */
export function hydrateFileIcons(root:HTMLElement,available:()=>boolean=()=>true){
 hydrateIconRows([...root.querySelectorAll<HTMLElement>('[data-file-icon]')],available);
}

/** Search refreshes hydrate only newly created rows, retaining existing native icons. */
export function hydrateIconRows(candidates:HTMLElement[],available:()=>boolean=()=>true){
 const rows=candidates.filter(row=>!row.querySelector('.windows-file-icon'));
 if(!rows.length)return;
 const paths=[...new Set(rows.map(row=>row.dataset.fileIcon!))].slice(0,150);
 void api.fileIcons(paths).then(images=>{if(!available())return;for(const row of rows){const image=images[row.dataset.fileIcon!];if(!image||!row.isConnected)continue;const img=document.createElement('img');img.className='windows-file-icon';img.alt='';img.draggable=false;img.src=image;row.replaceChildren(img);}}).catch(()=>{});
}
