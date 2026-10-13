import { q } from '../ui';
import { customControls } from '../controls';
import {dialogMarkup,openDialog,closeDialog,lockDialogDismiss} from '../dialog';
import type { TranslationConfig, TranslationSettings } from '../../shared/recognition/translation';
import './service-settings.css';
export function mountServiceSettings(
  prefix: 'translation' | 'formula',
  options: {
    load(): Promise<TranslationConfig>;
    save(value: TranslationSettings): Promise<TranslationConfig>;
    clear(revision: string): Promise<TranslationConfig>;
    available(): boolean;
    updated(value: TranslationConfig, notice: string): void;
    error(value: unknown): void;
  },
) {
  const formula = prefix === 'formula',
    label = formula ? '公式识别' : '翻译',
    dialog = q<HTMLDialogElement>(prefix + '-settings'),
    modal = formula ? 'formula-modal' : 'modal';
  let config: TranslationConfig | undefined,
    saving = false,
    opening = false;
  const field = <T extends HTMLElement>(id: string) => dialog.querySelector<T>('#' + id)!;
  const body = `<section class="service-settings-section"><h3>连接</h3><label class="field">服务类型<select id="${prefix}-provider"><option value="chat">Chat Completions 兼容服务</option>${formula ? '' : '<option value="azure">Azure Translator</option>'}</select></label><label id="${prefix}-endpoint-field" class="field">接口地址<input id="${prefix}-endpoint" type="url" maxlength="2048" placeholder="https://your-service.example/v1/chat/completions" autocomplete="off"></label><label id="${prefix}-model-field" class="field">${formula ? '视觉模型' : '模型'}<input id="${prefix}-model" maxlength="128" placeholder="模型名称" autocomplete="off"></label><label id="${prefix}-region-field" class="field" hidden>Azure 区域<input id="${prefix}-region" maxlength="64" placeholder="例如 eastasia；全局资源可留空" autocomplete="off"></label></section><section class="service-settings-section"><h3>身份验证</h3><label class="field">密钥<input id="${prefix}-key" type="password" maxlength="4096" autocomplete="off" spellcheck="false"></label><span class="service-secret-note">系统加密保存 · 更换接口地址时需重新填写</span></section>`;
  const template=document.createElement('template');
  template.innerHTML=dialogMarkup({id:prefix+'-settings',title:label+'服务',titleId:modal+'-title',closeId:modal+'-close',className:'one-form-dialog recognition-settings',body:`<form id="${prefix}-form" novalidate>${body}<p id="${modal}-error" class="dialog-error" role="status"></p></form>`,actions:`<button id="${prefix}-remove" type="button" class="quiet" hidden>移除配置</button><button id="${prefix}-save" type="submit" form="${prefix}-form" class="primary">保存配置</button>`});
  dialog.replaceChildren(...template.content.firstElementChild!.childNodes);
  dialog.classList.add('recognition-settings');
  function fields() {
    const azure = field<HTMLSelectElement>(prefix + '-provider').value === 'azure';
    field(prefix + '-endpoint-field').hidden = azure;
    field(prefix + '-model-field').hidden = azure;
    field(prefix + '-region-field').hidden = !azure;
  }
  const error = (value: unknown) => {
    const node = field(modal + '-error'); node.textContent = value instanceof Error ? value.message : String(value || ''); node.hidden = !node.textContent;
  };
  async function open() {
    if (saving || opening || !options.available()) return;
    opening = true;
    try {
      config = await options.load();
      options.updated(config, '');
      if (!options.available()) return;
      for (const name of ['provider', 'endpoint', 'model', 'region'] as const)
        field<HTMLInputElement>(prefix + '-' + name).value = config[name];
      const key = field<HTMLInputElement>(prefix + '-key');
      key.value = '';
      key.placeholder = config.keySaved ? '已保存，留空保留' : '填写服务密钥';
      field(prefix + '-remove').hidden = !config.keySaved;
      error(config.error);
      fields();
      openDialog(dialog);
      customControls(dialog);
    } catch (value) {
      options.error(value);
    } finally {
      opening = false;
    }
  }
  field(prefix + '-provider').onchange = fields;
  field(modal + '-close').onclick = () => {
    if (!saving) void closeDialog(dialog);
  };
  dialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    field<HTMLInputElement>(prefix + '-key').value = '';
  });
  async function save(remove = false) {
    if (saving || !config) return;
    saving = true;
    const unlock=lockDialogDismiss(dialog);
    const form = dialog.querySelector('form')!;
    form.ariaBusy = 'true';
    const controls = dialog.querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement
    >('button,input,select');
    for (const control of controls) control.disabled = true;
    try {
      const key = field<HTMLInputElement>(prefix + '-key').value.trim();
      config = remove
        ? await options.clear(config.revision)
        : await options.save({
            revision: config.revision,
            provider: field<HTMLSelectElement>(prefix + '-provider').value as 'chat' | 'azure',
            endpoint: field<HTMLInputElement>(prefix + '-endpoint').value.trim(),
            model: field<HTMLInputElement>(prefix + '-model').value,
            region: field<HTMLInputElement>(prefix + '-region').value.trim(),
            ...(key ? { key } : {}),
          });
      unlock();
      await closeDialog(dialog);
      options.updated(
        config,
        remove
          ? `已移除${label}配置`
          : `${label}服务已保存，可以主动${formula ? '识别公式' : label}`,
      );
    } catch (value) {
      error(value);
    } finally {
      unlock();
      saving = false;
      form.ariaBusy = 'false';
      for (const control of controls) control.disabled = false;
    }
  }
  dialog.querySelector('form')!.onsubmit = (event) => {
    event.preventDefault();
    void save();
  };
  field(prefix + '-remove').onclick = () => void save(true);
  void options
    .load()
    .then((value) => {
      config = value;
      options.updated(value, '');
    })
    .catch(options.error);
  return { open };
}
