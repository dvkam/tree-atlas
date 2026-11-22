import type { PointerEvent as ReactPointerEvent } from "react";

export type Activation = { element: HTMLElement; x: number; y: number };
export function activation(element: HTMLElement, event?: MouseEvent): Activation {
  const bounds = element.getBoundingClientRect();
  if (event && event.detail > 0) return { element, x: event.clientX, y: event.clientY };
  return { element, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export function pressFromPointer(event: ReactPointerEvent<HTMLElement>): void {
  const button = event.target instanceof Element ? event.target.closest("button") : null;
  if (!button || !event.isPrimary) return;
  const bounds = button.getBoundingClientRect();
  button.style.setProperty("--press-x", `${event.clientX - bounds.left}px`);
  button.style.setProperty("--press-y", `${event.clientY - bounds.top}px`);
}

/** Inline panels can be across the screen. Use the nearest edge facing the opener. */
export function revealFromTrigger(panel: HTMLElement, source: Activation): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const bounds = panel.getBoundingClientRect();
  const x = Math.min(bounds.width, Math.max(0, source.x - bounds.x));
  const y = Math.min(bounds.height, Math.max(0, source.y - bounds.y));
  panel.style.setProperty("--reveal-x", `${x}px`);
  panel.style.setProperty("--reveal-y", `${y}px`);
  panel.classList.add("trigger-reveal");
}
