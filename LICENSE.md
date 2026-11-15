# License and author attribution

LWB Bridge is a public, modified derivative of selected LittleWhiteBox components.

**Based on LittleWhiteBox by biex**  
Original project: **LittleWhiteBox（小白X）**  
Source: https://github.com/RT15548/LittleWhiteBox  
Pinned source revision: `707e03f2d7f75bb6588b29625b3bd61b6c4a7c5a`

## Distributed project terms

This repository and its original adaptation code, panel, documentation and tests are distributed under **Apache License 2.0 together with the original author's custom attribution, source-disclosure and naming requirements**. They are not presented as an unmodified, plain Apache-2.0 project. The applicable documents are included verbatim:

- [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt): Apache License 2.0 terms.
- [`licenses/LittleWhiteBox-LICENSE.md`](licenses/LittleWhiteBox-LICENSE.md): the author's license notice and additional terms.
- [`licenses/LittleWhiteBox-COPYRIGHT`](licenses/LittleWhiteBox-COPYRIGHT): UI/documentation/source/promotion attribution, public source under the same terms, and derivative naming requirements.
- [`licenses/LittleWhiteBox-NOTICE`](licenses/LittleWhiteBox-NOTICE): original notices.
- [`NOTICE`](NOTICE): this derivative's provenance and modification notice.

The public source for LWB Bridge is https://github.com/Sophiacyl/dsh-tavern-lwb . All distributed runtime JavaScript is included in source form. The original author's name and project remain visible in the UI and documentation. The independent product name is **LWB Bridge**; the compatibility package identifier `dsh-tavern-lwb` remains stable for existing user data.

Modification details are in [`vendor/README.md`](vendor/README.md), [`PROVENANCE.md`](PROVENANCE.md) and [`CHANGELOG.md`](CHANGELOG.md). No original-author endorsement or project trademark license is claimed.

## Third-party components

`vendor/js-yaml.mjs` derives from js-yaml 4.1.0, MIT, with bounded-parser modifications documented in its header. Its license is retained in [`vendor/LICENSE-js-yaml.txt`](vendor/LICENSE-js-yaml.txt).

The runtime ZIP does not distribute DSH Tavern, SillyTavern, React or DSH. Installed development dependencies and optional public Tavern reference checkouts keep their own licenses and are excluded from the runtime ZIP and Git repository. They are not relicensed by this notice.

The upstream COPYRIGHT contains inconsistent statements about commercial permission; this release is a free public test build and makes no commercial licensing claim. Anyone planning a commercial derivative should clarify that point with the original author.
