# MAIA V7 — Release Candidate

## Scope
V7 is the pre-AI-Studio validation baseline. It prioritizes correctness and recovery over new UI features.

## Stabilized areas
- Semantic Intent Engine and local capability routing
- SessionContext TTL and contextual follow-ups
- Target resolution for pronouns, ordinals, recent references and explicit IDs
- Notes creation/list/update/delete flows
- Reminder creation, parsing, update/delete/complete flows
- Natural-language reminder date/time extraction
- Memory persistence and preference confirmation
- Verify → Recovery → Report execution model
- New Chat isolation from persistent Notes/Reminders/Memory
- Protection against stale targets and deleted references

## Final hardening in V7 RC
- Fixed a real TypeScript syntax error in `ReminderCapability` caused by unescaped apostrophes in single-quoted strings.
- `loadUserMemory()` now returns a fresh empty object instead of the shared `DEFAULT_USER_MEMORY` object, preventing accidental mutation of global defaults.
- Notes loaded from storage are normalized, invalid timestamps are rejected, empty text is rejected, and duplicate IDs are discarded.
- Reminders loaded from storage are normalized and duplicate IDs are discarded.

## Verification performed
- Full TypeScript parse/check was executed with the project compiler.
- The compiler reached dependency/type-environment resolution and reported only the missing `vite/client` type definition because npm dependencies are not installed in this offline workspace.
- The previous syntax errors in `ReminderCapability` are gone.
- Existing regression test files are retained in the archive for execution in AI Studio/npm environment.

## Not claimed yet
A full `vite build` has NOT been claimed as passing because the project's npm dependencies are unavailable in this workspace. Runtime browser tests, Gemini requests, speech APIs and notification APIs still require execution in the actual AI Studio/browser environment.

## AI Studio gate
Stop structural changes after V7 RC unless a concrete regression is discovered. Import/sync this baseline into AI Studio and perform the real runtime torture test before adding new architecture or UI features.
