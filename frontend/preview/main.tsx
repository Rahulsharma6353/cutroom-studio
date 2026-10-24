import { createRoot } from 'react-dom/client';
import '@shared/styles/fonts';
import '@fontsource-variable/archivo/standard.css';
import '@fontsource-variable/archivo/standard-italic.css';
import { applyTheme, readTheme } from '../src/lib/theme';
import '@shared/styles/frame.css';
import '../src/styles/app.css';
import { App } from '../src/ui/App';

// The preview has no server: the editor plans changes locally with the same op contract.
window.__CUTROOM_OFFLINE__ = true;
applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(<App />);
