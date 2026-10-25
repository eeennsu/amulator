import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './site.css';

import { SiteHome } from './SiteHome';

const root = document.getElementById('root');
if (root === null) throw new Error('#root 요소를 찾을 수 없다');

createRoot(root).render(
  <StrictMode>
    <SiteHome />
  </StrictMode>,
);
