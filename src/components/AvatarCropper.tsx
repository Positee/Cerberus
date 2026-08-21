import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { AVATAR_SIZE } from '../../shared/api';

/**
 * The square crop dialog.
 *
 * The browser does the work. It draws the chosen picture into a canvas at
 * AVATAR_SIZE and hands back a small JPEG, so the API stores a few tens of
 * kilobytes and needs no image library.
 *
 * The stage is a fixed square. The picture always covers it, so a crop can
 * never contain an empty corner.
 */

/** The size of the crop stage on screen. The export scales up from this. */
const STAGE = 300;
const MAX_ZOOM = 4;
const QUALITY = 0.92;

type Point = { x: number; y: number };

type Props = {
  file: File;
  busy: boolean;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
};

export default function AvatarCropper({ file, busy, onCancel, onDone }: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const dragFrom = useRef<{ pointer: Point; offset: Point } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  /**
   * Reads the file.
   *
   * The alive flag matters. The cleanup releases the object URL, which aborts
   * a load still in flight and fires onerror. Without the flag, that abort
   * reports a broken file, and React runs every effect twice in development,
   * so the first pass would always report one.
   */
  useEffect(() => {
    let alive = true;
    const url = URL.createObjectURL(file);
    const element = new Image();

    setImage(null);
    setFailed(false);

    element.onload = () => {
      if (alive) setImage(element);
    };
    element.onerror = () => {
      if (alive) setFailed(true);
    };
    element.src = url;

    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Escape closes the dialog. A dialog that traps the user is worse than none.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  /** The scale at which the shorter side of the picture just fills the stage. */
  const baseScale = image ? STAGE / Math.min(image.naturalWidth, image.naturalHeight) : 1;
  const scale = baseScale * zoom;
  const shownWidth = image ? image.naturalWidth * scale : 0;
  const shownHeight = image ? image.naturalHeight * scale : 0;

  /** Keeps the picture over every edge of the stage. */
  const clamp = useCallback(
    (next: Point, width: number, height: number): Point => {
      const limitX = Math.max(0, (width - STAGE) / 2);
      const limitY = Math.max(0, (height - STAGE) / 2);
      return {
        x: Math.min(limitX, Math.max(-limitX, next.x)),
        y: Math.min(limitY, Math.max(-limitY, next.y)),
      };
    },
    [],
  );

  // A new zoom can leave an edge inside the stage, so the offset follows it.
  useEffect(() => {
    if (!image) return;
    setOffset((prev) => clamp(prev, shownWidth, shownHeight));
  }, [clamp, image, shownWidth, shownHeight]);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragFrom.current = { pointer: { x: event.clientX, y: event.clientY }, offset };
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const from = dragFrom.current;
    if (!from) return;
    const next = {
      x: from.offset.x + (event.clientX - from.pointer.x),
      y: from.offset.y + (event.clientY - from.pointer.y),
    };
    setOffset(clamp(next, shownWidth, shownHeight));
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    dragFrom.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  /** Arrow keys move the picture, so a pointer is not the only way in. */
  function nudge(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 20 : 5;
    const moves: Record<string, Point> = {
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
    };
    const move = moves[event.key];
    if (!move) return;

    event.preventDefault();
    setOffset((prev) => clamp({ x: prev.x + move.x, y: prev.y + move.y }, shownWidth, shownHeight));
  }

  function reset() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  /**
   * Paints the visible square into a canvas.
   *
   * Every value is in stage pixels, so the whole drawing is the stage scaled
   * up by one ratio. White sits under the picture, because JPEG holds no
   * transparency.
   */
  function apply() {
    if (!image) return;

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ratio = AVATAR_SIZE / STAGE;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);

    ctx.translate(AVATAR_SIZE / 2, AVATAR_SIZE / 2);
    ctx.scale(ratio, ratio);
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);
    ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

    canvas.toBlob(
      (blob) => {
        if (blob) onDone(blob);
      },
      'image/jpeg',
      QUALITY,
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onCancel()}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="crop-title">Set your picture</h3>
          <p>Drag the picture to move it. Use the slider to zoom.</p>
        </div>

        {/* A picture that arrived wins over an earlier failure. */}
        {failed && !image ? (
          <p className="modal-note">Cerberus cannot read that file. Choose a PNG, a JPEG, or a WebP picture.</p>
        ) : (
          <>
            <div
              className="crop-stage"
              ref={stageRef}
              style={{ width: STAGE, height: STAGE }}
              tabIndex={0}
              role="application"
              aria-label="Crop area. Use the arrow keys to move the picture."
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={nudge}
            >
              {image && (
                <img
                  src={image.src}
                  alt=""
                  draggable={false}
                  style={{
                    width: shownWidth,
                    height: shownHeight,
                    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                  }}
                />
              )}
              <div className="crop-mask" aria-hidden="true" />
            </div>

            <div className="crop-controls">
              <button
                type="button"
                className="ghost-icon-button"
                aria-label="Zoom out"
                disabled={busy}
                onClick={() => setZoom((v) => Math.max(1, Number((v - 0.1).toFixed(2))))}
              >
                <Minus size={15} aria-hidden="true" />
              </button>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                disabled={busy}
                aria-label="Zoom"
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <button
                type="button"
                className="ghost-icon-button"
                aria-label="Zoom in"
                disabled={busy}
                onClick={() => setZoom((v) => Math.min(MAX_ZOOM, Number((v + 0.1).toFixed(2))))}
              >
                <Plus size={15} aria-hidden="true" />
              </button>
              <button type="button" className="ghost-button" disabled={busy} onClick={reset}>
                <RotateCcw size={14} aria-hidden="true" />
                Reset
              </button>
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="back-button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="submit-button" disabled={busy || !image} onClick={apply}>
            {busy ? 'Saving' : 'Set picture'}
          </button>
        </div>
      </div>
    </div>
  );
}
