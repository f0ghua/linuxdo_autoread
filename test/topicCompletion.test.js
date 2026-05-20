const assert = require("node:assert/strict");
const test = require("node:test");

const {
  continueTopicReading,
  createAutoReadingSession,
  createReadingQueueStorage,
  isTopicCompletionReached,
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

test("Active Auto-Reading Session scrolls the current Topic before Topic Completion", async () => {
  let scrollCalls = 0;
  let scheduledChecks = 0;
  let advanceCalls = 0;

  const result = await continueTopicReading({
    isActive: () => true,
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 100,
      documentHeight: 2000,
    }),
    scrollTopic: () => {
      scrollCalls += 1;
    },
    scheduleNextCheck: () => {
      scheduledChecks += 1;
    },
    scheduleTopicCompletion: () => {
      throw new Error("Topics before completion should not schedule advancement");
    },
    advanceSession: () => {
      advanceCalls += 1;
    },
  });

  assert.equal(result.status, "scrolling");
  assert.equal(scrollCalls, 1);
  assert.equal(scheduledChecks, 1);
  assert.equal(advanceCalls, 0);
});

test("Topic pages wait for rendered Posts before Topic Completion can advance", async () => {
  let scheduledChecks = 0;
  let advanceCalls = 0;

  const result = await continueTopicReading({
    isActive: () => true,
    isTopicReady: () => false,
    getViewportMetrics: () => {
      throw new Error("Unreadiness should be checked before viewport metrics");
    },
    scrollTopic: () => {
      throw new Error("Unrendered Topics should not scroll");
    },
    scheduleNextCheck: () => {
      scheduledChecks += 1;
    },
    advanceSession: () => {
      advanceCalls += 1;
    },
  });

  assert.equal(result.status, "waiting");
  assert.equal(scheduledChecks, 1);
  assert.equal(advanceCalls, 0);
});

test("Topic Completion schedules advancement after the configured bottom delay", async () => {
  let active = true;
  const openedUrls = [];
  let scheduledCompletion = null;
  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadingQueue: async () => [{ id: 102, last_read_post_number: 5 }],
    navigateTo: (url) => openedUrls.push(url),
    readingQueueStorage: createReadingQueueStorage({
      storage: createMemoryStorage(),
    }),
  });

  const result = await continueTopicReading({
    isActive: session.isActive,
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
    scheduleTopicCompletion: (delayMs, advance) => {
      scheduledCompletion = { delayMs, advance };
    },
    advanceSession: session.advance,
    readingProfile: {
      bottomDelayMs: 10000,
    },
  });

  assert.equal(result.status, "waiting-bottom");
  assert.equal(result.delayMs, 10000);
  assert.equal(active, true);
  assert.deepEqual(openedUrls, []);
  assert.equal(scheduledCompletion.delayMs, 10000);

  const advanceResult = await scheduledCompletion.advance();

  assert.equal(advanceResult.status, "opened");
  assert.deepEqual(openedUrls, ["https://linux.do/t/topic/102/5"]);
});

test("Stop Reading during bottom delay cancels the pending Topic advancement", async () => {
  let active = true;
  let pendingAdvance = null;
  const openedUrls = [];
  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadingQueue: async () => [{ id: 102, last_read_post_number: 5 }],
    navigateTo: (url) => openedUrls.push(url),
    readingQueueStorage: createReadingQueueStorage({
      storage: createMemoryStorage(),
    }),
    clearTimers: () => {
      pendingAdvance = null;
    },
  });

  const delayResult = await continueTopicReading({
    isActive: session.isActive,
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

  const stopResult = session.stop();

  assert.equal(delayResult.status, "waiting-bottom");
  assert.equal(stopResult.status, "stopped");
  assert.equal(active, false);
  assert.equal(pendingAdvance, null);
  assert.deepEqual(openedUrls, []);
});

test("Session Error during delayed advancement clears the bottom-delay timer", async () => {
  let active = true;
  let pendingAdvance = null;
  let clearTimerCalls = 0;
  const failure = new Error("unread.json failed");
  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadingQueue: async () => {
      throw failure;
    },
    navigateTo: () => {
      throw new Error("Session Errors should not navigate");
    },
    readingQueueStorage: createReadingQueueStorage({
      storage: createMemoryStorage(),
    }),
    clearTimers: () => {
      clearTimerCalls += 1;
      pendingAdvance = null;
    },
  });

  await continueTopicReading({
    isActive: session.isActive,
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
  const result = await delayedAdvance();

  assert.equal(result.status, "error");
  assert.equal(result.error, failure);
  assert.equal(active, false);
  assert.equal(pendingAdvance, null);
  assert.equal(clearTimerCalls, 2);
});

test("Topic Completion uses a near-bottom tolerance without advancing too early", () => {
  assert.equal(
    isTopicCompletionReached({
      viewportHeight: 800,
      scrollY: 1099,
      documentHeight: 2000,
    }),
    false
  );
  assert.equal(
    isTopicCompletionReached({
      viewportHeight: 800,
      scrollY: 1100,
      documentHeight: 2000,
    }),
    true
  );
});

test("Inactive Auto-Reading Sessions do not scroll, schedule, or advance", async () => {
  let getViewportCalls = 0;
  let scrollCalls = 0;
  let scheduledChecks = 0;
  let advanceCalls = 0;

  const result = await continueTopicReading({
    isActive: () => false,
    getViewportMetrics: () => {
      getViewportCalls += 1;
      return {
        viewportHeight: 800,
        scrollY: 1100,
        documentHeight: 2000,
      };
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

  assert.equal(result.status, "inactive");
  assert.equal(getViewportCalls, 0);
  assert.equal(scrollCalls, 0);
  assert.equal(scheduledChecks, 0);
  assert.equal(advanceCalls, 0);
});
