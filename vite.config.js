import { defineConfig } from 'vite';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// public/tuning.json holds the values changed in the developer menu. It overrides the defaults in
// src/config.js and is owned by the designer — code changes never edit it. In dev, the dev menu saves
// to it through this small endpoint; the built game just reads the file.
const TUNING = fileURLToPath(new URL('./public/tuning.json', import.meta.url));

export default defineConfig({
  server: { watch: { ignored: ['**/public/tuning.json'] } },   // saving must not reload the page mid-match
  plugins: [{
    name: 'save-tuning',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-tuning', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => {
          try {
            const obj = JSON.parse(body);
            writeFileSync(TUNING, JSON.stringify(obj, null, 2) + '\n');
            res.end('ok');
          } catch (e) { res.statusCode = 400; res.end(String(e.message)); }
        });
      });
    },
  }],
});
