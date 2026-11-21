// Offline asset generator: card art, title art and announcer voice lines via OpenRouter.
// Output goes to public/assets/ (served by Vite, copied into the build). The key is only
// read here at build time — the game itself just loads the finished files.
//
//   npm run assets                      generate everything that's missing
//   npm run assets -- --only=skeleton   just one asset (card id, "title", or voice id)
//   npm run assets -- --kind=voice      only cards | art | voice | music | sfx
//   npm run assets -- --force           regenerate even if the file exists
//   npm run assets -- --jobs=3          parallel requests (default 1; more needs more free credit)
//
// Models can be swapped with IMAGE_MODEL / VOICE_MODEL / VOICE env vars.
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { OpenRouterError } from '@openrouter/sdk/models/errors';
import { getClient } from './openrouter.mjs';
import { DEFAULT_CONFIG, ALL_CARDS, cardKind } from '../src/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'public/assets/';
const SRC = ROOT + '.data/asset-src/'; // full-size originals (gitignored), resized copies go to OUT
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'openai/gpt-image-2.6-flare';
const VOICE_MODEL = process.env.VOICE_MODEL || 'elevenlabs/eleven-v3';
const VOICE = process.env.VOICE || 'brian';
const MUSIC_MODEL = process.env.MUSIC_MODEL || 'google/lyria-3-pro-preview';
const SFX_MODEL = process.env.SFX_MODEL || 'bytedance-seed/seed-audio-1-0';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));

const STYLE = 'Stylized 3D mobile strategy game card art: chunky cartoon proportions, oversized head and hands, ' +
  'glossy hand-painted textures, soft studio lighting with a strong coloured rim light, rich saturated colours, ' +
  'clean readable silhouette, full character centred and facing three-quarters toward the viewer, ' +
  'simple soft gradient background, no text, no letters, no border, no card frame, no logo.';

const UNDEAD_LOOK = {
  skeleton: 'a grinning cartoon skeleton warrior with a rusty sword and a cracked round shield, glowing green eye sockets',
  zombie: 'a lanky sprinting zombie with torn clothes, green skin, arms flailing forward, mid-run',
  bats: 'a swarm of five small purple vampire bats with glowing red eyes, wings spread',
  pumpkin: 'a huge hulking brute with a carved glowing jack-o-lantern head, vines for arms, fists clenched',
  gargoyle: 'a stocky stone gargoyle with bat wings and cracked grey stone skin, crouched and snarling, moss in the cracks',
  ghost: 'a translucent pale-blue ghost with a wailing face and wispy tail, glowing softly, semi-transparent',
  mummy: 'a bandaged mummy with glowing yellow eyes, loose wrappings trailing, ancient gold amulet',
  golem: 'a massive iron golem made of riveted dark metal plates, glowing orange furnace core in its chest',
  horseman: 'a headless horseman in a tattered cloak riding a black skeletal horse, holding a flaming pumpkin aloft',
  dragon: 'a giant bone dragon made of skeletal bones with ghostly green fire inside its ribcage, wings spread wide',
};
const DEF_LOOK = {
  rifleman: 'a cheerful army rifleman in olive fatigues and helmet, aiming a rifle',
  sniper: 'a focused sniper in a ghillie hood, kneeling with a long scoped rifle',
  samurai: 'a heroic samurai in red lacquered armour holding a katana, ready stance',
  flamethrower: 'a burly soldier in a heat-proof mask with a flamethrower and fuel tanks, a burst of flame',
  grenadier: 'a stocky grenadier soldier with a bandolier of grenades, winding up to throw one',
  mgnest: 'a sandbag machine-gun nest with a heavy mounted machine gun and a gunner in a helmet',
  missile: 'a compact mobile missile launcher with a rack of red-tipped missiles on a tracked base',
  tank: 'a chunky little olive-green army tank with a big cannon and a commander poking out of the hatch',
  drone: 'a soldier with a tablet controller next to a small quadcopter combat drone hovering above',
  commander: 'a confident army commander with a peaked cap, medals and a flag, pointing forward',
};
const SAB_LOOK = {
  fog: 'a swirling thick magical fog cloud rolling over the ground, eerie purple-grey mist',
  emp: 'a crackling electromagnetic pulse orb with blue lightning arcs bursting outward',
  raise: 'a skeletal hand bursting out of a grave mound with green necromantic magic swirling around it',
  vigor: 'a glowing green potion flask with a skull emblem, dark necromantic energy and green sparks swirling out of it',
  warcry: 'a golden military bugle horn blasting a shockwave of golden light, heroic sparks and a small flag',
  shield: 'a glowing translucent blue energy dome shield over a small concrete military bunker',
  freeze: 'a jagged crystal of blue ice with frost spreading outward and snowflakes, icy mist',
  flare: 'a bright signal flare bursting into a radiant golden-white star in the night sky, its light sweeping away purple fog and shattering ice, revealing a faint ghost silhouette',
};

