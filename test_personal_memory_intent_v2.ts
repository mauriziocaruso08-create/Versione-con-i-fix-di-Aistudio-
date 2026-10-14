import { parsePersonalFactStatement } from './src/services/learning/preferenceManager';

const cases = [
  ['Il mio colore preferito è il verde', 'colore_preferito', 'verde'],
  ['La mia squadra preferita è il Milan', 'squadra_preferita', 'Milan'],
  ['Il mio animale preferito è il gatto', 'animale_preferito', 'gatto'],
];

for (const [input, key, value] of cases) {
  const result = parsePersonalFactStatement(input);
  if (!result.isPersonalFact || result.key !== key || result.value !== value) {
    throw new Error(`FAIL: ${input} -> ${JSON.stringify(result)}`);
  }
}

if (parsePersonalFactStatement('Oggi sono stanco').isPersonalFact) {
  throw new Error('FAIL: temporary/casual statement was classified as persistent personal fact');
}

console.log('PASS: generic personal-fact parser');
