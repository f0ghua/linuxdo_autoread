# Open Eligible Topics at Discourse Read Position

Status: done
Type: AFK
User stories covered: 4, 5, 12, 13, 14, 25, 27

## What to build

Build the Topic navigation and temporary queue storage behavior for queued Eligible Topics. Each queued Topic should open at the Discourse-provided Read Position when present. If no Read Position exists, it should open from the beginning of the Topic.

The Reading Queue is a session snapshot. Queued Eligible Topics should not be revalidated before navigation, and stopping the Auto-Reading Session should discard the queue.

## Acceptance criteria

- [x] A queued Eligible Topic with a Read Position opens at that exact post number.
- [x] The Read Position is not incremented before opening.
- [x] A queued Eligible Topic without a Read Position opens from the beginning.
- [x] Null, undefined, zero, and missing Read Position values are handled deterministically.
- [x] A Reading Queue snapshot can survive navigation during a running Auto-Reading Session.
- [x] Stopping the Auto-Reading Session discards queue state.
- [x] Topic URL generation and storage behavior are covered without requiring a live browser session.

## Blocked by

- .scratch/auto-read-discourse-read-state/issues/01-build-reading-queue-from-discourse-candidate-sources.md

## Comments

- Implemented by extracting Topic URL generation, Reading Queue snapshot storage, and snapshot-based queued Topic opening into `AutoReadCore` with Node coverage.
