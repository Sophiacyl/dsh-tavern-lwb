# Changelog

## 0.1.0-beta.53

- Add an internal WAL/swipe-to-write-plan builder with explicit targets, memory-preserving envelopes, parent-linked states, source/preimage/output digests and bounded plan sizes. Synthetic integration now exercises builder → persisted reload → coordinator → production record adapter. Public batch confirmation remains unregistered.

## 0.1.0-beta.52

- Add an internal, unconnected batch plan store with game/turn/version binding, 15-minute expiry, detached reload, digest checks and token-specific cleanup. Preserve unrelated game settings and refuse replacement of an outstanding plan. No public batch RPC is registered.

## 0.1.0-beta.51

- Extend synthetic record-storage verification to mid-batch memory conflicts and target-version switches. Confirm only the verified prefix remains and no later state suffix is written; production RPC remains unregistered.

## 0.1.0-beta.50

- Retain host-agnostic batch coordinator in the runtime package with explicit trust-boundary documentation. It remains unreferenced by the plugin entry point; no batch write RPC, persistent plan store, or cross-instance CAS is enabled.

## 0.1.0-beta.49

- Harden the unconnected batch history coordinator prototype: validate immutable plan digests, require exact continuous receipts, recheck preimages and source text before writes, and stop after uncertain acknowledgements with confirmed-prefix diagnostics. Explicit resume avoids repeating confirmed writes. No batch RPC is registered.

## 0.1.0-beta.48

- Extend read-only history target planning to dense explicit upstream WAL source records as well as swipe mappings. Keep each record mapped to an existing turn and current text version; reject null/missing WAL records; do not enable backfill writes.

## 0.1.0-beta.47

- Keep history-target-plan responses summary-only: remove the full replay engine and expose only the final per-prefix digest summary, preserving the no-write planning boundary.

## 0.1.0-beta.46

- Require a one-to-one mapping for every source swipe floor in read-only history planning. Validate selected records before reading them and reject unselected or unmapped source floors; verify the per-prefix summaries produce the identical final engine.

## 0.1.0-beta.45

- Add per-source-floor read-only state summaries to history target planning: source digest, replay state digest, root count and variable count. Full snapshots remain local to the preview and no write token is issued.

## 0.1.0-beta.44

- Add read-only history target mapping via migration-preview. Check explicit source floors against existing target turns and their current text versions without issuing a write token.

## 0.1.0-beta.43

- Bind migration preview to the exact current turn as well as version; reject wrong-turn or missing raw history material with a stale error before confirmation writes.

## 0.1.0-beta.42

- Refuse legacy plot-log and varevent markers in both State2 history initialization and replay, including the case and spacing accepted by upstream plus incomplete markers. Never silently replay only the State2 portion of mixed input.

## 0.1.0-beta.41

- Replay plot-log set on existing managed boolean roots. Compare against upstream persisted string values while preserving boolean values and type locks in Bridge snapshots.

## 0.1.0-beta.40

- Replay plot-log set on existing managed non-root booleans, honoring readonly and preserving boolean type locks. Accept the upstream true/false string spellings without coercing other values or enabling boolean bump.

## 0.1.0-beta.39

- Replay set/bump on existing managed finite numeric roots, with the same readonly, range and step guards. Do not create roots or coerce string-valued baselines.

## 0.1.0-beta.38

- Expand direct list items one level in numeric plot-log push to match the pinned upstream. Preserve deeper array values and count emitted values against the operation budget.

## 0.1.0-beta.37

- Accept plain JSON object items in explicit plot-log push lists for existing managed arrays. Preserve upstream reference-based matching instead of deduplicating distinct objects by content. Continue rejecting direct nested array items.

## 0.1.0-beta.36

- Preserve literal JSON null in plot-log push into existing managed root or nested scalar arrays. Deduplicate null separately from the string "null"; numeric set/bump behavior is unchanged.

## 0.1.0-beta.35

- Support push into existing managed root scalar arrays with the same explicit growth, readonly, ordering and deduplication rules as nested arrays. Keep root creation and scalar coercion unsupported.

## 0.1.0-beta.34

- Extend plot-log push to existing managed arrays of finite numbers, strings and booleans. Keep scalar types distinct during deduplication and preserve string text as-is.

## 0.1.0-beta.33

- Replay push into existing managed finite-number arrays only. An explicit array growth rule permits appending missing items in input order, without removing existing duplicates; locked and readonly arrays skip otherwise valid writes.

## 0.1.0-beta.32

- Accept a nonempty JSON array of operation objects within one numeric plot-log block, preserving set overwrite and ordered bump summation across its entries. Nested or malformed entries still reject the entire candidate.

## 0.1.0-beta.31

- Honor explicit readonly guards on existing plot-log numeric leaves: skip valid writes and preserve the rule without adding a type lock. Other valid operations in the message still replay.

## 0.1.0-beta.30

