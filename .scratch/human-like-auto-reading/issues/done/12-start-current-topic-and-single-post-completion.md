# Start Current Topic And Single Post Completion

Status: done

## Parent

.scratch/human-like-auto-reading/PRD.md

## What to build

Fix two observation and completion gaps in **Auto-Reading Session** behavior:

- A single-Post Topic without Discourse timeline progress should complete after its only Post body has been read through, instead of scrolling to the rendered page bottom.
- Clicking Start Reading while already inside a Topic should begin with the current Topic, then advance to the normal new/unread queue only after that Topic completes.

This makes manual testing possible by opening a specific Topic first, and keeps single-Post Topics from being treated as page-bottom-only completion cases.

## Acceptance criteria

- [x] Single rendered Topic with no timeline completes when its only Post is read through.
- [x] Single rendered Topic with no timeline keeps scrolling until the only Post bottom is read.
- [x] Starting on the current Topic activates the session without opening the Reading Queue.
- [x] After current Topic completion, normal queued navigation remains unchanged.
- [x] Userscript metadata version changes so the installed update is easier to verify.

## Completion notes

- Added rendered Post counting to browser Topic progress metrics.
- Added single-rendered-Post completion for pages without timeline metadata.
- Added `startCurrentTopic()` to the session controller.
- Changed the Start Reading button so Topic pages start from the current Topic, while non-Topic pages still open the next queued Topic immediately.
- Bumped the userscript version from `1.4.10` to `1.4.11`.
