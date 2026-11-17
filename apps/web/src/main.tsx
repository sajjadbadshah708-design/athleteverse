import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { AuthProvider } from './auth/AuthProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ApiProvider>
  </StrictMode>,
);
