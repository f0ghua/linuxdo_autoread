# Require Final Post Bottom Before Completion

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

Refine **Topic Completion** so reaching the final Post number does not stop at the final Post's top edge. A human reader should continue scrolling until the lower edge of the final Post has been read, then stop without scrolling into the page footer.

## Acceptance criteria

- [x] A Topic does not complete when the final Post is only visible at its top edge.
- [x] A Topic completes when the final Post's bottom edge has crossed the viewport.
- [x] Timeline progress such as `100 / 100` is not enough by itself to complete before the final Post bottom is read.
- [x] Completion still avoids scrolling to the rendered page footer after the final Post bottom is read.
- [x] The userscript metadata version changes so the installed update is easier to verify.

## Completion notes

- Added read-through post progress based on each Post element's bottom edge.
- Updated **Topic Completion** to prefer final read-through evidence over final visible/current evidence.
- Kept rendered-bottom fallback for cases where post-level DOM progress is unavailable.
- Bumped the userscript version from `1.4.8` to `1.4.9`.
- Added regression coverage for final top-edge and final bottom-edge behavior.
