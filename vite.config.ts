import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    root: 'client',
    // Relative URLs: the server answers `<any path>/assets/*` (see server/main.ts).
    base: './',
    publicDir: '../public',
    plugins: [react(), tailwind()],
    resolve: { alias: { '@': new URL('./client', import.meta.url).pathname } },
    // Safari 16.4+ (iPhones from 2023 on) as well as current Chrome/Firefox.
    build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 6000, target: ['es2022', 'safari16.4'] },
    server: { proxy: { '/api': 'http://127.0.0.1:3000', '/mcp': 'http://127.0.0.1:3000', '/sync': { target: 'ws://127.0.0.1:3000', ws: true } } },
});
