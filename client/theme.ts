import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const read = () => document.documentElement.classList.contains('dark');

export function setDark(dark: boolean) {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* private mode */ }
    const svg = document.getElementById('icon-svg') as HTMLLinkElement | null;
    const png = document.getElementById('icon-png') as HTMLLinkElement | null;
    if (svg) svg.href = dark ? './icon-dark.svg' : './icon-light.svg';
    if (png) png.href = dark ? './icon-dark.png' : './icon.png';
    listeners.forEach(listener => listener());
}

export function useTheme() {
    const dark = useSyncExternalStore(listener => (listeners.add(listener), () => listeners.delete(listener)), read);
    return { dark, toggle: () => setDark(!dark) };
}

// Tab title: the open note's name, or "Docs" on home.
export const title = (name?: string | null) => { document.title = name || 'Docs'; };
