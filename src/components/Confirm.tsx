import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * The confirm dialog.
 *
 * Shown before anything that cannot be undone. It names the thing by its own
 * name, so a person reads what they are about to lose rather than the word
 * "item".
 *
 * The action button says the verb, never "OK". A person should be able to read
 * only the button and still know what happens.
 */

export type ConfirmRequest = {
  title: string;
  /** What happens, in one sentence. Say the consequence, not the mechanism. */
  body: string;
  /** The verb on the button, such as "Delete schedule". */
  action: string;
  /** True when the result cannot be undone. Colours the action. */
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
};

export default function Confirm({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus lands on Cancel, never on the destructive button. A stray Enter
  // should not delete anything.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function go() {
    setBusy(true);
    try {
      await request.onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="panel-scrim" aria-label="Cancel" onClick={() => !busy && onClose()} />
      <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-head">
          <span className={request.destructive ? 'confirm-mark danger' : 'confirm-mark'} aria-hidden="true">
            <TriangleAlert size={16} />
          </span>
          <h2 id="confirm-title">{request.title}</h2>
        </div>

        <p>{request.body}</p>

        <div className="confirm-actions">
          <button type="button" className="ghost-button" ref={cancelRef} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={request.destructive ? 'danger-button' : 'primary-button'}
            onClick={() => void go()}
            disabled={busy}
          >
            {busy ? 'Working' : request.action}
          </button>
        </div>
      </div>
    </>
  );
}
