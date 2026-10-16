import type { ReactNode } from 'react';
const paths: Record<string, ReactNode> = {
  trash: <><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  grip: <g fill="currentColor" stroke="none"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></g>,
  settings: <><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 2-1 3 1 2-2 3-1v-3l2-2-1-3-3-1-1-3Z"/><circle cx="11" cy="11" r="3"/></>,
  recent: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  collection: <><rect x="5" y="7" width="16" height="14" rx="2"/><path d="M3 17V5a2 2 0 0 1 2-2h12"/></>,
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 4h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>,
  person: <><path d="M20 21v-2a7 7 0 0 0-14 0v2"/><circle cx="13" cy="7" r="4"/></>,
  place: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  event: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-12 5h6"/></>,
  creativework: <path d="M12 5c-3-3-7-2-10-1v16c3-1 7-2 10 1 3-3 7-2 10-1V4c-3-1-7-2-10 1Zm0 0v16"/>,
  organization: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1m-4 6v-3h2v3"/></>,
  source: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h5"/>,
  page: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8m-8 4h8m-8 4h5"/></>,
  knowledge: <><circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m10 8-4 7m8-7 4 7M8 18h8"/></>,
  vault: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="4"/><path d="M12 8v2m0 4v2m-4-4h2m4 0h2"/></>,
};
export function Icon({name}: {name: string}) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.knowledge}</svg>;
}
