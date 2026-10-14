# MAIA Core — Phase 1

MAIA Core is now the single client-side entry point for input processing.

## Pipeline

`User Input -> MAIA Core -> Semantic Orchestrator -> Capability/Local Action`

If the local pipeline returns `FALLTHROUGH_GEMINI`, Core sends the conversation to:

`MAIA Core -> /api/chat -> Model Router -> AI Provider -> Model`

The UI no longer decides which AI endpoint/provider to call.

## Provider separation

The server-side Model Router owns provider selection. Current providers:

- Gemini (real provider)
- Mock (test-only)

Future providers can implement `AiProvider` without changing MAIA Core or the UI.

## Safety rule

No paid provider is activated automatically. Automatic routing currently selects only configured real providers; if none are available, MAIA reports the provider error instead of silently spending money.
