import type { ReactNode } from 'react';
const paths: Record<string, ReactNode> = {
  more: <g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></g>,
  edit: <><path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5"/></>,
  trash: <><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6M10 10v7m4-7v7"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  grip: <g fill="currentColor" stroke="none"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></g>,
  settings: <><path d="M18.93 9.13L21.85 10.26L21.85 13.74L18.93 14.87L18.93 14.87L20.19 17.74L17.74 20.19L14.87 18.93L14.87 18.93L13.74 21.85L10.26 21.85L9.13 18.93L9.13 18.93L6.26 20.19L3.81 17.74L5.07 14.87L5.07 14.87L2.15 13.74L2.15 10.26L5.07 9.13L5.07 9.13L3.81 6.26L6.26 3.81L9.13 5.07L9.13 5.07L10.26 2.15L13.74 2.15L14.87 5.07L14.87 5.07L17.74 3.81L20.19 6.26L18.93 9.13Z"/><circle cx="12" cy="12" r="3"/></>,
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
