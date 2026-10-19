import { createRoot } from 'react-dom/client';
import { App } from './App';
import 'katex/dist/katex.min.css';
import './styles/tokens.css';
import './styles.css';
import './editor/page-toolbar.css';
import './editor/block-command-icons.css';
createRoot(document.getElementById('root')!).render(<App/>);
