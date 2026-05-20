const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAutoReadingSession,
  createReadStateTrustGuard,
  createReadingQueueStorage,
  continueTopicReading,
  READ_STATE_PAUSE_REASONS,
} = require("../autoread");

function createMemoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("Visible, focused Topic pages continue the paced reading path", async () => {
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => false,
    hasPageFocus: () => true,
  });
  const scrollActions = [];
  const scheduledDelays = [];

  const result = await continueTopicReading({
    isActive: () => true,
    getReadStateTrust: trustGuard.getTrustState,
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 100,
      documentHeight: 2000,
    }),
    readingProfile: {
      minScrollStepPixels: 10,
      maxScrollStepPixels: 20,
      minScrollDelayMs: 250,
      maxScrollDelayMs: 600,
    },
    random: () => 0,
    scrollTopic: (scrollAction) => {
      scrollActions.push(scrollAction);
    },
    scheduleNextCheck: (delayMs) => {
      scheduledDelays.push(delayMs);
    },
    advanceSession: () => {
      throw new Error("Topic before completion should not advance");
    },
  });

  assert.equal(result.status, "scrolling");
  assert.deepEqual(scrollActions, [
    {
      stepPixels: 10,
      delayMs: 250,
    },
  ]);
  assert.deepEqual(scheduledDelays, [250]);
});

test("Hidden tabs pause Topic reading before scrolling or scheduling more work", async () => {
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => true,
    hasPageFocus: () => true,
  });
  let clearTimerCalls = 0;
  let scrollCalls = 0;
  let scheduledChecks = 0;
  let advanceCalls = 0;

  const result = await continueTopicReading({
    isActive: () => true,
    getReadStateTrust: trustGuard.getTrustState,
    clearTimers: () => {
      clearTimerCalls += 1;
    },
    isTopicReady: () => {
      throw new Error("Hidden tabs should pause before Topic readiness checks");
    },
    shouldDelayTopicStart: () => {
      throw new Error("Hidden tabs should pause before topic-start delay checks");
    },
    recordTopicStartDelay: () => {
      throw new Error("Hidden tabs should not record topic-start delay");
    },
    getViewportMetrics: () => {
      throw new Error("Hidden tabs should pause before viewport checks");
    },
    scrollTopic: () => {
      scrollCalls += 1;
    },
    scheduleNextCheck: () => {
      scheduledChecks += 1;
    },
    advanceSession: () => {
      advanceCalls += 1;
    },
  });

  assert.deepEqual(result, {
    status: "paused",
    reason: READ_STATE_PAUSE_REASONS.hiddenTab,
  });
  assert.equal(clearTimerCalls, 1);
  assert.equal(scrollCalls, 0);
  assert.equal(scheduledChecks, 0);
  assert.equal(advanceCalls, 0);
});

test("Unfocused pages pause queued navigation before opening another Topic", async () => {
  let active = true;
  let clearTimerCalls = 0;
  const openedUrls = [];
  const labels = [];
  const titles = [];
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => false,
    hasPageFocus: () => false,
  });
  const readingQueueStorage = createReadingQueueStorage({
    storage: createMemoryStorage(),
  });
  readingQueueStorage.set([{ id: 101, last_read_post_number: 7 }]);

  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadStateTrust: trustGuard.getTrustState,
    getReadingQueue: async () => {
      throw new Error("Paused navigation should not build another queue");
    },
    navigateTo: (url) => {
      openedUrls.push(url);
    },
    readingQueueStorage,
    clearTimers: () => {
      clearTimerCalls += 1;
    },
    setControlLabel: (label) => {
      labels.push(label);
    },
    setControlTitle: (title) => {
      titles.push(title);
    },
    labels: {
      start: "Start Reading",
      stop: "Stop Reading",
    },
    messages: {
      unfocusedPagePause: "Paused because the page is unfocused.",
    },
  });

  const result = await session.advance();

  assert.deepEqual(result, {
    status: "paused",
    reason: READ_STATE_PAUSE_REASONS.unfocusedPage,
  });
  assert.equal(active, true);
  assert.equal(clearTimerCalls, 1);
  assert.deepEqual(openedUrls, []);
  assert.deepEqual(labels, ["Stop Reading"]);
  assert.equal(titles[titles.length - 1], "Paused because the page is unfocused.");
  assert.deepEqual(readingQueueStorage.get(), [
    { id: 101, last_read_post_number: 7 },
  ]);
});

test("Paused queued navigation can recover after the page becomes trusted", async () => {
  let active = true;
  let focused = false;
  const openedUrls = [];
  const titles = [];
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => false,
    hasPageFocus: () => focused,
  });
  const readingQueueStorage = createReadingQueueStorage({
    storage: createMemoryStorage(),
  });
  readingQueueStorage.set([{ id: 101, last_read_post_number: 7 }]);

  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadStateTrust: trustGuard.getTrustState,
    getReadingQueue: async () => {
      throw new Error("Stored Reading Queue should be used on recovery");
    },
    navigateTo: (url) => {
      openedUrls.push(url);
    },
    readingQueueStorage,
    setControlTitle: (title) => {
      titles.push(title);
    },
    messages: {
      unfocusedPagePause: "Paused because the page is unfocused.",
    },
  });

  const pausedResult = await session.advance();
  focused = true;
  const recoveredResult = await session.advance();

  assert.deepEqual(pausedResult, {
    status: "paused",
    reason: READ_STATE_PAUSE_REASONS.unfocusedPage,
  });
  assert.equal(recoveredResult.status, "opened");
  assert.deepEqual(openedUrls, ["https://linux.do/t/topic/101/7"]);
  assert.equal(titles[titles.length - 1], "");
});

