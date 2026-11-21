# Changelog

## 0.1.0-beta.12 — 2026-11-21

- Add explicit numeric-leaf plot-log conversion against an unguarded, already owned baseline; require one strict JSON block and disjoint set/bump paths.
- Reject overlap, multi-block ambiguity, digit-leading keys, complex values, aliases and unsupported push/del/guards; preserve numeric set type locks.
- Bound input traversal before recursion and reject accessors without invoking them. This is a strict value-conversion subset, not a v1 host/runtime replacement.

## 0.1.0-beta.11 — 2026-11-21

- Add explicit bounded upstream State2 message-WAL replay into a confirmed current baseline, retaining text/call order and declared root scope.
- Validate internal operations and fingerprints; reject entries that cannot fully execute under Bridge's stricter constraints rather than silently importing partial state.
- Do not migrate original floor identities, all swipe branches, checkpoints or executable legacy protocols.
- Add root-claim ordering, internal pop, malformed-record and readonly rejection regressions.

## 0.1.0-beta.10 — 2026-11-21

- Add explicit preview/confirmation for Bridge state backup restoration and selected-root upstream current snapshots, preserving readonly rules.
- Add bounded strict State2 history replay into a new current-turn baseline, with source hashes and versions rechecked before commit.
- Restore independently of an invalid prior lineage; treat the migrated current version as an idempotent baseline.
- Reject plot-log/varevent replay rather than silently omitting legacy side effects; document unsupported full WAL/swipe migration and native global macro hooks.
- Keep state restoration separate from per-turn memory and require a fresh preview after state/version/activity changes.

## 0.1.0-beta.9 — 2026-11-21

- Scope merge review choices by game and candidate token; allow reselecting ordinary additions and remove duplicate gated-fact checkboxes.
- Preserve newer pending candidates when an adopted older token is retried after restart.
- Keep expired/stale statuses stable across repeated reads and expose same-fact core/trend metadata changes as reviewable conflicts.
- Strengthen restart adoption tests to assert newly saved content, and exercise long candidate review layouts on mobile Chromium.
- Correct long-history claims: the 10,000-record internal guard does not override the pinned host's 2,000-record/8 MiB per-game storage limits or full-lineage scan cost.

## 0.1.0-beta.8 — 2026-11-19

- Extend the restricted template reader for common LittleWhiteBox legacy bracket paths such as `人物[名字]`, quoted-key paths such as `人物["名字"]`, and array paths such as `A[0].name`.
- Trim harmless macro-name/path whitespace while continuing to reject expressions, negative indices, unsafe keys, write macros and global-variable macros.
- Keep expansion confined to the user's explicit plugin template; do not rewrite cards, world books or presets.
- Add macro and client regression coverage for the compatibility subset and its rejection boundaries.

## 0.1.0-beta.7 — 2026-11-19

- Persist complete summary candidates and merge previews in per-game plugin settings for up to 15 minutes.
- Restore pending candidates after page refresh or DSH restart; clear them on expiry, story-version change, base-memory revision change, adoption or discard.
- Keep adoption idempotent and revision-checked; a candidate cannot overwrite memory edited or imported after generation.
- Add restart, expiry, stale-version, concurrent-memory-change and duplicate-adoption regression tests.

## 0.1.0-beta.6 — 2026-11-19

- Generate memory proposals against the current portable-memory baseline and show additions, retained entries, and potential conflicts before adoption.
- Preserve existing entries omitted by a summary; never replace the saved memory with the model proposal.
- Require explicit per-item selection to add same-character/category facts or replace changed keyed entries; default conflicts keep existing values.
- Recheck the baseline revision and story version at adoption; stale candidates cannot overwrite intervening imports or edits.
- Add deterministic merge, host, client and API integration coverage for proposal review and adoption.

## 0.1.0-beta.5 — 2026-11-19

- Remove the former 128-turn hard stop; preserve full parent-chain validation for rollback and backfilled-turn detection.
- Bound each state lineage at 10,000 records and keep existing state readable/exportable when the limit is reached.
- Add long-history regression coverage beyond 128 turns and update the documented limits.

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
