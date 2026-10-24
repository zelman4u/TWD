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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
