# MAIA Intent Engine

The Intent Engine is the semantic front door of MAIA.

## Pipeline

`raw input → semantic normalization → verb/entity scoring → detailed extraction → target resolution`

The engine deliberately does **not** call an LLM and does not mutate storage. It recognizes meaning from lexical semantics first, then delegates to the existing deterministic classifier for precise payload, date/time, correction and target extraction.

This keeps the existing regression behavior while making MAIA less dependent on exact command wording.

### Examples

- `memorizza che devo comprare il pane` → CREATE + NOTE
- `metti un promemoria per domani` → CREATE + REMINDER
- `avvisami domani alle 9` → CREATE + REMINDER
- `elimina la seconda nota` → DELETE + NOTE
- `spiegami perché il cielo è blu` → EXPLAIN
- `mostrami le mie note` → READ + NOTE

Reserved entities such as CALENDAR and TASK are recognized semantically but remain non-local until their capabilities are implemented.
