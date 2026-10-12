/** Keep passive feedback clear of the screenshot's movable controls. */
export function captureMessage(node: HTMLElement, controls: HTMLElement[], redraw: () => void) {
  const changes = new MutationObserver(redraw),
    sizes = new ResizeObserver(redraw);
  changes.observe(node, { childList: true, characterData: true, subtree: true });
  for (const element of [node, ...controls]) sizes.observe(element);
  return {
    place() {
      if (!node.textContent) return;
      const message = node.getBoundingClientRect(),
        height = node.offsetHeight;
      const obstacles = controls
        .filter((e) => !e.hidden && e.getClientRects().length)
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.right + 8 > message.left && r.left - 8 < message.right);
      const low = 8,
        high = Math.max(low, innerHeight - height - 8);
      const candidates = [
        innerHeight - height - 18,
        18,
        ...obstacles.flatMap((r) => [r.top - height - 8, r.bottom + 8]),
      ].map((y) => Math.max(low, Math.min(y, high)));
      const overlap = (y: number) =>
        obstacles.reduce(
          (sum, r) =>
            sum + Math.max(0, Math.min(y + height, r.bottom + 8) - Math.max(y, r.top - 8)),
          0,
        );
      const top =
        candidates.find((y) => overlap(y) === 0) ??
        candidates.reduce((best, y) => (overlap(y) < overlap(best) ? y : best));
      node.style.bottom = 'auto';
      node.style.top = top + 'px';
    },
    dispose() {
      changes.disconnect();
      sizes.disconnect();
    },
  };
}
