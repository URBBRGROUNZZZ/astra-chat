import { useLayoutEffect } from 'react';

// Size normal document flow to the visible bottom edge. Never translate the
// app by scrollY: Safari also scrolls to reveal the native editor/caret.
export function useViewport() {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let frame = 0;
    let follow = 0;
    let followUntil = 0;
    let applied = '';
    let timers: ReturnType<typeof setTimeout>[] = [];
    const update = () => {
      if (document.visibilityState === 'hidden') return;
      // Leave pinch zoom to the browser instead of reflowing a focused editor.
      if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
      const layoutHeight = window.innerHeight;
      const visibleBottom = viewport && viewport.height > 0
        ? viewport.height + Math.max(0, viewport.offsetTop) : layoutHeight;
      if (layoutHeight > 0 && visibleBottom > 0) {
        const height = `${Math.min(layoutHeight, visibleBottom)}px`;
        if (height !== applied) {
          applied = height;
          root.style.setProperty('--app-height', height);
        }
      }
      // Only the message list and the textarea may scroll. Clear any document
      // scroll left by native focus/keyboard handling, without moving focus.
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    // iOS animates the keyboard over several frames and can report stale
    // viewport metrics mid-animation, so keep re-reading for a short window
    // after each trigger instead of trusting a single resize event.
    const step = () => {
      follow = 0;
      update();
      if (performance.now() < followUntil) follow = requestAnimationFrame(step);
    };
    const track = () => {
      followUntil = performance.now() + 600;
      if (!follow) follow = requestAnimationFrame(step);
      schedule();
    };
    const settle = () => {
      timers.forEach(clearTimeout);
      track();
      // Standalone apps and restored pages can settle slower than the
      // keyboard animation; re-read again after the burst ends.
      timers = [900, 1400].map(delay => setTimeout(schedule, delay));
    };
    const events: [EventTarget, string, () => void][] = [
      [window, 'resize', settle], [window, 'scroll', track],
      [window, 'orientationchange', settle], [window, 'pageshow', settle],
      [document, 'focusin', settle], [document, 'focusout', settle],
      [document, 'visibilitychange', settle],
    ];
    if (viewport) events.push([viewport, 'resize', track], [viewport, 'scroll', track]);
    events.forEach(([target, event, listener]) => target.addEventListener(event, listener));
    update();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(follow);
      timers.forEach(clearTimeout);
      events.forEach(([target, event, listener]) => target.removeEventListener(event, listener));
      root.style.removeProperty('--app-height');
    };
  }, []);
}
