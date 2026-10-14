# MAIA AI Architecture — Provider Layer

## Goal
MAIA's identity and orchestration must not depend on Gemini. Providers are replaceable components behind a stable MAIA interface.

## Current flow

`UI → MAIA Orchestrator → local capabilities OR /api/chat → MAIA Model Router → AI Provider → model`

### Provider Manager + Model Router
- `ProviderManager` owns provider registration, availability and priority.
- `ModelRouter` delegates automatic provider selection to the manager.
- `automatic`: selects the highest-priority configured provider.
- `gemini`: explicitly selects Gemini.
- `mock`: test-only provider; never selected automatically unless explicitly selected.
- `MAIA_AI_ALLOWED_PROVIDERS`: optional comma-separated allow-list for automatic routing.

### Current providers
- Gemini: `gemini-3.8-flash` → `gemini-3.1-flash-lite` fallback.
- Mock: deterministic test provider.

### Future providers
The `AiProvider` interface is intentionally vendor-neutral, so OpenAI, Claude, Mistral, local models and custom endpoints can be added without changing MAIA's identity or the UI.

## Safety rule
No paid provider is enabled by this layer. A provider must be explicitly registered/configured before the router can use it.

## Environment
- `GEMINI_API_KEY`: Gemini credential.
- `MAIA_AI_MODE=mock`: enables the mock provider explicitly for development/testing.
- Default mode is `automatic`.
