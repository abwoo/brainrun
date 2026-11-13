/** PR5 local-only browser test entrypoint, not linked from public site. */
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {I18nProvider} from './lib/i18n';
import LocalBEMLab from './components/LocalBEMLab';
import './App.css';
const element=document.getElementById('root');
if(!element)throw new Error('Missing local BEM test root');
createRoot(element).render(
  <StrictMode><I18nProvider><LocalBEMLab onClose={()=>{}}/></I18nProvider></StrictMode>
);
