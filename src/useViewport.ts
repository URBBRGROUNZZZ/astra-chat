import { useLayoutEffect } from 'react';

// Size normal document flow to the visible bottom edge. Never translate the
// app by scrollY: Safari also scrolls to reveal the native editor/caret.
export function useViewport() {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let frame = 0;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const update = () => {
      if (document.visibilityState === 'hidden') return;
      // Leave pinch zoom to the browser instead of reflowing a focused editor.
      if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
      const layoutHeight = window.innerHeight;
      const visibleBottom = viewport && viewport.height > 0
        ? viewport.height + Math.max(0, viewport.offsetTop) : layoutHeight;
      if (layoutHeight > 0 && visibleBottom > 0) {
        root.style.setProperty('--app-height', `${Math.min(layoutHeight, visibleBottom)}px`);
      }
      // Only the message list and the textarea may scroll. Clear any document
      // scroll left by native focus/keyboard handling, without moving focus.
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const settle = () => {
      timers.forEach(clearTimeout);
      schedule();
      // iOS can report stale viewport metrics during keyboard animations and
      // when restoring a standalone app. Re-read rather than cache dimensions.
      timers = [100, 300, 700].map(delay => setTimeout(schedule, delay));
    };
    const events: [EventTarget, string, () => void][] = [
      [window, 'resize', settle], [window, 'scroll', schedule],
      [window, 'orientationchange', settle], [window, 'pageshow', settle],
      [document, 'focusin', settle], [document, 'focusout', settle],
      [document, 'visibilitychange', settle],
    ];
    if (viewport) events.push([viewport, 'resize', schedule], [viewport, 'scroll', schedule]);
    events.forEach(([target, event, listener]) => target.addEventListener(event, listener));
    update();
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      events.forEach(([target, event, listener]) => target.removeEventListener(event, listener));
      root.style.removeProperty('--app-height');
    };
  }, []);
}
