# MAIA V7.1 — Cumulative Fix Candidate
Date: 14 October 2026

## Status
Candidate only. The user's Termux lint/type-check identified three TypeScript errors after the previous candidate was validated. This revision addresses those three errors in the candidate source. It has not been integrated into the canonical repository, committed, pushed, or uploaded to AI Studio.

## Fixes in this revision
1. `src/services/router/intentEngine.ts`: added the missing `PROJECT` entity lexicon entry required by `Record<SemanticEntity, LexiconEntry[]>`.
2. `src/services/router/maiaOrchestrator.ts`: narrowed the note/reminder union before selecting a display summary, using `title` for notes and `text` for reminders.
3. `test_final_regression.ts`: wrapped the compound preference assertion in `Boolean(...)` so the assertion receives a strict boolean rather than `boolean | undefined`.

## User-reported validation
- `npm run test:neutral-default`: PASS.
- `npm run lint` / `tsc --noEmit`: FAILED with the three errors above; these are the targeted fixes in this revision.

## Local validation limitations
The candidate ZIP is structurally valid. A local `tsc --noEmit` attempt cannot complete in this environment because dependencies/type definitions are absent (`TS2688: Cannot find type definition file for 'vite/client'`). Therefore this revision is **not yet certified**. Re-run the no-changes validator in Termux to verify the three fixes and continue with regression/build. If any new type errors appear, report the full output before making further changes.

## Required next checks
1. Re-run the validation script against this updated ZIP in Termux.
2. Confirm `npm run lint` passes.
3. Confirm the full regression suite and `npm run build` pass.
4. Perform the relevant AI Studio Preview tests before promoting the candidate.

No repository changes, commits, pushes, or AI Studio uploads were performed.
