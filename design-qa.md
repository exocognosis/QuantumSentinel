**Source visual truth**

- `/var/folders/bj/_phs_kq57hv8lw5bg8mhqn7r0000gn/T/codex-clipboard-f6ac4eb0-cfab-42a4-b18e-b54bdc33017d.png`
- Source pixels: 3420 x 2214. Desktop dark-theme Overview state.

**Rendered implementation**

- `/Users/rickglenn/Documents/QuantumSentinel/implementation-score-scope.png`
- Implementation pixels: 2000 x 1385. Desktop dark-theme Overview state with onboarding open and the website scope selected.
- Browser-rendered at `http://127.0.0.1:15174/` in the Codex in-app browser.
- Density normalization: both captures were compared as full-width desktop layouts; differences caused by browser chrome and pixel density were excluded.

**Full-view comparison evidence**

- The existing navigation, dark palette, card grid, typography hierarchy, icons, radii, and dashboard density remain consistent with the source.
- The readiness card gains one native select control without changing the surrounding grid or pushing primary actions below the fold.
- The selected scope consistently updates the headline card, three adjacent metrics, score drivers, and priority list.

**Focused region comparison evidence**

- The selected website state visibly changes the card title to `Observed crypto posture`, the ring label to `Posture`, and the explanatory copy to a one-target evidence boundary.
- The scope selector exposes `Overall organization`, `Website`, and `Authorized network` choices from live saved scans.
- The score-driver card changes from organizational readiness inputs to algorithm, evidence, protocol, certificate, and forward-secrecy inputs.

**Interaction verification**

- Selected `Website - rsa2048.badssl.com:443` through the native scope selector.
- Verified the score changed to 55 and the card, metrics, drivers, and priorities changed to the selected target.
- Verified the rendered page contains no browser console errors.

**Findings**

- No actionable P0, P1, or P2 mismatch remains.
- P3: long target names may need truncation in unusually narrow desktop widths; the native select currently remains within the card boundary.

**Comparison history**

- Initial implementation labeled the selected target ring `Readiness`, which could preserve the original ambiguity.
- Fixed the ring label to `Posture` for scan scopes and recaptured the implementation.
- Post-fix evidence shows organization-wide readiness and target-level observed posture are visibly distinct.

**Implementation checklist**

- [x] Preserve the source dashboard design system.
- [x] Add a functional score-scope selector.
- [x] Separate organization readiness from scan-level crypto posture.
- [x] Filter adjacent counts, drivers, and priorities with the selected scope.
- [x] Verify the interaction in the in-app browser.

final result: passed
