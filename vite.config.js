import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' ca fișierele să meargă din orice folder de pe hosting (ex. public_html/calcul)
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { outDir: 'dist', sourcemap: false },
});
