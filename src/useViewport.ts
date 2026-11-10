import { useLayoutEffect } from 'react';

// The keyboard can shrink and pan Safari's visual viewport without resizing
// the layout viewport. Keep the editor in document coordinates so its native
// caret and the visible textarea follow the same scroll offset.
export function useViewport() {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const root = document.documentElement;
      root.style.setProperty('--viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty('--viewport-top', `${window.scrollY + (viewport?.offsetTop ?? 0)}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
    };
  }, []);
}
