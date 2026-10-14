# MAIA V7.1 — Cumulative Fix Candidate (13 October 2026, revision 3 — Neutral Baseline)

## Status

**Candidate only — not a release and not certified as fully fixed.** Revision 3 builds on the cumulative candidate derived from the user-provided `-Maia-V7.1-AIStudio-Test-main.zip`. Work was performed in an isolated copy. The canonical GitHub repository and the user's AI Studio project were not changed.

## Important audit finding: predefined personality was present

The previous `server.ts` system prompt explicitly instructed MAIA to be lively, direct, ironic, informal, to ban certain conventional phrases, to answer "a tono", and to use Sicilian dialect in selected contexts. This is a real predefined personality and could bias tests intended to verify whether MAIA changes its response style only after the user expresses a preference.

Revision 3 removes those fixed personality instructions and establishes a neutral first-install baseline. The baseline still requires factual accuracy, transparency about uncertainty, safe behavior, and context continuity; those are behavioral quality/safety requirements, not a preferred personality.

## Neutral-install changes in revision 3

- **System prompt (`server.ts`):** replaced the prescriptive personality/temperament, banter, informality, and dialect instructions with a neutral baseline. Style, tone, language, length, and formatting should adapt to the task, current request, or explicit saved user preferences.
- **Memory prompt (`server.ts`):** removed the instruction that saved facts must not alter MAIA's personality. Saved explicit communication preferences may now personalize responses, but cannot override the current request, safety, or factual accuracy. The prompt no longer tells MAIA to respond warmly or conversationally when a user shares a fact. The server now also passes machine-readable `structuredPreferences` (key, value, scope, and user wording) into the model context, instead of relying only on the legacy human-readable preference list.
- **Initial greeting (`src/App.tsx`):** removed the exuberant/technical branded greeting and replaced it with a neutral capability statement.
- **Tone selector (`src/components/SettingsModal.tsx`):** the existing persisted value `balanced` is retained for backward compatibility but is displayed as **Neutral**, with a description that no personality is imposed. Existing user-selected `concise`, `analytical`, and `creative` styles remain explicit opt-ins.
- **Fresh memory:** `DEFAULT_USER_MEMORY` remains empty for profile fields, preferences, interests, projects, notes, and structured preferences.
- **Guard test:** added `scripts/check-neutral-default.mjs` and `npm run test:neutral-default` to catch a return of the known hard-coded personality instructions or a non-neutral initial greeting/label.

The legacy storage key/value `balanced` is intentionally not renamed in persisted settings to avoid breaking older settings; its default UI meaning is now neutral. Existing saved user settings and memory are not erased by this patch.

## Other cumulative fixes retained from revision 2

### Reminders
- Date-only reminder requests are intended to ask for a clock time instead of silently assuming 09:00; the reminder must not be persisted before the time is clarified.
- Reminder task extraction strips leading and trailing date/time phrases, including date-time-first wording.
- Exact duplicate active reminders (normalized same task and exact same due timestamp) reuse the existing record instead of creating a second row.
- Local listing distinguishes active and completed reminders.

### Notes and target resolution
- Note append wording is represented as `APPEND`; the original title is retained and existing content is preserved.
- Update success is reported only after verifying the stored content and title.
- Generic note/reminder update and delete requests are resolved against local records; multiple matches require a local selection, with no mutation before selection.
- Explicit note-title lookup is routed to the local archive.

### Personal memory and preferences
- Profile deletion recognizes category requests such as `cancella il mio nome` / `cancella la città`, and exact stored values such as `cancella Malta`; confirmation and local storage verification remain required.
- Preference recognition includes natural formulations such as `Vorrei che tu fossi più articolata` and `Vorrei che tu fossi più diretta`.
- A combined explicit request for detailed and direct responses persists and verifies two separate structured preferences.
- Preference storage remains provider-independent; no personal values are hardcoded into the neutral system prompt.

