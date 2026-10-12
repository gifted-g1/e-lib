import { useCallback, useEffect, useRef } from 'react';
import { api } from './api';

// Hidden admin gesture: press and hold for `ms` milliseconds.
export function useLongPress(onLongPress, ms = 3000) {
  const timer = useRef(null);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const start = useCallback(
    (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        onLongPress();
      }, ms);
    },
    [onLongPress, ms, cancel]
  );
  useEffect(() => cancel, [cancel]);
  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e) => e.preventDefault(),
  };
}

// Hide the mouse cursor after a few seconds without movement.
export function useIdleCursor(ms = 3000) {
  useEffect(() => {
    let timer;
    const show = () => {
      document.body.classList.remove('cursor-hidden');
      clearTimeout(timer);
      timer = setTimeout(() => document.body.classList.add('cursor-hidden'), ms);
    };
    const events = ['mousemove', 'mousedown', 'touchstart', 'keydown', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, show, { passive: true }));
    show();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, show));
      document.body.classList.remove('cursor-hidden');
    };
  }, [ms]);
}

// Subscribe to an allow-listed main-process event.
export function useElibEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => api.on(event, (payload) => ref.current(payload)), [event]);
}

// Call `onIdle` after `ms` of no user input (used to auto-lock the parent dashboard).
export function useInactivity(onIdle, ms) {
  const ref = useRef(onIdle);
  ref.current = onIdle;
  useEffect(() => {
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ref.current(), ms);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [ms]);
}
