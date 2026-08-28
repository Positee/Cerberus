import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { GO_TO, isTyping } from './shortcuts';

/**
 * Listens for the shortcuts.
 *
 * A "go to" is two presses, so the first one is remembered for a moment. The
 * window is short on purpose. Holding g open for ever would swallow the next
 * letter somebody types a second later.
 */

/** How long g waits for its second letter. */
const CHORD_MS = 1200;

type Handlers = {
  onHelp: () => void;
  onToggleRail: () => void;
  /** Fires on a page that makes things. Returns false when it does nothing. */
  onCreate: () => boolean;
};

export function useShortcuts({ onHelp, onToggleRail, onCreate }: Handlers): void {
  const navigate = useNavigate();
  const location = useLocation();

  // A ref rather than state. Re-rendering on every g press would be waste, and
  // the handler needs the value at the moment the next key arrives.
  const pending = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Never steal a keystroke from a field.
      if (isTyping(event.target)) return;

      // A modifier means the browser or the operating system owns it, except
      // for the ones this app claims by name.
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const key = event.key;

      // Waiting on the second half of a chord.
      const held = pending.current;
      if (held && Date.now() - held.at < CHORD_MS) {
        pending.current = null;
        const to = GO_TO[key.toLowerCase()];
        if (to) {
          event.preventDefault();
          navigate(to);
        }
        return;
      }
      pending.current = null;

      if (key === 'g') {
        pending.current = { key: 'g', at: Date.now() };
        return;
      }

      if (key === '?') {
        event.preventDefault();
        onHelp();
        return;
      }

      if (key === '[') {
        event.preventDefault();
        onToggleRail();
        return;
      }

      if (key === '/') {
        event.preventDefault();
        const box = document.querySelector<HTMLInputElement>('.topbar-search input');
        box?.focus();
        return;
      }

      if (key === 'u') {
        event.preventDefault();
        navigate(-1);
        return;
      }

      if (key === 'c') {
        // Only swallow the key when the page actually makes something.
        if (onCreate()) event.preventDefault();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate, onHelp, onToggleRail, onCreate]);

  // Moving to another page drops a half finished chord, so g on one page never
  // completes on the next.
  useEffect(() => {
    pending.current = null;
  }, [location.pathname]);
}
