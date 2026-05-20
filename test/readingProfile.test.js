const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_READING_PROFILE,
  chooseScrollAction,
  continueTopicReading,
} = require("../autoread");

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
