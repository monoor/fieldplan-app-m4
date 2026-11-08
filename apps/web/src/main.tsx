import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './styles.css';

const qc = new QueryClient({ defaultOptions: { queries: { retry: (n, e) => n < 2 && !(e as { status?: number }).status, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter><App /></BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// Offline app shell. Needs HTTPS (or localhost): browsers refuse service workers on plain http, where edits are still kept
// on the device but the app itself can't open without a connection.
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
