# Complete On Final Visible Post With Random Delay

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

Fix two follow-up behaviors in **Topic Completion**:

- When the final visible Topic Post has been read, finish the Topic without forcing an extra scroll to the rendered page bottom.
- After Topic Completion, use a randomized completion delay instead of a fixed wait.

This keeps the reader focused on Topic content rather than page footer chrome, while preserving the delayed advance that gives Discourse timing requests a chance to flush.

## Acceptance criteria

- [x] If the final Topic Post is visible/read, **Topic Completion** can be reached before the rendered page bottom.
- [x] Lazy-rendered page-bottom detection still does not complete a Topic before reliable post metadata says the Topic is near the final Post.
- [x] Completion advancement delay is sampled from the **Reading Profile** range.
- [x] Tests cover final-post completion before page bottom and randomized completion-delay sampling.

## Completion notes

- Added `minTopicCompletionDelayMs` and `maxTopicCompletionDelayMs` to the default **Reading Profile**.
- Changed **Topic Completion** to trust final visible post evidence before rendered-bottom evidence.
- Kept rendered-bottom fallback for cases where Topic post metadata is unavailable.
- Kept fixed-delay tests deterministic by pinning completion delay min and max to the same value.
- `node --test test/topicCompletion.test.js`, `node --test test/autoLike.test.js`, and `node --check autoread.js` passed.

## Blocked by

- .scratch/human-like-auto-reading/issues/done/03-delay-advance-after-topic-completion.md
- .scratch/human-like-auto-reading/issues/done/07-add-human-like-topic-abandonment-and-strict-completion.md
