import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@echos/ui/styles.css';
import { I18nProvider } from './i18n/index.js';
import { ThemeProvider } from './theme/index.js';
import { App } from './App.js';

declare const __COMMIT_HASH__: string;
console.log(`[ECOS] commit: ${__COMMIT_HASH__}`);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter basename="/echos-data-capture">
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
