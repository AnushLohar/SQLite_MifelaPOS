import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { builtinModules } from 'module';
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  base: './',
  root: '.',

  plugins: [
    {
      name: 'remove-preload-tags',
      transformIndexHtml(html) {
        return html.replace(/<link\s+rel="(module)?preload"[^>]*>/gi, '');
      }
    },
    obfuscatorPlugin({
      // Only obfuscate frontend assets; backend is handled by the dedicated npm script
      include: ['src/**/*.js', 'src/**/*.ts'],
      exclude: [/node_modules/, /dist/, /electron/, /electron-dist/],
      apply: 'build',
      debugger: false,
      options: {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.2,
        deadCodeInjection: false,
        disableConsoleOutput: true,
        identifierNamesGenerator: 'hexadecimal',
        numbersToExpressions: false,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.5
      }
    })
  ],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // 🚀 THE FIX: Merged the native hardware modules into the primary external array
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
        'usb', 'serialport', 'chokidar', 'electron-updater'
      ],
      output: {
        inlineDynamicImports: false,
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },

  server: {
    port: 5173,
    strictPort: true
  },

  optimizeDeps: {
    exclude: ['usb', 'serialport', 'chokidar', 'electron-updater']
  }
});