- Respect explicit existing numeric-leaf min/max/step in plot-log baseline rules, in the pinned v1 order and relative to message-start values. Preserve baseline constraints without applying State2 guards a second time. Inline guard directives remain unsupported.

## 0.1.0-beta.29

- Replay an explicitly ordered numeric plot-log message chain in one migration preview. Keep each message boundary and numeric lock state; reject the whole candidate if any message is invalid. Only the confirmed final baseline is stored.

## 0.1.0-beta.28

- Permit continuation from prior numeric-only `typeLock: number` leaves in explicit plot-log migration chains. Reject other guards and unbound lock paths.

## 0.1.0-beta.27

- Accept finite decimal strings for numeric plot-log set only when the pinned upstream would parse them as numbers; keep the set and bump string grammars distinct.

## 0.1.0-beta.26

- Accept an explicitly supplied single-message `source` instead of pre-extracted `blocks` in numeric plot-log migration. Require matched, attribute-free tags and strict JSON; reject malformed messages without partial replay. Do not scan live history.

## 0.1.0-beta.25

- Accept explicit finite decimal strings as numeric plot-log bump deltas, including signs, fractions and exponents. Keep other string forms outside the subset.

## 0.1.0-beta.24

- Merge fixed numeric plot-log operation aliases within one block: last set wins and bump deltas sum in input order before replay. Reject nonfinite sums and count all inputs toward the operation budget before merging.

## 0.1.0-beta.23

- Accept fixed upstream top-level operation aliases for numeric plot-log set/bump, including case and whitespace normalization. Reject multiple names for the same operation within a block; no card-specific aliases are read.

## 0.1.0-beta.22 — 2026-11-21

- Expand explicit numeric plot-log migration to ordered JSON blocks from one message, respecting persisted message-start values and the upstream staged arithmetic order for overlapping set/bump operations.
- Keep the subset limited to existing managed numeric leaves with a rule-free baseline; reject nonfinite intermediate values atomically.

## 0.1.0-beta.21 — 2026-11-21

- Add an explicit static-display varevent preview for unambiguous events with no condition or script, selecting the last nonempty display in each block.
- Reject conditional/scripted content instead of skipping it; return only text previews without storage writes, prompt injection or migration tokens.

## 0.1.0-beta.20 — 2026-11-21

- Show source and parsed event-header counts during varevent inspection and flag mismatches caused by multiline/unterminated field boundaries for manual review.
- Keep upstream field parsing unchanged and continue to prohibit condition/script execution.

## 0.1.0-beta.19 — 2026-11-21

- Reuse the pinned upstream pure varevent document parser for an explicit inspect-only endpoint and panel action.
- Display event fields and duplicate/script warnings within byte/block/event/field limits; never evaluate conditions, execute scripts or return a migration confirmation token for inspection.
- Keep the full event trigger/execution runtime unsupported and document source provenance.

## 0.1.0-beta.18 — 2026-11-21

- Normalize explicit legacy stateLogV2 root claims using the pinned upstream string/empty-filter semantics, deduplicate claims, and ignore valid empty rule declarations.
- Keep modern WAL validation strict; complex root objects, unsafe paths and invalid rules remain rejected.

## 0.1.0-beta.17 — 2026-11-21

- Accept an explicitly supplied legacy version-1 floor-zero checkpoint only when the old log has no floor-zero record.
- Restore only rule-claimed string roots, then install the original rules in a separate entry so readonly initialization retains its admitted values.
- Reject unsupported checkpoint versions and missing/empty claimed values; never infer native host variables or initialize twice.

## 0.1.0-beta.16 — 2026-11-21

- Add an explicit legacy stateLogV2 envelope converter with numeric floor ordering and preserved explicit root claims.
- Derive missing legacy root claims from recorded rule/text requests, then replay through the bounded message-WAL path.
- Require a floor-zero log entry rather than guessing checkpoint-only initialization; import a current baseline, not old chat history.

## 0.1.0-beta.15 — 2026-11-21

- Add an explicit per-floor swipe-record selection envelope with strict ordering and selection checks; show the selected path before confirming baseline restoration.
- Replay only chosen records, reject missing selected records instead of falling back, and keep source floor identities separate from target-game history.
- This imports one selected path's final state, not every original branch or chat message.

## 0.1.0-beta.14 — 2026-11-21

- Replay normal historical guard refusals and operation failures as no-effects, while keeping structural, payload and capacity violations fatal.
- Preserve temporary state until later root claims and retain historical duplicate-array-delete executor ordering.
- Include bounded refusal diagnostics in migration previews; do not confuse WAL entry reports with live story version checks on confirmation.
- Bound aggregate WAL diagnostic output at 16 KiB/32 entries and report omitted entries.

## 0.1.0-beta.13 — 2026-11-21

- Reject sparse arrays and oversized containers before numeric plot-log traversal; add cyclic/sparse direct-input regression checks.
- Preserve the explicit strict-subset compatibility boundaries from beta.12.

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
