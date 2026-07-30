import '@fontsource-variable/manrope';
import '@fontsource-variable/newsreader';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JellyfinApp } from './JellyfinApp.js';
import { JellyfinConnectApp } from './JellyfinConnectApp.js';
import { ProbeApp } from './ProbeApp.js';
import { SetupApp } from './SetupApp.js';
import './styles.css';
import './jellyfin.css';

const route = window.location.pathname.replace(/\/+$/, '') || '/';

const app = route === '/connect'
  ? <JellyfinConnectApp />
  : route === '/probe'
    ? <ProbeApp />
    : route === '/setup'
      ? <SetupApp />
      : <JellyfinApp />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {app}
  </StrictMode>
);
