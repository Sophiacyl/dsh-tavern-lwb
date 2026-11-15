# Vendored State2 verification core

Based on LittleWhiteBox by biex.

Source: https://github.com/RT15548/LittleWhiteBox
Pinned commit: `707e03f2d7f75bb6588b29625b3bd61b6c4a7c5a`.

`state2/{parser,json-input,executor,guard-core,semantic}.js` were copied from
`modules/variables/state2/`. `js-yaml.mjs` was copied from `libs/js-yaml.mjs`
(js-yaml 4.1.0, MIT). No upstream application entry point or host integration is included.

The LittleWhiteBox license and custom attribution terms are retained in
`LICENSE-LittleWhiteBox.md`, with the original notice in `NOTICE-LittleWhiteBox`.
The js-yaml license is in `LICENSE-js-yaml.txt`.

Local modifications:

- Relative imports point only to the vendored modules.
- Guard state is owned by `createGuardCore()`; each executor call creates a fresh guard.
- Wildcard lookup scans the bounded rule table with the same precedence as the
  upstream exact / numeric wildcard / wildcard search. This removes its exponential path expansion.
- Guard validation additionally checks complete schema ancestor paths and read-only containers;
  increments respect type locks, allowed keys and enum results. This deliberately rejects upstream
  edge cases that would replace typed scalar fields with numbers or containers.
- Executor accepts optional synchronous boundary callbacks for the adapter's
  pre-write payload and post-operation snapshot validation.
- Parser rejects unknown lines/directives, empty or malformed schema, unsupported
  template array forms, invalid explicit quoted values, and parser warnings. It never logs input.
- YAML parsing rejects anchors, aliases, explicit tags, complex or unsafe keys
  and warnings before expansion, and limits parse recursion and node work.
- Public adapter restrictions and limits live in `../core/index.mjs`.

These changes are deliberately conservative. This is a verification implementation,
not a complete SillyTavern installation or a claim of full upstream syntax compatibility.
