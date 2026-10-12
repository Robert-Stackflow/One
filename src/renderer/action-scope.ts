import './action-scope.css';

// One's action entry point, with a per-operation gate across page rerenders.
type Work = () => unknown | Promise<unknown>;
type ButtonState = { count: number; disabled: boolean; focused: boolean };
type FeedbackState = { count: number; busy: string | null; timer: ReturnType<typeof setTimeout> };
const disabledButtons = new WeakMap<HTMLButtonElement, ButtonState>();
const feedbackButtons = new WeakMap<HTMLButtonElement, FeedbackState>();
export function setActionDisabled(button: HTMLButtonElement, disabled: boolean) {
  const state = disabledButtons.get(button);
  if (state) {
    state.disabled = disabled;
    button.disabled = true;
  } else button.disabled = disabled;
}

export function actionFeedback(button: HTMLButtonElement) {
  let state = feedbackButtons.get(button);
  if (state) state.count++;
  else {
    const busy = button.getAttribute('aria-busy');
    button.setAttribute('aria-busy', 'true');
    state = {
      count: 1,
      busy,
      timer: setTimeout(() => {
        if (button.isConnected) button.classList.add('action-pending');
      }, 150),
    };
    feedbackButtons.set(button, state);
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (--state.count) return;
    clearTimeout(state.timer);
    feedbackButtons.delete(button);
    button.classList.remove('action-pending');
    if (state.busy === null) button.removeAttribute('aria-busy');
    else button.setAttribute('aria-busy', state.busy);
  };
}

function lockButton(button: HTMLButtonElement, feedback: boolean) {
  let state = disabledButtons.get(button);
  if (state) state.count++;
  else {
    state = { count: 1, disabled: button.disabled, focused: document.activeElement === button };
    disabledButtons.set(button, state);
    button.disabled = true;
  }
  const finish = feedback ? actionFeedback(button) : () => {};
  return () => {
    finish();
    if (--state.count) return;
    disabledButtons.delete(button);
    button.disabled = state.disabled;
    if (
      state.focused &&
      !button.disabled &&
      button.isConnected &&
      button.getClientRects().length &&
      document.activeElement === document.body
    )
      button.focus({ preventScroll: true });
  };
}
const identity = (button: HTMLButtonElement) =>
  button.id ||
  Object.entries(button.dataset)
    .filter(([key]) => key !== 'tooltip')
    .map(([key, value]) => key + '=' + value)
    .join('\n');
type Pending = { buttons: Map<HTMLButtonElement, () => void>; origin: string | undefined };
export class ActionScope {
  private pending = new Map<string, Pending>();
  private bindings = new WeakMap<
    HTMLButtonElement,
    { work: Work; error: (value: unknown) => void; key: string }
  >();
  private attach(state: Pending, button: HTMLButtonElement) {
    for (const [old, release] of state.buttons)
      if (!old.isConnected) {
        release();
        state.buttons.delete(old);
      }
    if (!state.buttons.has(button))
      state.buttons.set(button, lockButton(button, state.origin === identity(button)));
  }
  run(key: string, work: Work, buttons: HTMLButtonElement[] = []): Promise<unknown> {
    if (this.pending.has(key)) return Promise.resolve(undefined);
    const state: Pending = {
      buttons: new Map(),
      origin: buttons[0] ? identity(buttons[0]) : undefined,
    };
    this.pending.set(key, state);
    for (const button of buttons) this.attach(state, button);
    const finish = () => {
      if (this.pending.get(key) === state) this.pending.delete(key);
      for (const release of state.buttons.values()) release();
      state.buttons.clear();
    };
    try {
      return Promise.resolve(work()).finally(finish);
    } catch (error) {
      finish();
      return Promise.reject(error);
    }
  }
  bind(
    button: HTMLButtonElement | null,
    work: Work,
    error: (value: unknown) => void,
    key = button?.id || 'action',
  ) {
    if (!button) return;
    const pending = this.pending.get(key);
    if (pending) this.attach(pending, button);
    const previous = this.bindings.get(button);
    if (previous) {
      Object.assign(previous, { work, error, key });
      return;
    }
    const binding = { work, error, key };
    this.bindings.set(button, binding);
    button.addEventListener('click', () => {
      if (!button.isConnected || button.disabled || this.pending.has(binding.key)) return;
      void this.run(binding.key, binding.work, [button]).catch(binding.error);
    });
  }
}
