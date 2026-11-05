import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The Rust binary serves web/dist; in development Vite serves the UI and
// forwards /api to the binary.
export default defineConfig({
  plugins: [svelte()],
  build: { target: 'es2022', assetsInlineLimit: 0 },
  server: { proxy: { '/api': 'http://127.0.0.1:4790' } },
});
