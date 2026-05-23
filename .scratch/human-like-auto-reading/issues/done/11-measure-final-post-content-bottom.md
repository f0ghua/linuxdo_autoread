# Measure Final Post Content Bottom

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

Fix the regression where **Topic Completion** can keep scrolling to the rendered page bottom after requiring the final Post bottom edge. The live Discourse post wrapper can extend below the actual readable Post content, so measuring the wrapper bottom can miss the moment when the final Post has effectively been read.

## Acceptance criteria

- [x] Read-through detection measures the Post content/body surface instead of only the outer post wrapper.
- [x] Post-number extraction can find `data-post-number` on ancestor elements as well as descendants.
- [x] The userscript metadata version changes so the installed update is easier to verify.
- [x] Existing Topic Completion regressions still pass.

## Completion notes

- Changed final Post read-through measurement to prefer `.topic-body .cooked`, `.topic-body`, or `.cooked` before falling back to the root post element.
- Updated attribute lookup to check the current element, ancestors, then descendants.
- Bumped the userscript version from `1.4.9` to `1.4.10`.
- `node --test test/topicCompletion.test.js` and `npm run typecheck` passed.
