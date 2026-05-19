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

test("Topic Completion advances the Auto-Reading Session to the next queued Eligible Topic", async () => {
  let active = true;
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
    advanceSession: session.advance,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.advanceResult.status, "opened");
  assert.deepEqual(openedUrls, ["https://linux.do/t/topic/102/5"]);
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
