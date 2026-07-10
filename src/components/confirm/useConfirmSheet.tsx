/**
 * useConfirmSheet — a promise-returning confirm gate backed by ConfirmSheet.
 *
 * A view calls `ask(request)` and awaits a boolean: true when the operator taps
 * Confirm, false on Cancel/Escape/backdrop. The hook renders one sheet at a time
 * via the returned `element`, which the view drops anywhere in its tree.
 *
 *   const confirm = useConfirmSheet();
 *   // ...
 *   if (await confirm.ask({ title: 'Restore this checkpoint', tone: 'danger' })) {
 *     restore.mutate(checkpoint);
 *   }
 *   // ...
 *   return <div>{confirm.element}{/* ...view... *}</div>;
 *
 * The mutation runs after the sheet resolves and closes — exactly the shape of
 * the window.confirm() calls this replaces, so no busy state lives in the sheet.
 */
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { ConfirmSheet } from './ConfirmSheet';

export interface ConfirmRequest {
  title: string;
  target?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

export interface ConfirmSheetController {
  ask: (request: ConfirmRequest) => Promise<boolean>;
  element: ReactElement | null;
}

export function useConfirmSheet(): ConfirmSheetController {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  const ask = useCallback((next: ConfirmRequest): Promise<boolean> => {
    // A second ask while one is open resolves the first as cancelled — never
    // leave a dangling promise, and never stack two sheets.
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setRequest(next);
    });
  }, []);

  const element = request ? (
    <ConfirmSheet
      open
      title={request.title}
      target={request.target}
      description={request.description}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      tone={request.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { ask, element };
}
