// Safeguard performance.measure against React 19 logComponentRender DataCloneError
if (typeof window !== 'undefined' && window.performance && typeof window.performance.measure === 'function') {
  try {
    const nativeMeasure = window.performance.measure.bind(window.performance);
    window.performance.measure = function(name: string, startOrOptions?: any, endMark?: string) {
      try {
        return nativeMeasure(name, startOrOptions, endMark);
      } catch (err: any) {
        if (err && (err.name === 'DataCloneError' || err.code === 25 || String(err).indexOf('clone') !== -1 || String(err).indexOf('memory') !== -1)) {
          try {
            if (typeof startOrOptions === 'object' && startOrOptions !== null) {
              const safeOptions = { ...startOrOptions };
              delete safeOptions.detail;
              return nativeMeasure(name, safeOptions, endMark);
            }
          } catch (_) {}
          try {
            return nativeMeasure(name);
          } catch (_) {}
          return undefined as any;
        }
        return undefined as any;
      }
    };
  } catch (_) {}
}

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { scrubBloatedLocalStorageOnce, syncMemoryStoreFromStorageEvent } from './services/storageSafe';

if (typeof window !== 'undefined') {
  scrubBloatedLocalStorageOnce();

  window.addEventListener('storage', (ev) => {
    syncMemoryStoreFromStorageEvent(ev.key);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const msg = String(reason?.message || reason || '');
    if (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError when attempting to fetch resource') ||
      msg.includes('Load failed') ||
      msg.includes('QuotaExceededError')
    ) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

