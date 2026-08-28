import { useEffect } from 'react';
import { X } from 'lucide-react';
import { GROUP_LABEL, shortcutsIn, type ShortcutGroup } from '../app/shortcuts';

/**
 * The shortcut list.
 *
 * It reads the same registry the handler reads, so nothing here can claim a
 * shortcut that does not work.
 */

const GROUPS: ShortcutGroup[] = ['go', 'do', 'edit'];

export default function Shortcuts({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" className="panel-scrim" aria-label="Close" onClick={onClose} />

      <div className="shortcuts" role="dialog" aria-label="Keyboard shortcuts" aria-modal="true">
        <header className="shortcuts-head">
          <div>
            <h2>Keyboard shortcuts</h2>
            <p>Press g then a letter to move around.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="shortcuts-body">
          {GROUPS.map((group) => (
            <section className="shortcuts-group" key={group}>
              <h3>{GROUP_LABEL[group]}</h3>
              <ul>
                {shortcutsIn(group).map((shortcut) => (
                  <li key={shortcut.id}>
                    <span className="shortcuts-keys">
                      {shortcut.keys.map((key, index) => (
                        <kbd key={`${shortcut.id}-${index}`}>{key}</kbd>
                      ))}
                    </span>
                    <span className="shortcuts-label">
                      {shortcut.label}
                      {/* A module that is not built yet says so, rather than
                          leaving somebody to find an empty card. */}
                      {shortcut.placeholder && <em>not built yet</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="shortcuts-foot">
          A shortcut never fires while you are typing in a field.
        </footer>
      </div>
    </>
  );
}
