import { useEffect, useRef, useState } from 'react';

const INSET_THRESHOLD_PX = 10;

/**
 * 布局视口与 visualViewport 的垂直差（常见于移动端软键盘）。
 * rAF 合并 + 阈值，避免 resize/scroll 连发导致整页抖动。
 */
export function useVisualViewportInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      lastRef.current = 0;
      setInset(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    const apply = () => {
      const next = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      if (Math.abs(next - lastRef.current) < INSET_THRESHOLD_PX) return;
      lastRef.current = next;
      setInset(next);
    };

    const schedule = () => {
      if (rafRef.current) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = 0;
        apply();
      });
    };

    schedule();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  return inset;
}
