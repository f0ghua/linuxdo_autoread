# Keep Auto-Like Opt-In and Independent

Status: done
Type: AFK
User stories covered: 21, 22

## What to build

Keep automatic liking separate from Auto-Reading Session behavior. Auto-like should default off and become active only after explicit user opt-in. Enabling or disabling auto-like must not affect Candidate Source selection, Reading Queue construction, Topic navigation, Topic Completion, or session lifecycle.

## Acceptance criteria

- [x] Auto-like is disabled by default for users without an explicit opt-in setting.
- [x] Auto-like only runs when the user explicitly enables it.
- [x] Auto-like state does not change Candidate Source selection.
- [x] Auto-like state does not change Reading Queue contents or queue lifecycle.
- [x] Auto-like state does not change Topic navigation, Topic Completion, or session stop behavior.
- [x] Default-off and independence behavior are covered by regression tests or equivalent checks.

## Blocked by

None - can start immediately

## Comments

Implemented in `autoread.js` and covered by `test/autoLike.test.js`.
