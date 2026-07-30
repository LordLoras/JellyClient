import '@fontsource-variable/manrope';
import '@fontsource-variable/newsreader';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProbeApp } from './ProbeApp.js';
import { SetupApp } from './SetupApp.js';
import './styles.css';

const isSetup = window.location.pathname.replace(/\/+$/, '') === '/setup';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSetup ? <SetupApp /> : <ProbeApp />}
  </StrictMode>
);
