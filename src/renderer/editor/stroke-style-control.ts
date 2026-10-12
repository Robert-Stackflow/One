import type { IconNode } from 'lucide';
import { strokeStyles, strokeDash } from '../../shared/capture/stroke-style';
import { registerIcons } from '../ui';

/** The shared select retains keyboard navigation and shows the actual stroke pattern. */
export function strokeStyleControl(select: HTMLSelectElement) {
  const catalog: Record<string, IconNode> = {};
  for (const { value, label } of strokeStyles) {
    const path =
      value === 'double'
        ? 'M2 9h20M2 15h20'
        : value === 'wavy'
          ? 'M2 12q2.5-6 5 0t5 0t5 0t5 0'
          : 'M2 12h20';
    catalog['stroke-' + value] = [
      [
        'path',
        {
          d: path,
          'stroke-dasharray': strokeDash(value, 1.3).join(' ') || 'none',
          'stroke-linecap': 'round',
        },
      ],
    ];
    const option = new Option(label, value);
    option.dataset.icon = 'lucide:stroke-' + value;
    select.append(option);
  }
  registerIcons(catalog);
  select.value = 'solid';
}