const CARDS = ALL_CARDS.map(id => {
  const kind = cardKind(id);
  const look = kind === 'undead' ? UNDEAD_LOOK[id] : kind === 'defender' ? DEF_LOOK[id] : SAB_LOOK[id];
  const theme = kind === 'undead' ? 'Spooky night palette with green necromantic glow.'
    : kind === 'defender' ? 'Heroic military palette with warm golden rim light, blue accents.'
    : 'Magical effect illustration, no character required.';
  return { id, file: `cards/${id}`, prompt: `${STYLE} Subject: ${look}. ${theme}`, aspect: '4:5', maxPx: 520 };
});
const ART = [{
  id: 'title', file: 'ui/title', aspect: '16:9', maxPx: 1920,
  prompt: 'Epic wide key art for a stylized 3D mobile tower-defence game. Night battlefield: on the left a fortified military ' +
    'bunker with sandbags, cheerful chunky soldiers, a tank and a samurai holding the line under a blue banner; on the right a horde of ' +
    'cartoon undead — skeletons, zombies, a pumpkin brute, ghosts and a giant bone dragon — pouring out of a glowing green crypt, ' +
    'a graveyard between them, big full moon, dramatic rim lighting, glossy hand-painted textures, rich saturated colours. ' +
    'Leave the centre-top area calm for a logo. No text, no letters, no logo.',
}];
const VOICES = [
  { id: 'start', text: '[shouting, rallying the troops] Battle stations, soldiers! Hold the line!' },
  // boss arrivals — the game picks a different one each time
  { id: 'wave', text: '[urgent warning] Here they come!' },
  { id: 'wave2', text: '[alarmed, shouting] Brace yourselves, something big is coming!' },
  { id: 'wave3', text: '[urgent] Incoming! Man the defenses!' },
  { id: 'wave4', text: '[tense, warning] Heads up, a monster is on the way!' },
  { id: 'wave5', text: '[shouting] They are sending the big ones now!' },
  { id: 'wave6', text: '[urgent, rallying] Look alive, soldiers! Here comes trouble!' },
  { id: 'wave7', text: '[grim, intense] The ground is shaking. Get ready!' },
  { id: 'escalation', text: '[low, menacing] The dead... grow stronger.' },
  { id: 'finalwave', text: '[shouting, epic] Final wave! The Bone Dragon rises!' },
  { id: 'overtime', text: '[intense, fast] Overtime! Finish them!' },
  { id: 'bunkerlow', text: '[alarmed, shouting] Bunker critical! Reinforce, now!' },
  { id: 'victory', text: '[triumphant, cheering] Victory! The line holds!' },
  { id: 'defeat', text: '[somber, slow] Defeat... the bunker has fallen.' },
  { id: 'tutorial', text: '[warm, encouraging] Welcome, Commander. Let me show you how to win.' },
];
// Background music (instrumental loops)
const MUSIC = [
  { id: 'menu', prompt: 'Instrumental only, no vocals. Bright, bouncy and catchy main-menu song for a colourful cartoon tower-defence game: a cheerful whistle-able lead melody on marimba and steel drums, plucky bass, light funky drums with hand claps, playful brass stabs and a little ukulele, happy and fun with a memorable hook, 118 bpm, steady energy so it loops seamlessly, about two minutes.' },
  { id: 'battle', prompt: 'Instrumental only, no vocals. Energetic battle music for a cartoon tower-defence game, soldiers versus undead: driving orchestral percussion and taiko, punchy brass stabs, playful spooky organ and choir accents, 128 bpm, steady intensity for looping, about two minutes.' },
  { id: 'final', prompt: 'Instrumental only, no vocals. Climactic final-wave boss music for a cartoon tower-defence game: huge choir, pounding drums, fast strings ostinato, heroic brass, dramatic and urgent, 150 bpm, steady intensity for looping, about two minutes.' },
];
// Short sound effects (names match Audio.play names)
const SFX = [
  ['rifle', 'a single punchy cartoon rifle gunshot, short and crisp'],
  ['mg', 'one very short machine gun shot, tight and snappy, no echo'],
  ['sniper', 'a powerful sniper rifle shot with a long echo crack'],
  ['cannon', 'a heavy tank cannon blast with deep boom'],
  ['missile', 'a rocket missile launch whoosh'],
  ['boom', 'a cartoon explosion, punchy boom with debris'],
  ['flame', 'a short burst of a flamethrower whoosh'],
  ['sword', 'a fast katana sword slash swoosh'],
  ['thump', 'a grenade launcher thump pop'],
  ['drone', 'a small drone zapping laser shot'],
  ['clang', 'a bullet ricochet clang off iron armour'],
  ['rattle', 'skeleton bones rattling and collapsing'],
  ['crumble', 'stone cracking and crumbling'],
  ['groan', 'a short cartoon zombie groan'],
  ['wail', 'a short eerie ghost wail'],
  ['gate', 'a magical portal whoosh with a spooky shimmer'],
  ['place', 'a soldier landing with sandbags thud and gear clank'],
  ['upgrade', 'a bright rising magical chime, three quick sparkling bell notes'],
  ['sell', 'coins jingling into a pouch'],
  ['bunker', 'a heavy impact hitting a concrete bunker, rumble'],
  ['fog', 'a deep spooky wind gust'],
  ['emp', 'an electric EMP blast zap with crackle'],
  ['raise', 'a necromantic magic spell rising whoosh with choir'],
  ['siren', 'a short air raid siren followed by jets flying over'],
  ['horn', 'a big war horn blast, battle start'],
  ['deny', 'a short low cartoon error buzz'],
  ['win', 'a short triumphant brass victory fanfare'],
  ['lose', 'a short sad descending trombone'],
  ['coins', 'a shower of gold coins reward jingle'],
].map(([id, d]) => ({ id, text: `Sound effect only, no speech, no voice, no music: ${d}.` }));

