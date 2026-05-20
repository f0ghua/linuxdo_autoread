# Stop Or Pause On Repeated Timing Failures

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

Track browser-side Discourse `/topics/timings` outcomes during an **Auto-Reading Session**. If timing requests fail repeatedly beyond the configured threshold, stop or pause reading before the session scrolls further or opens another **Topic**. A successful timing request should reset the consecutive failure count.

This is a read-state trust feature. It must observe Discourse timing persistence health without spoofing, accelerating, or bypassing the timing endpoint.

## Acceptance criteria

- [x] Successful `/topics/timings` requests reset the consecutive timing failure count.
- [x] Failed `/topics/timings` requests increment the consecutive timing failure count.
- [x] Reaching the configured timing failure threshold stops or pauses automatic scrolling.
- [x] Reaching the configured timing failure threshold prevents delayed navigation to the next **Eligible Topic**.
- [x] The pause or stop reason is explicit enough for tests and user-facing control state.
- [x] Timing monitoring does not change request payloads, force timing requests, or bypass site protections.
- [x] Tests cover success reset, failure accumulation, threshold behavior, and interaction with existing page-state trust checks.

## Completion notes

- Added a browser-side Topic timing request monitor with a configurable consecutive failure threshold.
- Observed normal `fetch` and `XMLHttpRequest` `/topics/timings` outcomes without changing request arguments or forcing timing requests.
- Composed timing-failure trust into the existing read-state trust guard with explicit `timing-failures` pause reason.
- Routed Topic scrolling and delayed Topic Completion advancement through the timing-failure trust path.
- Preserved page-state pause reason priority over timing failures.
- `npm run test` and `npm run typecheck` passed.

## Blocked by

- .scratch/human-like-auto-reading/issues/04-pause-reading-when-page-state-is-untrusted.md
