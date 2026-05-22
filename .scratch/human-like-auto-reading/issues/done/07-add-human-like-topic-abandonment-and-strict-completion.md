# Add Human-Like Topic Abandonment And Strict Completion

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

Separate two different ways an **Auto-Reading Session** can leave a **Topic**:

- **Topic Completion**: the reader reached the real end of the Topic and may advance after the bottom delay.
- **Topic Abandonment**: the reader has read enough of a long Topic to plausibly lose interest and intentionally move to the next queued **Eligible Topic**.

This slice should prevent lazy-rendered Discourse pages from being mistaken for completed Topics, while still allowing long Topics to be skipped after partial reading as a deliberate human-like behavior.

## Acceptance criteria

- [x] Topic Completion does not rely only on current rendered document height when reliable post metadata is available.
- [x] Topic Completion requires evidence that the visible/read post number is near the Topic's real final post number.
- [x] A long Topic can be abandoned after reading a configured number of Posts.
- [x] Topic Abandonment has an explicit status distinct from `waiting-bottom`.
- [x] Short Topics are not abandoned early.
- [x] Abandoned Topics are skipped for the remainder of the active session so the session does not immediately reopen the same Topic.
- [x] Stop Reading clears abandoned-topic session state.
- [x] Tests cover strict completion, abandonment, short-topic protection, and skipped-topic session behavior.

## Completion notes

- Added strict Topic Completion support that combines rendered-bottom detection with Discourse post progress metadata when available.
- Added browser Topic progress extraction from the timeline and visible post numbers.
- Added a probabilistic Topic Abandonment controller for long Topics with configurable minimum/maximum posts read before abandonment.
- Added an active-session abandoned-topic tracker and queue filtering so intentionally skipped Topics are not immediately reopened in the same session.
- Kept abandoned Topics separate from completed Topics: the core status is `abandoned-topic`, while true completion remains `waiting-bottom`.
- Added tests for strict completion, lazy-rendered bottom protection, probabilistic abandonment, short-topic protection, and abandoned-topic queue filtering.
- `npm test` and `npm run typecheck` passed.

## Implementation notes

- Use Discourse topic metadata already present in the browser when possible, such as highest post number, posts count, or visible post numbers.
- Keep Discourse account **Read Position** as the source of truth. Do not locally mark the abandoned Topic as read.
- Keep **Reading Queue**, **Candidate Source**, **Eligible Topic**, and automatic-like behavior otherwise unchanged.

## Blocked by

- .scratch/human-like-auto-reading/issues/done/01-reading-profile-randomized-scroll-pacing.md
- .scratch/human-like-auto-reading/issues/done/03-delay-advance-after-topic-completion.md
- .scratch/human-like-auto-reading/issues/done/06-add-post-level-dwell-for-visible-posts.md
