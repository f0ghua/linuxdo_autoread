# Wait After Topic Content Is Ready

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

After a **Topic** page has rendered **Posts**, delay the start of automatic scrolling for the configured topic-start period. The delay should begin only after Topic content is ready, not while the page is still waiting for rendered Posts. This gives Discourse time to initialize topic tracking before the reader begins advancing through the Topic.

The behavior should remain cancellable through Stop Reading and should not change how the **Reading Queue** is built or how **Eligible Topics** are opened.

## Acceptance criteria

- [x] A Topic page with no rendered **Posts** continues to wait using the existing readiness behavior.
- [x] Once Topic content is ready, automatic scrolling waits for the configured topic-start delay before the first scroll action.
- [x] Stop Reading during the topic-start delay cancels the pending scroll.
- [x] The delay is applied per opened **Topic**, not once per browser session.
- [x] **Topic** URL construction and **Read Position** resume behavior remain unchanged.
- [x] Existing session lifecycle and Topic readiness tests are updated or preserved to cover the delayed start behavior.

## Completion notes

- Added `topicStartDelayMs` to the default Reading Profile.
- Added a Topic start delay controller so each opened **Topic** waits after rendered **Posts** are ready.
- Wired Stop Reading and navigation cleanup through the existing timer cleanup path so pending topic-start waits are cancelled.
- `npm run test` and `npm run typecheck` passed.

## Blocked by

- .scratch/human-like-auto-reading/issues/01-reading-profile-randomized-scroll-pacing.md
