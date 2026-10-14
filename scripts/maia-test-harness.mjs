#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';

const root = process.cwd();
const configPath = path.join(root, 'test-harness.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(name);

if (has('--list')) {
  console.log(config.regressionTests.join('\n'));
  process.exit(0);
}

const requested = getArg('--test');
const randomCount = Number(getArg('--random') || 0);
const seedArg = getArg('--seed');
let seed = seedArg ? Number(seedArg) : randomInt(1, 2147483647);
if (!Number.isInteger(seed) || seed < 1) seed = 1;

let tests = requested ? [requested] : [...config.regressionTests];
if (requested && !config.regressionTests.includes(requested)) {
  console.error(`[ERROR] Test is not promoted to regression: ${requested}`);
  process.exit(2);
}

function seededRandom() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

if (randomCount > 0) {
  const pool = [...tests];
  tests = [];
  while (pool.length && tests.length < randomCount) {
    const index = Math.floor(seededRandom() * pool.length);
    tests.push(pool.splice(index, 1)[0]);
  }
}

const tsx = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
if (!fs.existsSync(tsx)) {
  console.error('[ERROR] Dependencies are not installed. Run: npm install');
  process.exit(2);
}

const results = [];
const startedAt = new Date().toISOString();
console.log('============================================================');
console.log('MAIA TEST HARNESS');
console.log(`Mode: ${randomCount > 0 ? `RANDOM (${tests.length})` : requested ? 'SINGLE' : 'FULL REGRESSION'}`);
console.log(`Seed: ${seedArg || seed}`);
console.log(`Tests: ${tests.length}`);
console.log('============================================================\n');

for (const test of tests) {
  const testPath = path.join(root, test);
  if (!fs.existsSync(testPath)) {
    results.push({ test, status: 'ERROR', exitCode: null, durationMs: 0, reason: 'file not found' });
    console.error(`✗ [ERROR] ${test} — file not found`);
    continue;
  }
  const started = Date.now();
  const run = spawnSync(tsx, [testPath], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, MAIA_TEST_MODE: '1' }
  });
  const durationMs = Date.now() - started;
  let status = 'PASS';
  let reason = '';
  if (run.error) {
    status = run.error.code === 'ETIMEDOUT' ? 'ERROR' : 'ERROR';
    reason = run.error.message;
  } else if (run.status !== 0) {
    status = 'FAIL';
    reason = `exit ${run.status}`;
  }
  results.push({
    test,
    status,
    exitCode: run.status,
    signal: run.signal,
    durationMs,
    reason,
    stdout: (run.stdout || '').slice(-12000),
    stderr: (run.stderr || '').slice(-12000)
  });
  const mark = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '!';
  console.log(`${mark} [${status}] ${test} (${durationMs}ms)`);
  if (status !== 'PASS') console.log((run.stderr || run.stdout || reason).slice(-3000));
}

const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  mode: randomCount > 0 ? 'random' : requested ? 'single' : 'full-regression',
  seed: seedArg ? Number(seedArg) : seed,
  total: results.length,
  passed: results.filter(r => r.status === 'PASS').length,
  failed: results.filter(r => r.status === 'FAIL').length,
  errors: results.filter(r => r.status === 'ERROR').length,
  results
};
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(root, 'test-results', 'last-run.json'), JSON.stringify(summary, null, 2));
console.log('\n============================================================');
console.log(`RESULT: PASS=${summary.passed} FAIL=${summary.failed} ERROR=${summary.errors} TOTAL=${summary.total}`);
console.log('Report: test-results/last-run.json');
console.log('============================================================');
process.exit(summary.failed || summary.errors ? 1 : 0);
