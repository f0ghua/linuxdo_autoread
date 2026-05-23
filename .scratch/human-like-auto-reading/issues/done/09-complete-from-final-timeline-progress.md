# Complete From Final Timeline Progress

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

Fix the remaining footer-scroll case after **Topic Completion**. Some live Discourse pages can report the final Topic position through the timeline progress, such as `100 / 100`, while browser-side visible Post number extraction is unavailable or empty. In that case, the reader should treat the Topic as complete and should not continue scrolling into the page footer.

## Acceptance criteria

- [x] `currentPostNumber === highestPostNumber` completes the Topic before rendered page bottom.
- [x] Lazy-rendered page-bottom protection remains intact when timeline progress is not at the final Post.
- [x] The userscript metadata version changes so the installed script update is easier to verify.
- [x] Regression tests cover timeline-final completion without visible Post numbers.

## Completion notes

- Updated **Topic Completion** to trust final timeline progress, not only final visible Post extraction.
- Kept the existing near-bottom tolerance path for cases where the page is actually at the rendered bottom.
- Bumped the userscript version from `1.4.7` to `1.4.8`.
- `node --test test/topicCompletion.test.js` passed.
