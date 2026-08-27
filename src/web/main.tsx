import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const host = document.getElementById('root');
if (!host) throw new Error('#root missing from index.html');
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
