// OpenRouter client for offline / build-time tools only.
// NEVER import this from src/ — the key must not end up in the browser bundle.
//
// Key lookup: the OPENROUTER_API_KEY environment variable, or a line
// `OPENROUTER_API_KEY=...` in .env.local at the project root (gitignored).
//
// Run the example request:   npm run ai:test
//   optional: OPENROUTER_MODEL=<slug> npm run ai:test   (slugs: https://openrouter.ai/models)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OpenRouter } from '@openrouter/sdk';
import { OpenRouterError } from '@openrouter/sdk/models/errors';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-5.5';

export function getClient() {
  const envFile = ROOT + '.env.local';
  if (!process.env.OPENROUTER_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set.\n' +
      '  1. Create a key at https://openrouter.ai/keys\n' +
      '  2. Put it in .env.local at the project root:  OPENROUTER_API_KEY=sk-or-...\n' +
      '     (or export it in your shell). Never commit it.');
  }
  return new OpenRouter({ apiKey, appTitle: 'Hold the Line (dev tools)' });
}

/** Send one prompt, return the reply text. Throws a readable Error on failure. */
export async function ask(input, { model = DEFAULT_MODEL, instructions } = {}) {
  const client = getClient();
  let res;
  try {
    res = await client.responses.send({ responsesRequest: { model, input, instructions } });
  } catch (e) {
    if (e instanceof OpenRouterError) {
      const hint = {
        400: 'bad request — check the model slug at https://openrouter.ai/models',
        401: 'invalid API key — check .env.local',
        402: 'out of credits — top up at https://openrouter.ai/credits',
        404: `model "${model}" not found — see https://openrouter.ai/models`,
        429: 'rate limited — wait and retry',
      }[e.statusCode] || 'request failed';
      throw new Error(`OpenRouter ${e.statusCode}: ${hint}\n  ${String(e.body).slice(0, 300)}`);
    }
    throw new Error(`Could not reach OpenRouter: ${e.message}`);
  }
  if (!('output' in res)) throw new Error('Expected a non-streaming response');
  if (res.status !== 'completed') throw new Error(`OpenRouter response ${res.status}: ${res.error?.message ?? 'unknown error'}`);
  const text = res.output.find(i => i.type === 'message')?.content.find(p => p.type === 'output_text')?.text;
  if (!text) throw new Error('OpenRouter returned no text output');
  return text.trim();
}

// Example request when run directly: an announcer line for the Final Wave.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Asking ${DEFAULT_MODEL}…`);
    const line = await ask(
      'Write one short, punchy announcer line (max 12 words) shouted when the Final Wave begins in "Hold the Line", a tower-defence game where undead attack a military bunker.',
      { instructions: 'Reply with the line only, no quotes.' });
    console.log('\n' + line);
  } catch (e) {
    console.error('\n✖ ' + e.message);
    process.exit(1);
  }
}
