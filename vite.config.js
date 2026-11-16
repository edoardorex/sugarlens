import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [{
    name: 'sugarlens-offline',
    apply: 'build',
    generateBundle(_options, bundle) {
      const worker = readFileSync(new URL('./src/service-worker.js', import.meta.url), 'utf8');
      const manifest = readFileSync(new URL('./public/manifest.webmanifest', import.meta.url), 'utf8');
      const staticFiles = ['./index.html', './public/icon.svg', './public/icon-192.png', './public/icon-512.png']
        .map((file) => readFileSync(new URL(file, import.meta.url)));
      const assets = [...new Set([
        './', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
        ...Object.keys(bundle).map((file) => `./${file}`),
      ])];
      const version = createHash('sha256')
        .update(worker + manifest + Object.values(bundle).map((item) => item.code ?? item.source).join(''));
      staticFiles.forEach((file) => version.update(file));
      this.emitFile({
        type: 'asset',
        fileName: 'service-worker.js',
        source: worker.replace('__CACHE_VERSION__', version.digest('hex').slice(0, 16)).replace('"__PRECACHE_ASSETS__"', JSON.stringify(assets)),
      });
    },
  }],
});
