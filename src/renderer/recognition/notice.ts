/** Feedback appears only for an action or error, never as a permanent instruction. */
export function recognitionNotice(node: HTMLElement) {
  node.classList.add('recognition-notice');
  let last = '', timer: ReturnType<typeof setTimeout> | undefined;
  return (value: unknown) => {
    const text = value instanceof Error ? value.message : String(value ?? '');
    if (last === text) return;
    last = text; if (timer) clearTimeout(timer);
    node.textContent = text; node.hidden = !text;
    if (text) timer = setTimeout(() => { node.hidden = true; node.textContent = ''; last = ''; }, value instanceof Error ? 12000 : 4500);
  };
}
