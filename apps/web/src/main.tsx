import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from './config';
import { HomePage } from './pages/HomePage';
import './index.css';

document.title = APP_NAME;

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <HomePage />
  </StrictMode>,
);
