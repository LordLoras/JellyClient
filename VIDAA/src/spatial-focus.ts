function center(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

export function moveSpatialFocus(
  direction: 'up' | 'down' | 'left' | 'right'
): void {
  const focusable = [...document.querySelectorAll<HTMLElement>(
    '[data-focusable]:not([disabled])'
  )].filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (focusable.length === 0) return;

  const active = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  if (!active || !focusable.includes(active)) {
    focusable[0]?.focus();
    return;
  }

  const origin = center(active);
  const candidates = focusable
    .filter((element) => element !== active)
    .map((element) => {
      const point = center(element);
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const isForward =
        (direction === 'left' && dx < -4) ||
        (direction === 'right' && dx > 4) ||
        (direction === 'up' && dy < -4) ||
        (direction === 'down' && dy > 4);
      const primary = direction === 'left' || direction === 'right'
        ? Math.abs(dx)
        : Math.abs(dy);
      const secondary = direction === 'left' || direction === 'right'
        ? Math.abs(dy)
        : Math.abs(dx);
      return {
        element,
        isForward,
        score: primary + secondary * 2.5
      };
    })
    .filter((candidate) => candidate.isForward)
    .sort((a, b) => a.score - b.score);

  candidates[0]?.element.focus();
}
