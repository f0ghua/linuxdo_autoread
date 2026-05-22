const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_READING_PROFILE,
  chooseScrollAction,
  continueTopicReading,
  createAutoReadingSession,
  createReadingQueueStorage,
  createTopicStartDelayController,
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

test("Active Auto-Reading Session chooses bounded scroll step and delay", async () => {
  const randomValues = [0, 0.999];
  const scrollActions = [];
  const scheduledDelays = [];

  const result = await continueTopicReading({
    isActive: () => true,
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
    random: () => randomValues.shift(),
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
  assert.deepEqual(result.scrollAction, {
    stepPixels: 10,
    delayMs: 600,
  });
  assert.deepEqual(scrollActions, [result.scrollAction]);
  assert.deepEqual(scheduledDelays, [600]);
});

test("Ready Topic waits for the configured topic-start delay before the first scroll", async () => {
  let startDelayRecorded = false;
  const scheduledDelays = [];

  const result = await continueTopicReading({
    isActive: () => true,
    isTopicReady: () => true,
    shouldDelayTopicStart: () => !startDelayRecorded,
    recordTopicStartDelay: () => {
      startDelayRecorded = true;
    },
    getViewportMetrics: () => {
      throw new Error("Topic start delay should happen before viewport checks");
    },
    readingProfile: {
      minScrollStepPixels: 10,
      maxScrollStepPixels: 20,
      minScrollDelayMs: 250,
      maxScrollDelayMs: 600,
      topicStartDelayMs: 5000,
    },
    scrollTopic: () => {
      throw new Error("Topic should not scroll during topic-start delay");
    },
    scheduleNextCheck: (delayMs) => {
      scheduledDelays.push(delayMs);
    },
    advanceSession: () => {
      throw new Error("Topic should not advance during topic-start delay");
    },
  });

  assert.equal(result.status, "waiting-topic-start");
  assert.equal(result.delayMs, 5000);
  assert.equal(startDelayRecorded, true);
  assert.deepEqual(scheduledDelays, [5000]);
});

test("Topic start delay applies again when another Topic is opened", async () => {
  let topicKey = "/t/topic/101";
  const topicStartDelayController = createTopicStartDelayController({
    getTopicKey: () => topicKey,
  });
  const scrollActions = [];
  const scheduledDelays = [];

  const options = {
    isActive: () => true,
    isTopicReady: () => true,
    shouldDelayTopicStart: topicStartDelayController.shouldDelayTopicStart,
    recordTopicStartDelay: topicStartDelayController.recordTopicStartDelay,
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 100,
      documentHeight: 2000,
    }),
    readingProfile: {
      topicStartDelayMs: 1234,
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
  };

  const firstTopicDelay = await continueTopicReading(options);
  const firstTopicScroll = await continueTopicReading(options);
  topicKey = "/t/topic/102";
  const secondTopicDelay = await continueTopicReading(options);

  assert.equal(firstTopicDelay.status, "waiting-topic-start");
  assert.equal(firstTopicScroll.status, "scrolling");
  assert.equal(secondTopicDelay.status, "waiting-topic-start");
  assert.deepEqual(scrollActions, [
    {
      stepPixels: DEFAULT_READING_PROFILE.minScrollStepPixels,
      delayMs: DEFAULT_READING_PROFILE.minScrollDelayMs,
    },
  ]);
  assert.deepEqual(scheduledDelays, [
    1234,
    DEFAULT_READING_PROFILE.minScrollDelayMs,
    1234,
  ]);
});

test("Stop Reading during topic-start delay cancels the pending scroll", async () => {
  let active = true;
  let pendingScroll = false;
  const topicStartDelayController = createTopicStartDelayController({
    getTopicKey: () => "/t/topic/101",
  });
  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadingQueue: async () => [],
    navigateTo: () => {
      throw new Error("Stop should not navigate during topic-start delay");
    },
    readingQueueStorage: createReadingQueueStorage({
      storage: createMemoryStorage(),
    }),
    clearTimers: () => {
      pendingScroll = false;
      topicStartDelayController.reset();
    },
  });

  const delayResult = await continueTopicReading({
    isActive: session.isActive,
    isTopicReady: () => true,
    shouldDelayTopicStart: topicStartDelayController.shouldDelayTopicStart,
    recordTopicStartDelay: topicStartDelayController.recordTopicStartDelay,
    getViewportMetrics: () => {
      throw new Error("Topic start delay should happen before viewport checks");
    },
    scrollTopic: () => {
      throw new Error("Topic should not scroll during topic-start delay");
    },
    scheduleNextCheck: () => {
      pendingScroll = true;
    },
    advanceSession: session.advance,
  });

  const stopResult = session.stop();

  assert.equal(delayResult.status, "waiting-topic-start");
  assert.equal(stopResult.status, "stopped");
  assert.equal(active, false);
  assert.equal(pendingScroll, false);
  assert.equal(topicStartDelayController.shouldDelayTopicStart(), true);
});

test("Scroll actions stay inside configured bounds at the random upper edge", () => {
  const scrollAction = chooseScrollAction({
    readingProfile: {
      minScrollStepPixels: 10,
      maxScrollStepPixels: 20,
      minScrollDelayMs: 250,
      maxScrollDelayMs: 600,
    },
    random: () => 1,
  });

  assert.deepEqual(scrollAction, {
    stepPixels: 20,
    delayMs: 600,
  });
});

test("Default scroll profile keeps continuous reading in a practical pace range", () => {
  const slowestPixelsPerSecond =
    (DEFAULT_READING_PROFILE.minScrollStepPixels /
      DEFAULT_READING_PROFILE.maxScrollDelayMs) *
    1000;
  const fastestPixelsPerSecond =
    (DEFAULT_READING_PROFILE.maxScrollStepPixels /
      DEFAULT_READING_PROFILE.minScrollDelayMs) *
    1000;

  assert.equal(DEFAULT_READING_PROFILE.minScrollStepPixels, 48);
  assert.equal(DEFAULT_READING_PROFILE.maxScrollStepPixels, 96);
  assert.equal(DEFAULT_READING_PROFILE.minScrollDelayMs, 180);
  assert.equal(DEFAULT_READING_PROFILE.maxScrollDelayMs, 420);
  assert.ok(slowestPixelsPerSecond >= 100);
  assert.ok(fastestPixelsPerSecond <= 550);
});

test("Consecutive Topic checks can choose non-identical scroll actions", async () => {
  const randomValues = [0, 0, 0.999, 0.999];
  const scrollActions = [];
  const scheduledDelays = [];

  const options = {
    isActive: () => true,
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 100,
      documentHeight: 2000,
    }),
    random: () => randomValues.shift(),
    scrollTopic: (scrollAction) => {
      scrollActions.push(scrollAction);
    },
    scheduleNextCheck: (delayMs) => {
      scheduledDelays.push(delayMs);
    },
    advanceSession: () => {
      throw new Error("Topic before completion should not advance");
    },
  };

  await continueTopicReading(options);
  await continueTopicReading(options);

  assert.deepEqual(scrollActions, [
    {
      stepPixels: DEFAULT_READING_PROFILE.minScrollStepPixels,
      delayMs: DEFAULT_READING_PROFILE.minScrollDelayMs,
    },
    {
      stepPixels: DEFAULT_READING_PROFILE.maxScrollStepPixels,
      delayMs: DEFAULT_READING_PROFILE.maxScrollDelayMs,
    },
  ]);
  assert.deepEqual(scheduledDelays, [
    DEFAULT_READING_PROFILE.minScrollDelayMs,
    DEFAULT_READING_PROFILE.maxScrollDelayMs,
  ]);
});
