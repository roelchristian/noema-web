import type {MouseEvent} from 'react';

const feedback = new WeakMap<HTMLElement, Animation>();

/** One short animation per click, without adding navigation state or delaying actions. */
export function animateSidebarClick(event: MouseEvent<HTMLElement>) {
  if (event.defaultPrevented || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const button = (event.target as Element).closest<HTMLButtonElement>('.nav,.page-link,.branch-toggle,.branch-leaf-icon,.sidebar-create,.sidebar-new-note');
  if (!button || button.disabled || !event.currentTarget.contains(button)) return;
  const item = button.closest<HTMLElement>('.sidebar-item-row') ?? button;
  if (!item.animate) return;
  feedback.get(item)?.cancel();
  const animation = item.animate([
    {transform: 'scale(.985)', offset: 0},
    {transform: 'scale(1)', offset: 1},
  ], {duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)'});
  feedback.set(item, animation);
  const clear = () => {if (feedback.get(item) === animation) feedback.delete(item);};
  animation.onfinish = clear;
  animation.oncancel = clear;
}
