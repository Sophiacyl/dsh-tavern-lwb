# Changelog

## 0.1.0-beta.4 — 2026-11-15

- Prepare the first public test repository as **LWB Bridge**, keeping the existing package ID and storage formats.
- Display prominent original-author/project attribution in the UI and preserve the complete upstream COPYRIGHT with the distribution.
- Publish provenance, modification and same-license/source-disclosure notices.
- Make tests reproducible from a fresh checkout using development-only dependencies and fixed public Tavern references; exclude all local caches, profiles and user material.
- Add a community introduction template and reproducible local verification commands. No new model behavior or data migration is introduced. Cloud CI is not included in this publication.

## 0.1.0-beta.3 — 2026-11-15

- Validate complete bounded memory submissions before acknowledging success; aliases use from/to/evidence and invalid data receives repair feedback within the same task.
- Keep the first valid submission immutable; reject late or cancelled tool calls.
- Persist safe per-game summary lifecycle status and show it in the memory panel, including failure, cancellation, expiry and stale candidates.
- Allow read-only refresh while tasks are busy; retain state/memory formats and confirmation receipts.
- Exercise actual API 7/8 tool callback routing with invalid-then-repaired and invalid-only synthetic model paths.
- Correct earlier diagnosis: output splitting was a hypothesis, while screenshot-shaped alias rejection is independently reproducible.

## 0.1.0-beta.2 — 2026-11-15

- Summary agents submit memory JSON via a memory_submit tool call; a model that splits long output across messages no longer loses the candidate.
- Fallback text parsing kept for hosts without runTask tools.

## 0.1.0-beta.1 — 2026-11-15

- Fix mobile panel scrolling with a bounded outer viewport and safe bottom spacing.
- Add bounded LittleWhiteBox v1 portable memory preview/import/export and memory panel.
- Add explicitly confirmed manual summary tasks, reviewable candidates and version/cancellation checks.
- Persist model-action admission receipts to avoid charging twice for the same confirmation ID.
- Add three read-only xb macros within an explicit plugin template, not global card rewriting.
- Read alpha state rows unchanged; new records preserve separate state/memory fields under one serialized writer.
- Verify real Chromium mobile layout, public Tavern API 7/8 and migration/coexistence regressions.

## 0.1.0-alpha.1 — 2026-11-15

- First State2 verification package for flizzywine DSH Tavern API 7/8.
- Isolated rules, bounded data parser and immutable state execution.
- Explicit per-game enable, preview/initialize, after-settlement snapshots, duplicate receipts and lineage validation.
- React state panel with safe text rendering, stale-result rejection and JSON export.
- Synthetic core/host tests, actual public Tavern API integration and React/JSDOM checks.
- Memory enhancement and broad legacy-card compatibility are not included in this stage.