test("Stop Reading still works while paused for untrusted page state", async () => {
  let active = true;
  let clearTimerCalls = 0;
  const labels = [];
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => true,
    hasPageFocus: () => true,
  });
  const readingQueueStorage = createReadingQueueStorage({
    storage: createMemoryStorage(),
  });
  readingQueueStorage.set([{ id: 101 }]);

  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadStateTrust: trustGuard.getTrustState,
    getReadingQueue: async () => [{ id: 202 }],
    navigateTo: () => {
      throw new Error("Paused sessions should not navigate before Stop Reading");
    },
    readingQueueStorage,
    clearTimers: () => {
      clearTimerCalls += 1;
    },
    setControlLabel: (label) => {
      labels.push(label);
    },
    labels: {
      start: "Start Reading",
      stop: "Stop Reading",
    },
  });

  const pauseResult = await session.advance();
  const stopResult = session.stop();

  assert.deepEqual(pauseResult, {
    status: "paused",
    reason: READ_STATE_PAUSE_REASONS.hiddenTab,
  });
  assert.equal(stopResult.status, "stopped");
  assert.equal(active, false);
  assert.equal(clearTimerCalls, 2);
  assert.deepEqual(labels, ["Stop Reading", "Start Reading"]);
  assert.deepEqual(readingQueueStorage.get(), []);
});

test("Hidden tabs prevent delayed bottom advancement from opening the next Topic", async () => {
  let active = true;
  let hidden = false;
  let pendingAdvance = null;
  let clearTimerCalls = 0;
  const openedUrls = [];
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => hidden,
    hasPageFocus: () => true,
  });
  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadStateTrust: trustGuard.getTrustState,
    getReadingQueue: async () => [{ id: 102, last_read_post_number: 5 }],
    navigateTo: (url) => {
      openedUrls.push(url);
    },
    readingQueueStorage: createReadingQueueStorage({
      storage: createMemoryStorage(),
    }),
    clearTimers: () => {
      clearTimerCalls += 1;
      pendingAdvance = null;
    },
  });

  const bottomDelayResult = await continueTopicReading({
    isActive: session.isActive,
    getReadStateTrust: trustGuard.getTrustState,
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 1100,
      documentHeight: 2000,
    }),
    scrollTopic: () => {
      throw new Error("Completed Topics should not continue scrolling");
    },
    scheduleNextCheck: () => {
      throw new Error("Completed Topics should not schedule another check");
    },
    scheduleTopicCompletion: (_delayMs, advance) => {
      pendingAdvance = advance;
    },
    advanceSession: session.advance,
  });

  const delayedAdvance = pendingAdvance;
  hidden = true;
  const delayedAdvanceResult = await delayedAdvance();

  assert.equal(bottomDelayResult.status, "waiting-bottom");
  assert.deepEqual(delayedAdvanceResult, {
    status: "paused",
    reason: READ_STATE_PAUSE_REASONS.hiddenTab,
  });
  assert.equal(active, true);
  assert.equal(clearTimerCalls, 1);
  assert.deepEqual(openedUrls, []);
  assert.equal(pendingAdvance, null);
});

test("Auto-Reading Session exposes explicit page-state pause and resume controls", () => {
  let active = true;
  const labels = [];
  const titles = [];
  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadingQueue: async () => [],
    navigateTo: () => {
      throw new Error("Explicit pause should not navigate");
    },
    readingQueueStorage: createReadingQueueStorage({
      storage: createMemoryStorage(),
    }),
    setControlLabel: (label) => {
      labels.push(label);
    },
    setControlTitle: (title) => {
      titles.push(title);
    },
    labels: {
      start: "Start Reading",
      stop: "Stop Reading",
    },
    messages: {
      hiddenTabPause: "Paused because the tab is hidden.",
    },
  });

  const pauseResult = session.pause(READ_STATE_PAUSE_REASONS.hiddenTab);
  const pauseReason = session.getPauseReason();
  const resumeResult = session.resume();

  assert.deepEqual(pauseResult, {
    status: "paused",
    reason: READ_STATE_PAUSE_REASONS.hiddenTab,
  });
  assert.equal(pauseReason, READ_STATE_PAUSE_REASONS.hiddenTab);
  assert.equal(session.getPauseReason(), null);
  assert.deepEqual(resumeResult, { status: "resumed" });
  assert.deepEqual(labels, ["Stop Reading", "Stop Reading"]);
  assert.deepEqual(titles, ["Paused because the tab is hidden.", ""]);
  assert.equal(active, true);
});
