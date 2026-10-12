import './annotation-tools.css';
import {
  ArrowUpLeft,
  Square,
  SquareRoundCorner,
  Circle,
  Triangle,
  Diamond,
  SquareDashed,
  Minus,
  MoveUpRight,
  Pencil,
  Highlighter,
  Type,
  Grid2X2,
  Droplet,
  ListOrdered,
  ZoomIn,
  Focus,
  Stamp,
  MousePointer2,
  Eraser,
  ChevronDown,
  createElement,
} from 'lucide';
import type { CaptureTool } from '../../shared/capture/image-document';
import { closeCaptureMenu, toggleCaptureMenu } from './capture-menu';
export const imageTools: [CaptureTool, string, any][] = [
  ['select', '选择区域', ArrowUpLeft],
  ['move', '选择和移动标注', MousePointer2],
  ['rectangle', '矩形', Square],
  ['roundrect', '圆角矩形', SquareRoundCorner],
  ['ellipse', '椭圆', Circle],
  ['triangle', '三角形', Triangle],
  ['diamond', '菱形', Diamond],
  ['solid', '实色遮盖', SquareDashed],
  ['line', '线条', Minus],
  ['arrow', '箭头', MoveUpRight],
  ['brush', '画笔', Pencil],
  ['highlight', '荧光笔', Highlighter],
  ['text', '文字', Type],
  ['mosaic', '马赛克', Grid2X2],
  ['blur', '模糊', Droplet],
  ['erase', '对象橡皮擦', Eraser],
  ['erasebrush', '橡皮擦笔刷', Eraser],
  ['step', '序号', ListOrdered],
  ['magnify', '放大镜', ZoomIn],
  ['spotlight', '聚光灯', Focus],
  ['watermark', '文字水印', Stamp],
];
export function annotationTools(
  target: HTMLElement,
  select: (tool: CaptureTool) => void,
  crop = false,
) {
  const controls = groupedAnnotationTools(target, select, { crop });
  target.addEventListener('annotation-tool-change', (event) =>
    controls.set((event as CustomEvent<CaptureTool>).detail),
  );
  return controls;
}

/** Compact families keep common tools visible and expose variants in one menu. */
export function groupedAnnotationTools(
  target: HTMLElement,
  choose: (tool: CaptureTool) => void,
  options: {
    allowed?: readonly CaptureTool[];
    crop?: boolean;
    menu?: (family: CaptureTool[], selected: CaptureTool, anchor: HTMLButtonElement) => void;
  } = {},
) {
  const families: CaptureTool[][] = [
    options.crop ? ['move', 'select'] : ['move'],
    ['rectangle', 'roundrect', 'ellipse', 'triangle', 'diamond', 'solid'],
    ['arrow', 'line'],
    ['brush', 'highlight'],
    ['text', 'watermark'],
    ['mosaic', 'blur'],
    ['erasebrush', 'erase'],
    ['step', 'magnify', 'spotlight'],
  ];
  const entries = families
    .map((family, index) => ({
      family: options.allowed ? family.filter((tool) => options.allowed!.includes(tool)) : family,
      index,
    }))
    .filter((entry) => entry.family.length)
    .map(({ family, index }) => {
      const group = document.createElement('div'),
        main = document.createElement('button');
      group.className = 'capture-tool-family';
      main.type = 'button';
      let selected = family[0];
      function update(tool = selected) {
        selected = tool;
        const [, label, glyph] = imageTools.find((t) => t[0] === tool)!;
        main.dataset.tool = tool;
        main.title = main.ariaLabel = options.crop && tool === 'select' ? '裁剪区域' : label;
        main.replaceChildren(createElement(glyph, { class: 'icon', 'aria-hidden': 'true' }));
      }
      update();
      main.onclick = () => {
        closeCaptureMenu();
        choose(selected);
      };
      group.dataset.tools = family.join(' ');
      group.append(main);
      if (family.length > 1) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'capture-tool-chevron';
        more.append(createElement(ChevronDown, { class: 'icon', 'aria-hidden': 'true' }));
        more.ariaLabel =
          ['选择', '图形', '线条', '画笔', '文字', '遮盖', '橡皮擦', '高级标注'][index] + '工具';
        more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-expanded', 'false');
        more.title = more.ariaLabel;
        more.onclick = () => {
          if (options.menu) {
            options.menu(family, selected, more);
            return;
          }
          if (more.getAttribute('aria-expanded') === 'true') {
            closeCaptureMenu();
            return;
          }
          closeCaptureMenu();
          const menu = document.createElement('div');
          menu.className = 'capture-tool-menu capture-panel';
          menu.setAttribute('role', 'menu');
          menu.ariaLabel = more.ariaLabel;
          for (const tool of family) {
            const [, label, glyph] = imageTools.find((t) => t[0] === tool)!;
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.tool = tool;
            button.setAttribute('role', 'menuitemradio');
            button.setAttribute('aria-checked', String(tool === selected));
            button.append(
              createElement(glyph, { class: 'icon', 'aria-hidden': 'true' }),
              document.createTextNode(options.crop && tool === 'select' ? '裁剪区域' : label),
            );
            button.onclick = () => {
              update(tool);
              closeCaptureMenu();
              choose(tool);
              main.focus();
            };
            menu.append(button);
          }
          document.body.append(menu);
          toggleCaptureMenu(menu, more, { close: () => menu.remove() });
        };
        group.append(more);
      }
      target.append(group);
      if (index === 0 || index === 4) {
        const line = document.createElement('span');
        line.className = 'capture-divider';
        line.setAttribute('role', 'separator');
        target.append(line);
      }
      return { family, main, update };
    });
  return {
    set(tool: CaptureTool) {
      for (const entry of entries) {
        if (entry.family.includes(tool)) entry.update(tool);
        entry.main.setAttribute('aria-pressed', String(entry.family.includes(tool)));
      }
    },
    close: closeCaptureMenu,
  };
}
