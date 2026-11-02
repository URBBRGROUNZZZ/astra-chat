import { useLayoutEffect } from 'react';

// The keyboard can shrink AND pan Safari's visual viewport without resizing
// its layout viewport. Follow both values; keep document scrolling disabled.
export function useViewport() {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const root = document.documentElement;
      root.style.setProperty('--viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty('--viewport-top', `${viewport?.offsetTop ?? 0}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);
}
