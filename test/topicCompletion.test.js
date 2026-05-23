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

test("Topic Completion schedules advancement after the configured completion delay", async () => {
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
      minTopicCompletionDelayMs: 10000,
      maxTopicCompletionDelayMs: 10000,
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

test("Topic Completion waits for the real final Post when Topic metadata is available", () => {
  assert.equal(
    isTopicCompletionReached({
      viewportHeight: 800,
      scrollY: 1100,
      documentHeight: 2000,
      currentPostNumber: 12,
      highestPostNumber: 100,
    }),
    false
  );
  assert.equal(
    isTopicCompletionReached({
      viewportHeight: 800,
      scrollY: 1100,
      documentHeight: 2000,
      currentPostNumber: 99,
      highestPostNumber: 100,
    }),
    true
  );
});

test("Lazy-rendered bottom does not advance before the final Topic Post", async () => {
  let scrollCalls = 0;
  let scheduledCompletions = 0;

  const result = await continueTopicReading({
    isActive: () => true,
    getTopicProgress: () => ({
      currentPostNumber: 12,
      highestPostNumber: 100,
    }),
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 1100,
      documentHeight: 2000,
    }),
    scrollTopic: () => {
      scrollCalls += 1;
    },
    scheduleNextCheck: () => {},
    scheduleTopicCompletion: () => {
      scheduledCompletions += 1;
    },
    advanceSession: () => {
      throw new Error("Lazy-rendered Topics should not advance early");
    },
    readingProfile: {
      topicAbandonmentEnabled: false,
    },
  });

  assert.equal(result.status, "scrolling");
  assert.equal(scrollCalls, 1);
  assert.equal(scheduledCompletions, 0);
});

test("Final read-through Topic Post completes without scrolling to the rendered page bottom", async () => {
  let scrollCalls = 0;
  let scheduledCompletion = null;

  const result = await continueTopicReading({
    isActive: () => true,
    getTopicProgress: () => ({
      highestPostNumber: 100,
      maxVisiblePostNumber: 100,
      maxReadThroughPostNumber: 100,
      visiblePostNumbers: [99, 100],
      readThroughPostNumbers: [99, 100],
    }),
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 1200,
      documentHeight: 4000,
    }),
    scrollTopic: () => {
      scrollCalls += 1;
    },
    scheduleNextCheck: () => {
      throw new Error("Completed Topics should not schedule another scroll check");
    },
    scheduleTopicCompletion: (delayMs, advance) => {
      scheduledCompletion = { delayMs, advance };
    },
    advanceSession: () => ({ status: "opened" }),
    readingProfile: {
      minTopicCompletionDelayMs: 6000,
      maxTopicCompletionDelayMs: 10000,
      topicAbandonmentEnabled: false,
    },
    random: () => 0.25,
  });

  assert.equal(result.status, "waiting-bottom");
  assert.equal(result.delayMs, 7000);
  assert.equal(scrollCalls, 0);
  assert.equal(scheduledCompletion.delayMs, 7000);
});

test("Final Topic Post top edge does not complete before the bottom edge is read", async () => {
  let scrollCalls = 0;
  let scheduledChecks = 0;
  let scheduledCompletions = 0;

  const result = await continueTopicReading({
    isActive: () => true,
    getTopicProgress: () => ({
      currentPostNumber: 100,
      highestPostNumber: 100,
      maxVisiblePostNumber: 100,
      maxReadThroughPostNumber: 99,
      visiblePostNumbers: [100],
      readThroughPostNumbers: [99],
    }),
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 1200,
      documentHeight: 4000,
    }),
    scrollTopic: () => {
      scrollCalls += 1;
    },
    scheduleNextCheck: () => {
      scheduledChecks += 1;
    },
    scheduleTopicCompletion: () => {
      scheduledCompletions += 1;
    },
    advanceSession: () => {
      throw new Error("Unread final Post bottoms should not advance");
    },
    readingProfile: {
      topicAbandonmentEnabled: false,
    },
  });

  assert.equal(result.status, "scrolling");
  assert.equal(scrollCalls, 1);
  assert.equal(scheduledChecks, 1);
  assert.equal(scheduledCompletions, 0);
});

test("Timeline final Topic Post completes after the final Post bottom edge is read", async () => {
  let scrollCalls = 0;
  let scheduledCompletion = null;

  const result = await continueTopicReading({
    isActive: () => true,
    getTopicProgress: () => ({
      currentPostNumber: 100,
      highestPostNumber: 100,
      maxVisiblePostNumber: null,
      maxReadThroughPostNumber: 100,
      visiblePostNumbers: [],
      readThroughPostNumbers: [100],
    }),
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 1200,
      documentHeight: 4000,
    }),
    scrollTopic: () => {
      scrollCalls += 1;
    },
    scheduleNextCheck: () => {
      throw new Error("Completed Topics should not schedule another scroll check");
    },
    scheduleTopicCompletion: (delayMs, advance) => {
      scheduledCompletion = { delayMs, advance };
    },
    advanceSession: () => ({ status: "opened" }),
    readingProfile: {
      minTopicCompletionDelayMs: 6000,
      maxTopicCompletionDelayMs: 6000,
      topicAbandonmentEnabled: false,
    },
  });

  assert.equal(result.status, "waiting-bottom");
  assert.equal(result.delayMs, 6000);
  assert.equal(scrollCalls, 0);
  assert.equal(scheduledCompletion.delayMs, 6000);
});

test("Topic Completion delay is sampled from the Reading Profile range", async () => {
  async function getCompletionDelay(randomValue) {
    const result = await continueTopicReading({
      isActive: () => true,
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
      scheduleTopicCompletion: () => {},
      advanceSession: () => ({ status: "opened" }),
      readingProfile: {
        minTopicCompletionDelayMs: 6000,
        maxTopicCompletionDelayMs: 8000,
      },
      random: () => randomValue,
    });

    return result.delayMs;
  }

  assert.equal(await getCompletionDelay(0), 6000);
  assert.equal(await getCompletionDelay(0.5), 7000);
  assert.equal(await getCompletionDelay(1), 8000);
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
