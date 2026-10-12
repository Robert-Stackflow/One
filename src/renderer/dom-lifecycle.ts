/** Dispose connected UI when it leaves the document, without treating reparenting as removal. */
const removals = new Map<HTMLElement, {connected: boolean; callbacks: Set<() => void>}>();
let observer: MutationObserver | undefined;

export function onRemoval(node: HTMLElement, dispose: () => void): () => void {
  let entry = removals.get(node);
  if (!entry) {
    entry = {connected: node.isConnected, callbacks: new Set()};
    removals.set(node, entry);
  }
  entry.callbacks.add(dispose);
  if (!observer) {
    observer = new MutationObserver(records => {
      const callbacks: (() => void)[] = [];
      for (const [element, item] of removals) {
        if (element.isConnected) item.connected = true;
        else if (item.connected || records.some(record =>
          Array.from(record.removedNodes).some(removed => removed.contains(element)))) {
          removals.delete(element);
          callbacks.push(...item.callbacks);
        }
      }
      stopIfEmpty();
      for (const callback of callbacks) {
        try { callback(); } catch (error) { reportError(error); }
      }
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
  }
  return () => {
    entry.callbacks.delete(dispose);
    if (!entry.callbacks.size && removals.get(node) === entry) removals.delete(node);
    stopIfEmpty();
  };
}

function stopIfEmpty() {
  if (removals.size) return;
  observer?.disconnect();
  observer = undefined;
}
