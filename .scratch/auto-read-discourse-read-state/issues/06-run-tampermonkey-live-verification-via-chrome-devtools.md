# Run Tampermonkey Live Verification via Chrome DevTools

Status: needs-info
Type: AFK
User stories covered: 29, 30, plus end-to-end reader behavior

## What to build

Verify the Auto-Reading Session in the user's logged-in Chrome DevTools session with Tampermonkey. Import or update the userscript, run it on linux.do, and confirm the browser behavior matches the PRD using same-origin logged-in browser credentials.

This issue is AFK because the user has already logged in to the Chrome DevTools session. If the session loses login state or reaches a human verification page, move the issue to `needs-info` rather than trying to bypass that flow.

## Acceptance criteria

- [ ] Tampermonkey has the current userscript installed or updated.
- [ ] The script runs on logged-in linux.do pages through the Chrome DevTools session.
- [ ] The Auto Read controls appear and reflect idle versus active state.
- [ ] The script can access unread/new Candidate Sources while logged in.
- [ ] Starting an Auto-Reading Session opens an Eligible Topic at the expected Read Position or beginning fallback.
- [ ] Topic scrolling and advancement are observed without posting, replying, or editing content.
- [ ] Stopping the session stops navigation/scrolling and clears session state.
- [ ] Auto-like remains off unless explicitly enabled.
- [ ] Any Cloudflare, human verification, or lost-login state is reported as blocked with `needs-info`.

## Blocked by

- .scratch/auto-read-discourse-read-state/issues/01-build-reading-queue-from-discourse-candidate-sources.md
- .scratch/auto-read-discourse-read-state/issues/02-open-eligible-topics-at-discourse-read-position.md
- .scratch/auto-read-discourse-read-state/issues/03-control-auto-reading-session-lifecycle.md
- .scratch/auto-read-discourse-read-state/issues/04-detect-topic-completion-and-advance-reliably.md
- .scratch/auto-read-discourse-read-state/issues/05-keep-auto-like-opt-in-and-independent.md

## Comments

### 2026-05-19 Live verification partial result

Verified before blocking:

- Tampermonkey had no installed scripts at the start of verification.
- Installed the current `autoread.js` userscript into Tampermonkey as `Auto Read` version `1.4.7`.
- Reloaded the logged-in `https://linux.do/` session and confirmed the userscript controls appeared in the idle state: `开始阅读` and `启用自动点赞`.
- Confirmed local session state was idle and auto-like remained opt-out: `read=false`, `autoLikeEnabled=false`, no persisted `readingQueue`, no persisted `topicList`.
- Confirmed same-origin logged-in access to both Candidate Sources:
  - `unread.json?no_definitions=true&page=0` returned HTTP 200 and 30 topics.
  - `new.json?no_definitions=true&page=0` returned HTTP 200 and 30 topics.
- Started an Auto-Reading Session from the userscript control and observed the control switch to `停止阅读` with `read=true` while `autoLikeEnabled=false`.
- Observed session navigation and topic advancement without posting, replying, or editing content. The browser navigated through queued topic URLs including `https://linux.do/t/topic/1666961/1`, `https://linux.do/t/topic/375351/465`, and `https://linux.do/t/topic/1843687/41`.
- Restored local session state to idle by setting `read=false` and clearing `readingQueue`, `topicList`, and `navigatingToNextTopic`.

Blocked:

- After resetting the session, `https://linux.do/` displayed a Cloudflare Turnstile human verification page titled `Just a moment...` with a `Verify you are human` checkbox. Per this issue's instructions, verification stopped here rather than attempting to bypass the challenge.
- Normal UI-based Stop Reading verification on a non-challenge linux.do page remains unverified because the Cloudflare challenge appeared before that final check could be completed.
