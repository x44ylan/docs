import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import './app.css';
import { Home } from './pages/home.tsx';
import { useTheme } from './theme.ts';

// Home paints from the small entry bundle; the editor and share page load on demand.
const VaultPage = lazy(() => import('./pages/vault.tsx').then(m => ({ default: m.VaultPage })));
const Share = lazy(() => import('./pages/share.tsx').then(m => ({ default: m.Share })));
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
