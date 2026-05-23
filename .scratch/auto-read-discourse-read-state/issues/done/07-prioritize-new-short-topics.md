# Prioritize New Short Topics

Status: done

## Parent

.scratch/auto-read-discourse-read-state/PRD.md

## What to build

Change **Reading Queue** selection so an **Auto-Reading Session** prioritizes new Topics over previously entered unread Topics. Within a Candidate Source, sort **Eligible Topics** by total `posts_count` ascending so short Topics are read first.

This intentionally supersedes the earlier unread-first queue policy. The goal is to complete more Topics in the same reading time and avoid repeatedly resuming older partially-read Topics before new content.

## Acceptance criteria

- [x] Default Candidate Source order is `new` first, then `unread`.
- [x] If `new` has Eligible Topics, the Reading Queue does not fetch `unread` first.
- [x] If `new` is empty or only contains Skipped Topics, the Reading Queue falls back to `unread`.
- [x] Eligible Topics are sorted by `posts_count` ascending within the chosen Candidate Source.
- [x] Equal-sized Topics preserve Discourse response order.
- [x] Existing filtering still uses total Topic size instead of unread post count.
- [x] Auto-like remains independent of Reading Queue selection.

## Completion notes

- Updated `DEFAULT_CANDIDATE_SOURCES` to prefer `new` before `unread`.
- Added stable `posts_count` sorting for each Candidate Source's Eligible Topics.
- Updated queue and auto-like tests for the new source priority.
- Added regression coverage for short-topic sorting and stable equal-size ordering.
- `npm test` and `npm run typecheck` passed.
