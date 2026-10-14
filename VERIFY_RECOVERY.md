# MAIA Verify & Recovery

## Rule
MAIA must never report an action as successful merely because execution returned without an exception. Capabilities own the postcondition verification of their storage/action. The Verify & Recovery layer adds a final safety boundary around capability execution.

## Recovery policy
- **READ** operations: if an unexpected exception occurs, MAIA retries once. A read retry cannot duplicate persistent user data.
- **CREATE / UPDATE / DELETE / COMPLETE** operations: no automatic retry after an unexpected exception. A write may have partially succeeded before throwing; retrying could create duplicates or apply a destructive action twice.
- Invalid capability results are converted to `FAILURE` rather than being treated as success.
- A failed operation produces an explicit failure result and is never written into `SessionContext` as `lastSuccessfulAction`.

## Pipeline
`Input → Intent → Target → Safety → Capability → DO → VERIFY → RECOVERY POLICY → REPORT → Context Update`

This layer does not redesign the UI and does not change Gemini behavior. It is deliberately provider-independent.
