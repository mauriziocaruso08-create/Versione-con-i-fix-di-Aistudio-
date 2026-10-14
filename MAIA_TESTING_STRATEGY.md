# MAIA Testing Strategy

This repository uses a layered validation model. Automation is a regression safety net, not a replacement for real validation.

## 1. Stable functionality — automatic regression

Anything already validated as working is placed in `test-harness.config.json` and executed automatically on every release check.

Purpose: detect regressions introduced by the latest version.

## 2. New fixes and new implementations — real validation first

A new fix or implementation is **not** considered stable because a test script passes.

Required sequence:

1. implement;
2. test in a real AI Studio project from the intended baseline;
3. verify actual storage/state/routing when relevant;
4. test interaction with existing functionality;
5. if PASS, add/promote the test to the automatic regression suite.

Promotion command:

```bash
npm run test:promote -- test_new_feature.ts
```

## 3. Bug classification

An automatic `FAIL` or `ERROR` is only a **candidate failure**.

It becomes an official MAIA bug only after manual reproduction in the real environment.

- `FAIL`: test executed and an assertion/exit failure occurred.
- `ERROR`: the test could not be reliably executed (timeout, missing file, runtime/tooling failure, etc.).

## 4. Random regression

`npm run test:random` selects a random subset of already promoted regression tests.

The harness prints the seed so the exact random selection can be reproduced with:

```bash
node scripts/maia-test-harness.mjs --random 5 --seed <seed>
```

## 5. Manual-only validation

The following remain manual by design:

- UI/layout/responsive behavior;
- Memory screen visual behavior;
- shortcuts/navigation;
- orb/animations;
- voice input/output quality;
- chat UX and wording quality;
- AI Studio Preview/runtime visual anomalies.

## 6. Release gate

`maia-check.sh` validates a candidate ZIP without modifying the official Git repository.

`maia-release.sh` runs the check, shows the change summary, asks for explicit human confirmation, then commits, pushes, and verifies the remote SHA.
