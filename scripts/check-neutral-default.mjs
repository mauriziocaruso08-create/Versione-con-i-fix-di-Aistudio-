import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const server = read('../server.ts');
const app = read('../src/App.tsx');
const settings = read('../src/components/SettingsModal.tsx');
const types = read('../src/types.ts');

const prompt = server.match(/const MAIA_SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1];
assert.ok(prompt, 'System prompt must exist');
for (const forbidden of [
  'personalità definita', 'Diretta e sincera', 'Ironica, spiritosa',
  'DIALETTO SICILIANO', 'approccio iniziale deve essere spontaneo',
  'amichevole, spigliata, ironica'
]) assert.ok(!prompt.includes(forbidden), `Hard-coded personality instruction remains: ${forbidden}`);
assert.match(prompt, /non hai una personalità.*predefiniti/i);
assert.match(prompt, /preferenza esplicita dell'utente salvata in memoria/i);
assert.match(server, /Applica le preferenze esplicite salvate su tono, livello di dettaglio/i);
assert.match(server, /memory\.structuredPreferences/);
assert.match(server, /Preferenze esplicite strutturate \(da applicare quando pertinenti\)/);
assert.match(app, /Sono \*\*MAIA\*\*, un assistente AI\./);
assert.doesNotMatch(app, /Pronta, su cosa lavoriamo oggi|a tono|ironica|Mizzica/);
assert.match(settings, /id: 'balanced', label: 'Neutral'/);
assert.match(settings, /No preset personality; adapts to the request and context/);
assert.match(types, /preferences: \[\]/);
assert.match(types, /structuredPreferences: \[\]/);
console.log('PASS: neutral first-install prompt, greeting, empty default memory and neutral tone label');
