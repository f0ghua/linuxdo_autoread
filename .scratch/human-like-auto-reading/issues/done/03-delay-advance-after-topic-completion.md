# Delay Advance After Topic Completion

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

When **Topic Completion** is reached, wait for the configured bottom delay before advancing the **Auto-Reading Session** to the next queued **Eligible Topic**. During the delay, the session should remain active but cancellable. This gives pending Discourse timing requests time to flush before navigation leaves the completed Topic.

This slice should keep bottom detection behavior intact while changing completion from immediate navigation to delayed advancement.

## Acceptance criteria

- [x] Reaching **Topic Completion** schedules advancement after the configured bottom delay instead of opening the next **Eligible Topic** immediately.
- [x] Stop Reading during the bottom delay cancels the pending navigation.
- [x] A **Session Error** or any session-ending transition clears the bottom-delay timer.
- [x] If the page has not reached **Topic Completion**, the reader continues the normal paced scroll path.
- [x] Delayed advancement uses the existing **Reading Queue** and **Read Position** behavior when it opens the next **Eligible Topic**.
- [x] Tests cover bottom not reached, bottom reached with delayed advance, and cancellation before delayed advance fires.

## Completion notes

- Added `bottomDelayMs` to the conservative default Reading Profile.
- Routed **Topic Completion** through a delayed completion scheduler instead of immediate **Auto-Reading Session** advancement.
- Reused existing timer cleanup so Stop Reading, delayed advancement, queue exhaustion, and **Session Error** clear pending bottom-delay navigation.
- Preserved existing **Reading Queue** and **Read Position** behavior when the delayed advance opens the next **Eligible Topic**.
- `npm run test` and `npm run typecheck` passed.

## Blocked by

- .scratch/human-like-auto-reading/issues/01-reading-profile-randomized-scroll-pacing.md