### Projects and architecture
- Projects use the dedicated `maia_projects_v1` archive, separate from personal memory.
- Chat creation accepts natural forms including `Crea un progetto: Prova MAIA`, optional objectives, and duplicate prevention.
- Destructive Settings reminder deletion asks for confirmation and refreshes only after successful deletion.
- Core/capabilities remain provider-agnostic behind the existing provider/router interfaces. No second real provider is registered or activated; credentials, quotas, budget enforcement, and real failover remain deferred.

## Verification performed for revision 3

- **Neutral baseline audit: PASS** — `node scripts/check-neutral-default.mjs` verifies the neutral system prompt, neutral initial greeting, neutral UI label, empty default preference memory, and inclusion of structured saved preferences in the model context.
- **TypeScript/TSX syntax transpilation: PASS** — 73 files checked, zero syntax diagnostics.
- **Source scan: PASS** — no remaining instances of the identified hard-coded personality phrases were found in runtime `server.ts` or `src` source.
- **Regression harness: BLOCKED** — project-local `tsx` dependency is absent. Full regression suites could not be executed.
- **Full TypeScript type-check and production build: NOT VERIFIED** — project dependencies are incomplete.
- **AI Studio Preview end-to-end tests: NOT RUN** — still required after importing this ZIP as a separate test project.

## Audit of issues from the AI Studio tests

| Issue reported | Candidate status | Evidence still needed |
|---|---|---|
| Missing reminder time defaulted to 09:00 | Guard included | Preview: no reminder is stored until time is supplied |
| Reminder task polluted with date/time wording | Extraction fixes included | Preview with date-time-first and trailing-date variants |
| Duplicate reminders created | Exact text + due-time dedupe included | Preview: same time gives one row; different times remain distinct |
| Completed-reminder query included active items | Local completed/active filter included | Preview with one completed and one active reminder |
| Note update changed title or replaced instead of appended | Append mode and title/content verification included | Preview: title and old content remain intact |
| Profile deletion for name/city/Malta failed or falsely succeeded | Category/exact-value resolution and post-write verification included | Preview each command and inspect only the intended profile field |
| Articulated/direct response preferences did not save/retrieve | Natural-language parsing and compound persistence retained; revision 3 also injects structured saved preferences into the model context | Run focused regression and Preview save-then-query cycle |
| Project creation/count/list inconsistent | Dedicated archive and flexible chat create syntax included | Preview compare chat list, Settings/project view, and header count |
| Ambiguous target/continuation problems | Local resolver/selection flow included | Full regression and Preview multiple-match/resume scenario |
| Dirty second note / MEM-04 hardcoding concern | **Not certified fixed** | Reproduce exact original prompts and inspect stored note/source values |
| Predefined personality biases preference tests | **Identified and removed in revision 3** | Preview from a clean install: verify neutral greeting/default, then explicitly save preferences and compare before/after responses |

## Required Preview checks before promoting this candidate

1. Start from a clean Preview origin/profile with empty memory and verify the initial greeting and first answers do not assume directness, irony, Sicilian dialect, informality, or a fixed verbosity.
2. Before setting preferences, record baseline answers to a small fixed set of prompts. Then save a specific tone/detail preference, reload, and verify only the expected communication dimensions change. Test conflicting current-turn instructions too.
3. Verify date-only reminder asks for a time and leaves storage unchanged until the answer arrives.
4. Verify same task + same time creates one active record; same task + a different time creates a separate record.
5. Verify reminder text excludes date/time wording and completed-only listing excludes active records.
6. Verify append-to-note keeps title and previous content; ambiguous multi-note updates ask for a choice and resume against only the chosen ID.
7. Verify `cancella il mio nome`, `cancella la città`, and `cancella Malta` remove only the intended profile field after confirmation.
8. Save and query direct, articulated, and combined preferences; verify structured values persist after reload.
9. Create/list a project in chat, try a duplicate, and compare with the project counter/archive.
10. Reproduce the dirty-second-note and MEM-04 cases with the exact original prompts; do not close them without evidence.
11. Confirm Settings reminder deletion still requires confirmation and updates the visible list only after success.

**Do not promote or publish this candidate until blocked automated checks and the required Preview checks pass.**
