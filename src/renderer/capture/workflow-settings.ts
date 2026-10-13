import { defaultEffects } from '../../shared/capture/image-output';
import {
  actionNames,
  captureActions,
  workflowsFrom,
  type CaptureWorkflow,
} from '../../shared/capture/capture-workflow';
import type { CapturePreferences } from '../../shared/capture/settings';
import { mountOutputEffects } from '../editor/output-effects';
import { customControls, selectSource } from '../controls';
import { createElement, ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide';
import './workflow-settings.css';
import { translationLanguages, translationLanguage } from '../../shared/recognition/translation';
export function mountWorkflowSettings(
  root: HTMLElement,
  initial: CapturePreferences,
  save: (patch: Pick<CapturePreferences, 'workflows' | 'workflowId'>) => Promise<void>,
  report: (error: unknown) => void,
) {
  let workflows = structuredClone(initial.workflows),
    defaultId = initial.workflowId,
    selectedId = defaultId;
  let effects: ReturnType<typeof mountOutputEffects>;
  let revision = 0;
  root.classList.add('settings-workflow-editor');
  root.innerHTML = `<p class="workflow-intro">确认截图时依次执行所选流程；复制、保存等单独按钮也可直接使用。</p>
    <div class="workflow-editor-bar"><select class="workflow-select" aria-label="编辑输出流程"></select><button type="button" class="workflow-make-default quiet">设为默认</button><span class="workflow-bar-divider"></span><button type="button" class="workflow-add quiet icon-button" aria-label="新增输出流程"></button><button type="button" class="workflow-delete quiet icon-button" aria-label="删除输出流程"></button></div>
    <div class="workflow-detail"><label class="workflow-name-field"><span>流程名称</span><input class="workflow-name" maxlength="40" aria-label="流程名称"></label>
    <div class="workflow-actions"><div class="workflow-subheading"><span>执行顺序</span><small>从上到下依次执行</small></div><ol class="workflow-action-order"></ol><div class="workflow-action-add"></div></div></div>
    <details class="output-effect-panel"><summary>圆角、边框与阴影</summary><div class="workflow-effects"></div></details><p class="workflow-help">保存取消或执行失败时，可重试继续未完成的步骤。</p><p class="workflow-feedback" role="status" aria-live="polite"></p>`;
  const q = <T extends HTMLElement = HTMLElement>(name: string): T => {
    const control = root.querySelector<HTMLElement>('.' + name)!;
    return (selectSource(control) || control) as T;
  };
  const translation = document.createElement('div');
  translation.className = 'workflow-translation';
  translation.innerHTML = `<label>译为<select class="workflow-translation-target" aria-label="流程翻译目标语言"></select></label><p class="workflow-help">主动运行此流程时，先在本机识别文字，再将原文发送至已配置的翻译服务；图片留在本机。请先在文字识别窗口配置服务。</p>`;
  q('workflow-detail').append(translation);
  const target = q<HTMLSelectElement>('workflow-translation-target');
  for (const [value, name] of Object.entries(translationLanguages)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = name;
    target.append(option);
  }
  const selected = () => workflows.find((p) => p.id === selectedId)!;
  const persist = () => {
    try {
      workflows = workflowsFrom(workflows);
      const current = ++revision;
      q('workflow-feedback').textContent = '正在保存…';
      void save({ workflows: structuredClone(workflows), workflowId: defaultId })
        .then(() => {
          if (root.isConnected && revision === current)
            q('workflow-feedback').textContent = '流程已保存';
        })
        .catch((error) => {
          if (root.isConnected && revision === current)
            q('workflow-feedback').textContent = '保存失败，请修改后重试';
          report(error);
        });
    } catch (error) {
      q('workflow-feedback').textContent = error instanceof Error ? error.message : String(error);
    }
  };
  const options = (select: HTMLSelectElement, id: string) => {
    select.replaceChildren();
    for (const p of workflows) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      select.append(o);
    }
    select.value = id;
    select.dispatchEvent(new Event('optionschange'));
  };
  function render() {
    translation.hidden = !selected().actions.includes('translate');
    target.value = selected().translationTarget ?? 'zh-Hans';
    options(q<HTMLSelectElement>('workflow-select'), selectedId);
    q<HTMLButtonElement>('workflow-make-default').textContent =
      selectedId === defaultId ? '默认流程' : '设为默认';
    q<HTMLButtonElement>('workflow-make-default').disabled = selectedId === defaultId;
    q<HTMLInputElement>('workflow-name').value = selected().name;
    q<HTMLButtonElement>('workflow-delete').disabled = workflows.length <= 1;
    q<HTMLButtonElement>('workflow-add').disabled = workflows.length >= 12;
    const order = q('workflow-action-order'),
      add = q('workflow-action-add');
    order.replaceChildren();
    add.replaceChildren();
    selected().actions.forEach((action, index) => {
      const row = document.createElement('li'),
        name = document.createElement('span');
      name.textContent = actionNames[action];
      const number = document.createElement('b');
      number.textContent = String(index + 1);
      number.className = 'workflow-step-number';
      row.append(number, name);
      for (const [title, delta, glyph] of [
        ['上移', -1, ArrowUp],
        ['下移', 1, ArrowDown],
        ['移除', 0, Trash2],
      ] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'quiet icon-button';
        b.ariaLabel = b.title = actionNames[action] + title;
        b.append(createElement(glyph, { class: 'icon', 'aria-hidden': 'true' }) as unknown as Node);
        b.disabled =
          delta === 0
            ? selected().actions.length === 1
            : index + delta < 0 || index + delta >= selected().actions.length;
        b.onclick = () => {
          const actions = selected().actions;
          if (!delta) actions.splice(index, 1);
          else [actions[index], actions[index + delta]] = [actions[index + delta], actions[index]];
          persist();
          render();
        };
        row.append(b);
      }
      order.append(row);
    });
    for (const action of captureActions.filter((a) => !selected().actions.includes(a))) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'quiet';
      b.dataset.addAction = action;
      b.append(
        createElement(Plus, { class: 'icon', 'aria-hidden': 'true' }) as unknown as Node,
        document.createTextNode(actionNames[action]),
      );
      b.onclick = () => {
        selected().actions.push(action);
        persist();
        render();
      };
      add.append(b);
    }
    effects?.refresh();
  }
  q<HTMLButtonElement>('workflow-make-default').onclick = () => {
    defaultId = selectedId;
    persist();
    render();
  };
  target.onchange = () => {
    selected().translationTarget = translationLanguage(target.value);
    persist();
    render();
  };
  q<HTMLSelectElement>('workflow-select').onchange = () => {
    selectedId = q<HTMLSelectElement>('workflow-select').value;
    render();
  };
  q<HTMLInputElement>('workflow-name').onchange = () => {
    try {
      const name = q<HTMLInputElement>('workflow-name').value.trim();
      if (!name) throw Error('流程名称不能为空');
      const next = structuredClone(workflows);
      next.find((p) => p.id === selectedId)!.name = name;
      workflows = workflowsFrom(next);
    } catch (error) {
      q('workflow-feedback').textContent = error instanceof Error ? error.message : String(error);
      q<HTMLInputElement>('workflow-name').value = selected().name;
      return;
    }
    persist();
    render();
  };
  q('workflow-add').prepend(
    createElement(Plus, { class: 'icon', 'aria-hidden': 'true' }) as unknown as Node,
  );
  q('workflow-delete').append(
    createElement(Trash2, { class: 'icon', 'aria-hidden': 'true' }) as unknown as Node,
  );
  q('workflow-add').onclick = () => {
    if (workflows.length >= 12) return;
    const next: CaptureWorkflow = {
      id: crypto.randomUUID(),
      name: '新流程',
      actions: ['copy'],
      effects: defaultEffects(),
    };
    workflows.push(next);
    selectedId = next.id;
    persist();
    render();
  };
  q('workflow-delete').onclick = () => {
    if (workflows.length <= 1) return;
    workflows = workflows.filter((p) => p.id !== selectedId);
    if (!workflows.some((p) => p.id === defaultId)) defaultId = workflows[0].id;
    selectedId = defaultId;
    persist();
    render();
  };
  render();
  effects = mountOutputEffects(q('workflow-effects'), {
    value: () => selected().effects,
    change: (value) => {
      selected().effects = value;
      persist();
    },
    error: report,
    settingsLayout: true,
  });
  customControls(root);
  return {
    update(value: CapturePreferences) {
      ++revision;
      workflows = structuredClone(value.workflows);
      defaultId = value.workflowId;
      if (!workflows.some(item => item.id === selectedId)) selectedId = defaultId;
      render();
      q('workflow-feedback').textContent = '';
    },
  };
}
