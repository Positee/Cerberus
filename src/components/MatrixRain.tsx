import { useEffect, useRef } from 'react';

/**
 * Falling code rain behind the Cerberus.
 *
 * The canvas never clears. Each frame paints a low alpha wash of the page color
 * over the last frame. That wash is what makes the trail fade out.
 */

const GLYPHS =
  'アカサタナハマヤラワイキシチニヒミリウクスツヌフムユルエケセテネヘメレオコソトノホモヨロヲ' +
  '0123456789<>[]{}/\\=+*$#@%&!?;:';

const FONT_SIZE = 15;
/** Around 24fps. The classic rain is stepped, not smooth, and this costs less. */
const FRAME_MS = 42;

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

    let columns = 0;
    let drops: number[] = [];
    let speeds: number[] = [];
    let width = 0;
    let height = 0;

    function reset() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (!width || !height) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.font = `${FONT_SIZE}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx!.textBaseline = 'top';

      columns = Math.ceil(width / FONT_SIZE);
      // Start each column above the top edge so the rain arrives staggered.
      drops = Array.from({ length: columns }, () => -Math.random() * (height / FONT_SIZE));
      speeds = Array.from({ length: columns }, () => 0.32 + Math.random() * 0.5);

      ctx!.fillStyle = '#0B0314';
      ctx!.fillRect(0, 0, width, height);
    }

    function paint() {
      ctx!.fillStyle = 'rgba(11, 3, 20, 0.085)';
      ctx!.fillRect(0, 0, width, height);

      for (let i = 0; i < columns; i += 1) {
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;

        if (y > -FONT_SIZE && y < height) {
          // Two characters behind the head, dim purple.
          ctx!.fillStyle = 'rgba(88, 40, 140, 0.55)';
          ctx!.fillText(glyph(), x, y - FONT_SIZE * 2);
          // One character behind the head, brighter purple.
          ctx!.fillStyle = 'rgba(122, 63, 191, 0.8)';
          ctx!.fillText(glyph(), x, y - FONT_SIZE);
          // The head itself, teal.
          ctx!.fillStyle = '#2dd4bf';
          ctx!.fillText(glyph(), x, y);
        }

        drops[i] += speeds[i];
        if (y > height && Math.random() > 0.972) drops[i] = -2;
      }
    }

    reset();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // One still frame. No loop, no listeners.
      for (let i = 0; i < 26; i += 1) paint();
      return;
    }

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const observer = new ResizeObserver(reset);
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas className="matrix-rain" ref={canvasRef} aria-hidden="true" />;
}
