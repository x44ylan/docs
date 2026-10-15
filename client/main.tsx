import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import './app.css';
import { prefetch } from './api.ts';
import { Home } from './pages/home.tsx';
import { useTheme } from './theme.ts';

// Opening a vault directly: fetch its tree and note while the editor code loads.
{
    const match = /^\/vaults\/(\d+)\/?$/.exec(location.pathname);
    const file = new URLSearchParams(location.search).get('file');
    if (match && file && /^\d+$/.test(file)) {
        prefetch(`/vaults/${match[1]}`);
        prefetch(`/vaults/${match[1]}/nodes/${file}`);
    } else if (match) prefetch(`/vaults/${match[1]}?open`);
}

// A tab opened before a deploy asks for code files that no longer exist.
// Reload once to pick up the new version instead of showing a blank page.
function load<T>(importer: () => Promise<T>): Promise<T> {
    return importer().catch(error => {
        const key = 'docs-reloaded';
        if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, String(Date.now()));
            location.reload();
            return new Promise<T>(() => {});
        }
        throw error;
    });
}
addEventListener('vite:preloadError', event => { event.preventDefault(); void load(() => Promise.reject(new Error('stale'))); });
setTimeout(() => sessionStorage.removeItem('docs-reloaded'), 10_000);

// Home paints from the small entry bundle; the editor and share page load on demand.
const VaultPage = lazy(() => load(() => import('./pages/vault.tsx')).then(m => ({ default: m.VaultPage })));
const Share = lazy(() => load(() => import('./pages/share.tsx')).then(m => ({ default: m.Share })));
const page = (element: React.ReactNode) => <Suspense fallback={<div className="h-[60px] border-b" />}>{element}</Suspense>;

const router = createBrowserRouter([
    { path: '/', element: <Home /> },
    { path: '/vaults', element: <Home /> },
    // Each vault is one page; switching notes never reloads.
    { path: '/vaults/:vault', element: page(<VaultPage />) },
    { path: '/share/:token', element: page(<Share />) },
    { path: '*', element: <Home /> },
]);

// Start fetching the editor while the user is still on home.
requestIdleCallback?.(() => void import('./pages/vault.tsx'));

function App() {
    const { dark } = useTheme();
    return (
        <>
            <RouterProvider router={router} />
            <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" toastOptions={{ className: 'text-sm' }} />
        </>
    );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