function want(kind, id) {
  if (args.kind && args.kind !== kind) return false;
  if (args.only && !String(args.only).split(',').includes(id)) return false;
  return true;
}
function existing(file) {
  const dir = OUT + file.slice(0, file.lastIndexOf('/'));
  const base = file.slice(file.lastIndexOf('/') + 1);
  return existsSync(dir) ? readdirSync(dir).find(f => f.replace(/\.[^.]+$/, '') === base) : undefined;
}
function describe(e) {
  if (e instanceof OpenRouterError) return `HTTP ${e.statusCode}: ${String(e.body).slice(0, 300)}`;
  return e.message;
}

const client = getClient();
let made = 0, skipped = 0, failed = 0, cost = 0;

async function genImage(a) {
  const res = await client.images.generate({
    imageGenerationRequest: {
      model: IMAGE_MODEL, prompt: a.prompt, aspectRatio: a.aspect, resolution: '1K',
      // OpenAI image models take format/quality; others (e.g. Seedream) reject them, so only send when supported
      ...(IMAGE_MODEL.startsWith('openai/') ? { outputFormat: 'webp', quality: process.env.IMAGE_QUALITY || 'medium' } : { outputFormat: 'png' }),
    },
  });
  const img = res.data?.[0];
  if (!img?.b64Json) throw new Error('no image in response');
  const ext = (img.mediaType || 'image/webp').split('/')[1].replace('jpeg', 'jpg');
  const src = `${SRC}${a.file}.${ext}`;
  writeFileSync(src, Buffer.from(img.b64Json, 'base64'));
  cost += res.usage?.cost ?? 0;
  // macOS sips: shrink to game size and save as JPEG (2 MB original → ~100 KB)
  execFileSync('sips', ['-Z', String(a.maxPx), '-s', 'format', 'jpeg', '-s', 'formatOptions', '84', src, '--out', `${OUT}${a.file}.jpg`], { stdio: 'ignore' });
  return `${a.file}.jpg`;
}

