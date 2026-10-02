/** Move among usable options without landing on a disabled item. */
export function enabledOption(options:readonly {disabled?:boolean}[],index:number,direction:1|-1){
 for(let next=index;next>=0&&next<options.length;next+=direction)if(!options[next].disabled)return next;
 return -1;
}

/** Update only the old and new highlights, keeping stable rows untouched. */
export function focusOption(previous:HTMLElement|null,next:HTMLElement|null){
 if(previous===next)return next;
 previous?.classList.remove('focused');next?.classList.add('focused');return next;
}

/** The option list is the item's positioned parent; never scroll its page. */
export function revealOption(list:HTMLElement,item:HTMLElement){
 const top=item.offsetTop,bottom=top+item.offsetHeight,visibleTop=list.scrollTop,visibleBottom=visibleTop+list.clientHeight;
 if(top<visibleTop)list.scrollTop=top;
 else if(bottom>visibleBottom)list.scrollTop=bottom-list.clientHeight;
}
