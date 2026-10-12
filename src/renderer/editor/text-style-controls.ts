import { createElement, Bold, Italic, TypeOutline, type IconNode } from 'lucide';

/** Compact, shared text switches; backing fields remain the source of truth. */
export function textStyleControls(root: HTMLElement, ids: Record<string, string> = {}) {
  const field = (name: string) => root.querySelector<HTMLInputElement>('#' + (ids[name] || name));
  const weight = field('mark-weight'),
    group = root.querySelector<HTMLElement>('[data-text-emphasis]');
  if (!weight || !group) return () => {};
  const refreshers: (() => void)[] = [];
  function add(
    label: string,
    icon: IconNode,
    input: HTMLInputElement,
    read: () => boolean,
    toggle: () => void,
  ) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = button.ariaLabel = label;
    button.append(createElement(icon, { 'aria-hidden': 'true' }));
    const refresh = () => button.setAttribute('aria-pressed', String(read()));
    button.onclick = () => {
      toggle();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      refresh();
    };
    input.addEventListener('change', refresh);
    group!.append(button);
    refreshers.push(refresh);
  }
  add(
    '加粗',
    Bold,
    weight,
    () => Number(weight.value) >= 600,
    () => {
      weight.value = Number(weight.value) >= 600 ? '400' : '700';
    },
  );
  for (const [label, icon, name] of [
    ['斜体', Italic, 'mark-italic'],
    ['描边', TypeOutline, 'mark-outline'],
  ] as const) {
    const input = field(name)!;
    add(
      label,
      icon,
      input,
      () => input.checked,
      () => {
        input.checked = !input.checked;
      },
    );
  }
  return () => refreshers.forEach((refresh) => refresh());
}
