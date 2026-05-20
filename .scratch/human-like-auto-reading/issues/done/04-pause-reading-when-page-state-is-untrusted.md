# Pause Reading When Page State Is Untrusted

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

Add a read-state trust guard that stops reading movement when the browser page state makes Discourse **Read Position** persistence difficult to trust. The first page-state signals are hidden tab and unfocused page. When either signal is untrusted, the **Auto-Reading Session** should stop scrolling and avoid opening another **Topic** until the user can clearly recover or restart.

The implementation should expose explicit pause reasons so behavior and tests do not depend on fragile user-facing message text.

## Acceptance criteria

- [x] A visible, focused Topic page is allowed to continue the paced reading path.
- [x] A hidden tab prevents automatic scrolling and queued navigation.
- [x] An unfocused page prevents automatic scrolling and queued navigation.
- [x] The control state or title makes the pause reason clear enough for the user to understand why reading stopped moving.
- [x] Stop Reading still works while reading is paused for untrusted page state.
- [x] Pending scroll, topic-start, and bottom-delay timers are cleared or suppressed while the state is untrusted.
- [x] Tests cover trusted page state, hidden tab, unfocused page, and recovery or restart behavior.
- [x] **Reading Queue** construction and **Candidate Source** priority remain unchanged.

## Completion notes

- Added explicit read-state pause reasons for hidden tabs and unfocused pages.
- Routed Topic movement and Auto-Reading Session advancement through the read-state trust guard before scrolling, topic-start delay, bottom-delay advancement, or queued navigation.
- Added session pause/resume controls so Stop Reading remains available while paused and focus/visibility recovery can continue the active session.
- Wired browser `visibilitychange`, `focus`, and `blur` events to clear pending timers while untrusted and resume only after the page is trusted again.
- Preserved existing **Reading Queue** construction and **Candidate Source** priority behavior.
- `npm run test` and `npm run typecheck` passed.

## Blocked by

- .scratch/human-like-auto-reading/issues/01-reading-profile-randomized-scroll-pacing.md
