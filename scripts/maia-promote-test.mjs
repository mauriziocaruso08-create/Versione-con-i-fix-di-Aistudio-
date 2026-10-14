#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run test:promote -- test_example.ts');
  process.exit(2);
}
const configPath = path.join(root, 'test-harness.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!fs.existsSync(path.join(root, file))) {
  console.error(`[ERROR] File not found: ${file}`);
  process.exit(2);
}
if (!file.startsWith('test_') || !file.endsWith('.ts')) {
  console.error('[ERROR] Only root-level test_*.ts files can be promoted automatically.');
  process.exit(2);
}
if (config.regressionTests.includes(file)) {
  console.log(`[OK] Already in regression suite: ${file}`);
  process.exit(0);
}
config.regressionTests.push(file);
config.regressionTests.sort();
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log(`[PROMOTED] ${file} -> automatic regression suite`);
