/** Styles are loaded by the view import; image decoding must not delay showing it. */
export async function recognitionReady(notify: () => Promise<void>) {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await notify();
}

export function prepareRecognitionImage(image: HTMLImageElement, failed: (error: unknown) => void) {
  const host=image.closest<HTMLElement>('.text-image-workspace')!;
  const placeholder=document.createElement('div');placeholder.className='recognition-image-placeholder';
  placeholder.setAttribute('role','status');placeholder.setAttribute('aria-label','加载图片');
  placeholder.innerHTML='<span class="recognition-spinner" aria-hidden="true"></span>';
  host.append(placeholder);host.ariaBusy='true';image.style.visibility='hidden';
  return (source:string|Promise<string>) => {
    void Promise.resolve(source).then(value=>{image.src=value;return image.decode();}).then(()=>{image.style.visibility='';placeholder.remove();host.ariaBusy='false';}).catch(error=>{
      host.ariaBusy='false';placeholder.textContent='图片加载失败';failed(error);
    });
  };
}
