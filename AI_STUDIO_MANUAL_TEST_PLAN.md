# MAIA — AI Studio Manual Validation Plan

Use this plan for every new fix or new implementation before promoting its test to automatic regression.

## A. Preparation

1. Create a new AI Studio project from the exact GitHub commit/version under test.
2. Start with zero memory unless the test explicitly requires persistence.
3. Record the version/commit SHA.
4. Do not classify an automatic failure as a real bug until reproduced here.

## B. Real validation checklist

For each new fix/feature:

- [ ] exact intended command works;
- [ ] at least 3 natural rephrasings work;
- [ ] conversational prefix does not break intent;
- [ ] follow-up/context variant works when relevant;
- [ ] storage/state is actually changed when the action is stateful;
- [ ] MAIA does not claim success when storage/state did not change;
- [ ] unrelated/generative request still routes correctly to the provider;
- [ ] ambiguity is handled safely;
- [ ] destructive action requires the intended confirmation;
- [ ] Reset Chat / Clear Memory semantics remain correct;
- [ ] no existing regression is observed;
- [ ] response is understandable and natural enough for the intended UX.

## C. Bug verification

When automation reports FAIL/ERROR:

1. reproduce the exact command in AI Studio;
2. repeat it once with the same state;
3. repeat with a natural variant if relevant;
4. inspect the actual persisted state;
5. classify as:
   - real bug;
   - false positive/stale test;
   - infrastructure/runtime error;
   - expected behavior requiring documentation.

## D. Promotion rule

Only after real validation passes:

```bash
npm run test:promote -- test_<feature>.ts
```

Then the test becomes part of the automatic regression suite for future versions.
