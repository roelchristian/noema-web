import { createRoot } from 'react-dom/client';
import { useEffect, useRef } from 'react';
import './styles.css';
import { startWorkspace } from './workspace';
function App(){
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>startWorkspace(host.current!),[]);
 return <div ref={host} style={{display:'contents'}}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
