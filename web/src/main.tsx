import '@fontsource-variable/golos-text';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { SessionProvider } from './session.tsx';
import { ShopProvider } from './shop.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ShopProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ShopProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);

// PWA: faqat qurilgan versiyada (ishlab chiqishda kesh xalaqit beradi).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
