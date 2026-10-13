/** Read the same timing used by CSS popovers, including reduced-motion settings. */
export function popupMotion(style: CSSStyleDeclaration, opening: boolean) {
  const value = style.getPropertyValue(opening ? '--popup-enter-duration' : '--popup-exit-duration').trim();
  return {
    duration: (parseFloat(value) || 0) * (value.endsWith('ms') ? 1 : 1000),
    easing: style.getPropertyValue('--popup-easing').trim() || 'cubic-bezier(.2,.8,.2,1)',
  };
}
