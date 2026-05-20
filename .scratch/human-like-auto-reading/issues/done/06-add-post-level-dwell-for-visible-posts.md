# Add Post-Level Dwell For Visible Posts

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

Add deferred post-level dwell behavior after the first pacing and trust-guard slices are in place. When a new **Post** becomes visible during an active **Auto-Reading Session**, briefly pause before continuing. Longer posts or posts with images may use a longer dwell period within configured bounds.

This slice should make reading through a **Topic** more conservative without changing **Reading Queue** selection, **Read Position** resume behavior, **Topic Completion**, or automatic-like behavior.

## Acceptance criteria

- [x] The reader detects when a newly visible **Post** should trigger dwell during an active **Auto-Reading Session**.
- [x] Dwell pauses scrolling before continuing through the Topic.
- [x] Dwell duration stays within configured conservative bounds.
- [x] Longer posts or image posts can dwell longer than short text-only posts without blocking forever.
- [x] Stop Reading cancels any pending dwell timer.
- [x] Page-state and timing-failure trust guards still prevent scrolling and navigation while untrusted.
- [x] Tests cover newly visible Post dwell, dwell cancellation, and no change to **Reading Queue** or **Read Position** behavior.

## Completion notes

- Added post-level dwell profile bounds and a visible-Post dwell controller keyed per **Topic**.
- Routed active **Topic** reading through a dwell pause before viewport completion checks or scrolling when a newly visible **Post** appears.
- Made longer text and image Posts dwell longer while capping delays within configured conservative bounds.
- Wired browser visible-Post detection into the Tampermonkey reader without changing **Reading Queue**, **Read Position**, **Topic Completion**, or auto-like behavior.
- Kept page-state and timing-failure trust guards ahead of dwell scheduling.
- `npm run test` and `npm run typecheck` passed.

## Blocked by

- .scratch/human-like-auto-reading/issues/01-reading-profile-randomized-scroll-pacing.md
- .scratch/human-like-auto-reading/issues/04-pause-reading-when-page-state-is-untrusted.md
