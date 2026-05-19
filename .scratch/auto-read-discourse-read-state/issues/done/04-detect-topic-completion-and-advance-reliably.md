# Detect Topic Completion and Advance Reliably

Status: done
Type: AFK
User stories covered: 6, 7, 28

## What to build

Build behavior that scrolls through the current Topic, detects Topic Completion by reaching the bottom region of the rendered page, and advances to the next queued Eligible Topic when completion is reached.

The script should rely on Discourse updating account-level read state during scrolling. It should not locally mark individual Posts as read.

## Acceptance criteria

- [x] The script scrolls through a Topic while an Auto-Reading Session is active.
- [x] Topic Completion is detected when the viewport reaches the bottom region of the rendered page.
- [x] Near-bottom tolerance handles small layout differences without premature advancement.
- [x] Not-bottom state does not advance to the next Topic.
- [x] After Topic Completion, the session opens the next queued Eligible Topic when one exists.
- [x] Completion behavior is covered with controlled viewport and document-height cases.

## Blocked by

- .scratch/auto-read-discourse-read-state/issues/03-control-auto-reading-session-lifecycle.md

## Comments

Implemented in `autoread.js` and covered by `test/topicCompletion.test.js`.
