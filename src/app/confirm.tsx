import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import Confirm, { type ConfirmRequest } from '../components/Confirm';

/**
 * One confirm dialog for the whole workspace.
 *
 * A page calls ask() and passes what should happen. Without this, every page
 * that deletes something grows its own copy of the same dialog, and they drift.
 */

type ConfirmApi = { ask: (request: ConfirmRequest) => void };

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function useConfirm(): ConfirmApi {
  const api = useContext(ConfirmContext);
  if (!api) throw new Error('useConfirm needs a ConfirmProvider above it.');
  return api;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const ask = useCallback((next: ConfirmRequest) => setRequest(next), []);

  return (
    <ConfirmContext.Provider value={{ ask }}>
      {children}
      {request && <Confirm request={request} onClose={() => setRequest(null)} />}
    </ConfirmContext.Provider>
  );
}