async function genVoice(v) {
  const stream = await client.tts.createSpeech({
    speechRequest: { model: VOICE_MODEL, voice: VOICE, input: v.text, responseFormat: 'mp3' },
  });
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const buf = Buffer.concat(chunks);
  if (buf.length < 1000) throw new Error(`audio too small (${buf.length} bytes): ${buf.toString('utf8').slice(0, 200)}`);
  writeFileSync(`${OUT}voice/${v.id}.mp3`, buf);
  return `voice/${v.id}.mp3`;
}

async function genMusic(m) {
  // Music models return audio only on the streaming chat endpoint
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Hold the Line (dev tools)' },
    body: JSON.stringify({ model: m.model || MUSIC_MODEL, modalities: ['text', 'audio'], stream: true, messages: [{ role: 'user', content: m.prompt }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const chunks = [];
  for (const line of (await res.text()).split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    let j; try { j = JSON.parse(line.slice(6)); } catch { continue; }
    if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 300));
    const a = j.choices?.[0]?.delta?.audio?.data; if (a) chunks.push(Buffer.from(a, 'base64'));
    if (j.usage?.cost) cost += j.usage.cost;
  }
  const buf = Buffer.concat(chunks);
  if (buf.length < 10000) throw new Error('no audio returned');
  writeFileSync(`${OUT}music/${m.id}.mp3`, buf);
  return `music/${m.id}.mp3`;
}

async function genSfx(v) {
  const stream = await client.tts.createSpeech({ speechRequest: { model: SFX_MODEL, input: v.text, responseFormat: 'mp3' } });
  const chunks = []; for await (const c of stream) chunks.push(c);
  const buf = Buffer.concat(chunks);
  if (buf.length < 1500) throw new Error(`audio too small (${buf.length} bytes)`);
  writeFileSync(`${OUT}sfx/${v.id}.mp3`, buf);
  return `sfx/${v.id}.mp3`;
}

async function run(kind, list, fn, fileOf) {
  const todo = list.filter(a => want(kind, a.id));
  const queue = [...todo];
  await Promise.all(Array.from({ length: Number(args.jobs) || 1 }, async () => {
    while (queue.length) {
      const a = queue.shift();
      if (!args.force && existing(fileOf(a))) { skipped++; continue; }
      for (let attempt = 1; ; attempt++) {
        try { const f = await fn(a); made++; console.log('  ✓', f); break; }
        catch (e) {
          // OpenRouter reserves credit per in-flight request; on a low balance, wait and retry
          const inFlight = e instanceof OpenRouterError && e.statusCode === 402 && String(e.body).includes('in_flight');
          if (inFlight && attempt < 4) { await new Promise(r => setTimeout(r, 8000 * attempt)); continue; }
          failed++; console.error('  ✖', a.id, '—', describe(e)); break;
        }
      }
    }
  }));
}

for (const d of ['cards', 'ui', 'voice', 'music', 'sfx']) { mkdirSync(OUT + d, { recursive: true }); mkdirSync(SRC + d, { recursive: true }); }
console.log(`Images: ${IMAGE_MODEL}   Voice: ${VOICE_MODEL} (${VOICE})   Music: ${MUSIC_MODEL}   SFX: ${SFX_MODEL}`);
await run('cards', CARDS, genImage, a => a.file);
await run('art', ART, genImage, a => a.file);
await run('voice', VOICES, genVoice, v => `voice/${v.id}`);
await run('music', MUSIC, genMusic, m => `music/${m.id}`);
await run('sfx', SFX, genSfx, v => `sfx/${v.id}`);

// manifest: lets the game know which files exist without 404 probing
const manifest = { cards: {}, ui: {}, voice: {}, music: {}, sfx: {} };
for (const d of Object.keys(manifest)) for (const f of readdirSync(OUT + d)) manifest[d][f.replace(/\.[^.]+$/, '')] = `assets/${d}/${f}`;
writeFileSync(OUT + 'manifest.json', JSON.stringify(manifest, null, 2));

console.log(`\nDone: ${made} generated, ${skipped} already there, ${failed} failed.${cost ? ` Image cost ≈ $${cost.toFixed(3)}` : ''}`);
if (failed) process.exit(1);
void DEFAULT_CONFIG;
