import type { ReactNode } from "react";

function SmallIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height="15"
      viewBox="0 0 24 24"
      width="15"
    >
      {children}
    </svg>
  );
}

export function AddIcon() {
  return (
    <SmallIcon>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" />
    </SmallIcon>
  );
}

export function CopyIcon() {
  return (
    <SmallIcon>
      <rect height="12" rx="1.5" stroke="currentColor" width="11" x="8" y="8" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" stroke="currentColor" />
    </SmallIcon>
  );
}

export function ReferenceIcon() {
  return (
    <SmallIcon>
      <path
        d="M9.5 14.5 14.5 9.5M7.2 16.8l-1.1 1.1a3.2 3.2 0 0 1-4.5-4.5l3.1-3.1a3.2 3.2 0 0 1 4.5 0M16.8 7.2l1.1-1.1a3.2 3.2 0 0 1 4.5 4.5l-3.1 3.1a3.2 3.2 0 0 1-4.5 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </SmallIcon>
  );
}

export function PlayIcon() {
  return (
    <SmallIcon>
      <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
    </SmallIcon>
  );
}

export function FileIcon() {
  return (
    <SmallIcon>
      <path d="M6 3.5h7l5 5V20.5H6z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M13 3.5v5h5" stroke="currentColor" strokeLinejoin="round" />
    </SmallIcon>
  );
}

export function FolderIcon() {
  return (
    <SmallIcon>
      <path d="M3.5 6.5h6l2 2H20.5v10h-17z" stroke="currentColor" strokeLinejoin="round" />
    </SmallIcon>
  );
}

export function SaveIcon() {
  return (
    <SmallIcon>
      <path d="M4 4h13l3 3v13H4z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" stroke="currentColor" strokeLinejoin="round" />
    </SmallIcon>
  );
}

export function PanelIcon() {
  return (
    <SmallIcon>
      <rect height="15" rx="2" stroke="currentColor" width="17" x="3.5" y="4.5" />
      <path d="M15 4.5v15" stroke="currentColor" />
    </SmallIcon>
  );
}

export function SunIcon() {
  return (
    <SmallIcon>
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" stroke="currentColor" strokeLinecap="round" />
    </SmallIcon>
  );
}

export function MoonIcon() {
  return (
    <SmallIcon>
      <path d="M19 15.5A7.5 7.5 0 0 1 8.5 5 7.5 7.5 0 1 0 19 15.5Z" stroke="currentColor" strokeLinejoin="round" />
    </SmallIcon>
  );
}

export function MonitorIcon() {
  return (
    <SmallIcon>
      <rect height="12" rx="1.5" stroke="currentColor" width="17" x="3.5" y="4.5" />
      <path d="M9 20h6M12 16.5V20" stroke="currentColor" strokeLinecap="round" />
    </SmallIcon>
  );
}
