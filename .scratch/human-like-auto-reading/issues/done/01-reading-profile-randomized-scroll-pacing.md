# Add Reading Profile And Randomized Scroll Pacing

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

Add the first human-like pacing path for an **Auto-Reading Session** by replacing the fixed scroll cadence with a conservative reading profile. When a **Topic** is being read, each scroll action should choose a bounded random step size and bounded random delay before the next action. The session should still use the existing **Reading Queue**, **Read Position**, **Candidate Source**, **Eligible Topic**, **Skipped Topic**, and **Topic Completion** behavior.

This slice should be directly verifiable by starting an Auto-Reading Session and observing slower, non-identical scroll actions through a Topic. It should also be testable without a browser by injecting deterministic random values.

## Acceptance criteria

- [x] The auto-reader no longer scrolls with one fixed distance and one fixed interval during an active **Auto-Reading Session**.
- [x] Scroll step pixels are selected inside the configured conservative bounds.
- [x] Scroll delays are selected inside the configured conservative bounds.
- [x] Tests can verify chosen scroll actions deterministically without relying on real randomness.
- [x] Stop Reading cancels pending scroll scheduling so no further scrolling happens after the session is stopped.
- [x] Existing **Reading Queue**, **Read Position**, **Candidate Source**, **Eligible Topic**, **Skipped Topic**, **Topic Completion**, and automatic-like tests continue to pass.
- [x] The implementation does not add local **Read Position** storage or anti-abuse bypass behavior.

## Blocked by

None - can start immediately

## Comments

Implemented conservative randomized scroll actions in `autoread.js` with deterministic coverage in `test/readingProfile.test.js`. Existing `Stop Reading` timer cleanup now covers the one-shot paced scroll scheduling path.
