import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import { App } from './App';
import { AssistantProvider } from './components/ChatWidget';
import '@fontsource-variable/archivo/wdth.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AssistantProvider>
          <App />
        </AssistantProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
