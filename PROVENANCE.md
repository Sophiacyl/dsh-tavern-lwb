# Provenance and modifications

**Based on LittleWhiteBox by biex**  
Original project: LittleWhiteBox（小白X） — https://github.com/RT15548/LittleWhiteBox

This independent third-party project is named **LWB Bridge**. It adapts selected data-level behavior to flizzywine DSH Tavern; it is not the original extension, a full compatibility layer, or an official upstream release.

## Reused sources

| Distributed path | Original path | Revision and changes |
| --- | --- | --- |
| `vendor/state2/parser.js` | `modules/variables/state2/parser.js` | LittleWhiteBox `707e03f2d7f75bb6588b29625b3bd61b6c4a7c5a`; standalone imports, strict parse failures, safe schema/YAML boundaries |
| `vendor/state2/json-input.js` | `modules/variables/state2/json-input.js` | Same revision; standalone imports and retained public operation validation |
| `vendor/state2/executor.js` | `modules/variables/state2/executor.js` | Same revision; per-execution rule factory and synchronous pre/post-operation boundaries |
| `vendor/state2/guard-core.js` | `modules/variables/state2/guard-core.js` | Same revision; isolated rules, bounded wildcard search and ancestor/type/readonly validation |
| `vendor/state2/semantic.js` | `modules/variables/state2/semantic.js` | Same revision; provenance header retained and standalone packaging |
| `vendor/js-yaml.mjs` | `libs/js-yaml.mjs` (js-yaml 4.1.0) | Same source revision; bounded parsing, rejection of aliases/tags/unsafe keys; MIT license preserved |

The exact upstream copyright, license and NOTICE are retained under `licenses/` and `vendor/`. All copied State2 sources have prominent modification headers. See [`vendor/README.md`](vendor/README.md) for technical changes.

## Independently authored adaptation

`host/`, `core/`, `memory/`, `index.mjs`, `client.js`, build scripts and tests are the published adaptation source. The synthetic portable-memory fixture in `tests/memory-core.test.mjs` is adapted from LittleWhiteBox `modules/story-summary/tests/summary-transfer.test.js` at the pinned revision, retaining the same original-author attribution and license terms. They implement DSH Tavern API wiring, bounded snapshots, portable-memory boundaries, scoped read macros, manual-summary submission and lifecycle UI. The portable-memory format and read-macro semantics intentionally interoperate with documented LittleWhiteBox data; they do not import its application entrypoint or browser/server host integration.

The host and UI use flizzywine DSH Tavern's public API. No Tavern or SillyTavern runtime source is bundled. The optional integration tests load fixed public Tavern checkouts locally; these dependencies are downloaded explicitly and remain outside the committed/distributed package. Tests and fixtures use synthetic data only.

## Publication constraints

- Publicly accessible source under the original license and additional terms; see [`LICENSE.md`](LICENSE.md).
- Prominent original-author/project credit in UI, README, source headers and community description.
- No private conversations, user cards, model credentials, screenshots from user devices, diagnostic logs, installed profile files or browser cache are part of this repository.
- No claim of full LittleWhiteBox support, guaranteed model behavior, original authorship of vendored code, or endorsement by biex / DSH / flizzywine.
