# Build Reading Queue from Discourse Candidate Sources

Status: done
Type: AFK
User stories covered: 2, 3, 10, 11, 19, 20, 23, 24

## What to build

Build the Candidate Source and Reading Queue behavior for an Auto-Reading Session. The script should request unread items first, fall back to new items only when unread cannot provide Eligible Topics, and create a session-scoped Reading Queue from the first Candidate Source with Eligible Topics.

Candidate Source membership is authoritative: do not filter entries by `unread`, `new_posts`, or `unread_posts`. Eligible Topic filtering is based on total Topic size, and Skipped Topics are not persisted between sessions.

## Acceptance criteria

- [x] The auto-reader checks unread Candidate Source before new Candidate Source.
- [x] The auto-reader falls back to new Candidate Source when unread is empty or contains only Skipped Topics.
- [x] Candidate Source membership is enough for an entry to be considered an Unread Item, regardless of `unread`, `new_posts`, or `unread_posts` field values.
- [x] Eligible Topic filtering uses total Topic size rather than unread post count.
- [x] Skipped Topics are not stored as a persistent blacklist.
- [x] The workflow does not use latest topics as the primary Candidate Source.
- [x] Queue-building behavior is covered with sample Discourse topic-list JSON.

## Blocked by

None - can start immediately

## Comments
