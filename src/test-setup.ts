/**
 * Test environment setup for bun:test.
 * Installs happy-dom globals into globalThis so @testing-library/react
 * and DOM-dependent code work in bun test.
 *
 * Also patches React.act for react-dom internals that call it in React 19
 * production builds (where it is not exported from the main bundle).
 *
 * Loaded via bunfig.toml [test] preload.
 */
import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://localhost/' });

// Install globals using Object.defineProperty to handle non-writable properties.
function installGlobal(key: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    // Property truly cannot be redefined — skip silently
  }
}

// Core DOM globals required by react-dom and DOM-dependent code
installGlobal('window', globalThis);
installGlobal('document', happyWindow.document);
installGlobal('navigator', happyWindow.navigator);
installGlobal('location', happyWindow.location);
installGlobal('history', happyWindow.history);
installGlobal('localStorage', happyWindow.localStorage);
installGlobal('sessionStorage', happyWindow.sessionStorage);

// DOM constructor globals
installGlobal('HTMLElement', happyWindow.HTMLElement);
installGlobal('Element', happyWindow.Element);
installGlobal('Node', happyWindow.Node);
installGlobal('Event', happyWindow.Event);
installGlobal('FocusEvent', happyWindow.FocusEvent);
installGlobal('KeyboardEvent', happyWindow.KeyboardEvent);
installGlobal('MouseEvent', happyWindow.MouseEvent);
installGlobal('CustomEvent', happyWindow.CustomEvent);
installGlobal('StorageEvent', happyWindow.StorageEvent);
installGlobal('MutationObserver', happyWindow.MutationObserver);
installGlobal('ResizeObserver', happyWindow.ResizeObserver);
installGlobal('IntersectionObserver', happyWindow.IntersectionObserver);

// Utility globals
installGlobal('getComputedStyle', happyWindow.getComputedStyle.bind(happyWindow));
/* eslint-disable @typescript-eslint/no-empty-function -- matchMedia stub; empty listeners intentional */
installGlobal('matchMedia', () => ({
  matches: false,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}));
/* eslint-enable @typescript-eslint/no-empty-function */
installGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
  happyWindow.setTimeout(() => cb(Date.now()), 0) as unknown as number,
);
installGlobal('cancelAnimationFrame', (id: number) =>
  happyWindow.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
);

// Patch React.act — React 19 production bundles don’t export `act`, but
// react-dom/test-utils wraps calls through React.act. We provide a minimal
// synchronous pass-through so renders don’t blow up.
// NOTE: tests use flushSync (react-dom) for synchronous rendering instead.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/dot-notation -- 'act' not in the React type, must use bracket access
  if (typeof React['act'] !== 'function') {
    // eslint-disable-next-line @typescript-eslint/dot-notation -- same
    React['act'] = function act(cb: () => unknown) {
      const result = cb();
      return result instanceof Promise ? result : Promise.resolve(result);
    };
  }
} catch {
  // silently skip if react isn’t available
}
