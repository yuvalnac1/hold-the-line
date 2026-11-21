// Loads the generated asset manifest (made offline by tools/gen-assets.mjs).
// Everything is optional: if a file or the whole manifest is missing, the game
// falls back to its rendered 3D card portraits and has no announcer.
export const assets = { cards: {}, ui: {}, voice: {}, music: {}, sfx: {} };

const base = import.meta.env.BASE_URL;

export async function loadAssets() {
  try {
    const r = await fetch(base + 'assets/manifest.json', { cache: 'no-cache' });
    if (!r.ok) return assets;
    const m = await r.json();
    for (const k of Object.keys(assets)) for (const [id, path] of Object.entries(m[k] || {})) assets[k][id] = base + path;
    // warm the image cache so cards don't pop in
    for (const url of [...Object.values(assets.cards), ...Object.values(assets.ui)]) { const i = new Image(); i.src = url; }
  } catch { /* no generated assets — fine */ }
  return assets;
}
