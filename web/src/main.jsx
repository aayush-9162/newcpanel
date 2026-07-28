import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthProvider.jsx';
import './index.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

// Honor saved theme preference; default to light if nothing saved.
const saved = localStorage.getItem('theme');
if (saved === 'dark') document.documentElement.classList.add('dark');
else document.documentElement.classList.remove('dark');

// StrictMode is intentionally OFF: it double-invokes effects in dev, which
// breaks keycloak-js's "init can only run once per instance" guarantee.
ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </AuthProvider>,
);
