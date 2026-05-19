# Control Auto-Reading Session Lifecycle

Status: done
Type: AFK
User stories covered: 1, 7, 8, 9, 15, 16, 17, 18, 26

## What to build

Build the Auto-Reading Session controller behavior that starts from idle, owns active session state, advances through queue exhaustion, creates another Reading Queue while Eligible Topics remain, and stops cleanly when the user stops the session or no Candidate Source can provide Eligible Topics.

Session Errors must stop the Auto-Reading Session without treating the queue as exhausted. Login-required errors should be visible to the user; other fetch, HTTP, or JSON failures should restore controls and leave diagnostic detail for debugging.

## Acceptance criteria

- [x] One user action starts an Auto-Reading Session from idle.
- [x] The Start Reading control becomes Stop Reading while the session is active.
- [x] Stop Reading clears active state, scroll timers, and queue state.
- [x] Queue exhaustion attempts to create another Reading Queue before ending the session.
- [x] The session ends when no Candidate Source can provide Eligible Topics.
- [x] Login-required errors stop the session and visibly tell the user what happened.
- [x] Non-login Session Errors stop the session, restore controls, and log useful diagnostic detail.
- [x] Session lifecycle and Session Error paths are covered without relying on manual browser testing.

## Blocked by

- .scratch/auto-read-discourse-read-state/issues/01-build-reading-queue-from-discourse-candidate-sources.md
- .scratch/auto-read-discourse-read-state/issues/02-open-eligible-topics-at-discourse-read-position.md

## Comments
