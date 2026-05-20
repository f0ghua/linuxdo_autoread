const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_READING_PROFILE,
  READ_STATE_PAUSE_REASONS,
  continueTopicReading,
  createAutoReadingSession,
  createReadStateTrustGuard,
  createReadingQueueStorage,
  createTimingRequestMonitor,
  createVisiblePostDwellController,
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

test("Newly visible Posts pause Topic scrolling for post-level dwell", async () => {
  const dwellController = createVisiblePostDwellController();
  const scheduledDelays = [];
  const visiblePosts = [
    {
      key: "post-101",
      textLength: 120,
      imageCount: 0,
    },
  ];

  const result = await continueTopicReading({
    isActive: () => true,
    getVisiblePosts: () => visiblePosts,
    getPostForDwell: dwellController.getPostForDwell,
    recordPostDwell: dwellController.recordPostDwell,
    getViewportMetrics: () => {
      throw new Error("Post dwell should happen before viewport checks");
    },
    scrollTopic: () => {
      throw new Error("Post dwell should pause before scrolling");
    },
    scheduleNextCheck: (delayMs) => {
      scheduledDelays.push(delayMs);
    },
    advanceSession: () => {
      throw new Error("Post dwell should not advance the session");
    },
    readingProfile: {
      minPostDwellMs: 1200,
      maxPostDwellMs: 3000,
    },
  });

  assert.equal(result.status, "dwelling-post");
  assert.equal(result.post, visiblePosts[0]);
  assert.equal(result.delayMs, 3000);
  assert.deepEqual(scheduledDelays, [3000]);
});

test("Already-dwelled visible Posts do not block the next paced scroll", async () => {
  const dwellController = createVisiblePostDwellController();
  const scheduledDelays = [];
  const scrollActions = [];
  const visiblePosts = [
    {
      key: "post-101",
      textLength: 120,
      imageCount: 0,
    },
  ];

  const options = {
    isActive: () => true,
    getVisiblePosts: () => visiblePosts,
    getPostForDwell: dwellController.getPostForDwell,
    recordPostDwell: dwellController.recordPostDwell,
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 100,
      documentHeight: 2000,
    }),
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

  const dwellResult = await continueTopicReading(options);
  const scrollResult = await continueTopicReading(options);

  assert.equal(dwellResult.status, "dwelling-post");
  assert.equal(scrollResult.status, "scrolling");
  assert.deepEqual(scrollActions, [
    {
      stepPixels: DEFAULT_READING_PROFILE.minScrollStepPixels,
      delayMs: DEFAULT_READING_PROFILE.minScrollDelayMs,
    },
  ]);
  assert.deepEqual(scheduledDelays, [
    dwellResult.delayMs,
    DEFAULT_READING_PROFILE.minScrollDelayMs,
  ]);
});

test("Longer Posts and image Posts dwell longer within configured bounds", async () => {
  async function getDwellDelay(post) {
    const dwellController = createVisiblePostDwellController();

    const result = await continueTopicReading({
      isActive: () => true,
      getVisiblePosts: () => [post],
      getPostForDwell: dwellController.getPostForDwell,
      recordPostDwell: dwellController.recordPostDwell,
      getViewportMetrics: () => {
        throw new Error("Post dwell should happen before viewport checks");
      },
      scrollTopic: () => {
        throw new Error("Post dwell should pause before scrolling");
      },
      scheduleNextCheck: () => {},
      advanceSession: () => {
        throw new Error("Post dwell should not advance the session");
      },
      readingProfile: {
        minPostDwellMs: 1000,
        maxPostDwellMs: 4000,
        postDwellMsPerCharacter: 10,
        imagePostDwellBonusMs: 1200,
      },
    });

    return result.delayMs;
  }

  const shortDelayMs = await getDwellDelay({
    key: "short-post",
    textLength: 10,
    imageCount: 0,
  });
  const longDelayMs = await getDwellDelay({
    key: "long-post",
    textLength: 500,
    imageCount: 0,
  });
  const imageDelayMs = await getDwellDelay({
    key: "image-post",
    textLength: 10,
    imageCount: 2,
  });

  assert.equal(shortDelayMs, 1100);
  assert.equal(longDelayMs, 4000);
  assert.equal(imageDelayMs, 3500);
  assert.ok(longDelayMs > shortDelayMs);
  assert.ok(imageDelayMs > shortDelayMs);
  [shortDelayMs, longDelayMs, imageDelayMs].forEach((delayMs) => {
    assert.ok(delayMs >= 1000);
    assert.ok(delayMs <= 4000);
  });
});

test("Stop Reading during post-level dwell cancels the pending dwell check", async () => {
  let active = true;
  let pendingDwell = false;
  const dwellController = createVisiblePostDwellController();
  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadingQueue: async () => [],
    navigateTo: () => {
      throw new Error("Stop should not navigate during post-level dwell");
    },
    readingQueueStorage: createReadingQueueStorage({
      storage: createMemoryStorage(),
    }),
    clearTimers: () => {
      pendingDwell = false;
      dwellController.reset();
    },
  });

  const dwellResult = await continueTopicReading({
    isActive: session.isActive,
    getVisiblePosts: () => [
      {
        key: "post-101",
        textLength: 120,
        imageCount: 0,
      },
    ],
    getPostForDwell: dwellController.getPostForDwell,
    recordPostDwell: dwellController.recordPostDwell,
    getViewportMetrics: () => {
      throw new Error("Post dwell should happen before viewport checks");
    },
    scrollTopic: () => {
      throw new Error("Post dwell should pause before scrolling");
    },
    scheduleNextCheck: () => {
      pendingDwell = true;
    },
    advanceSession: session.advance,
  });

  const stopResult = session.stop();

  assert.equal(dwellResult.status, "dwelling-post");
  assert.equal(stopResult.status, "stopped");
  assert.equal(active, false);
  assert.equal(pendingDwell, false);
  assert.equal(
    dwellController.getPostForDwell([
      {
        key: "post-101",
        textLength: 120,
        imageCount: 0,
      },
    ]).key,
    "post-101"
  );
});

test("Untrusted read state pauses before post-level dwell detection", async () => {
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => true,
    hasPageFocus: () => true,
  });
  let clearTimerCalls = 0;

  const result = await continueTopicReading({
    isActive: () => true,
    getReadStateTrust: trustGuard.getTrustState,
    clearTimers: () => {
      clearTimerCalls += 1;
    },
    isTopicReady: () => true,
    getVisiblePosts: () => {
      throw new Error("Untrusted state should pause before visible-Post checks");
    },
    getPostForDwell: () => {
      throw new Error("Untrusted state should pause before post dwell checks");
    },
    getViewportMetrics: () => {
      throw new Error("Untrusted state should pause before viewport checks");
    },
    scrollTopic: () => {
      throw new Error("Untrusted state should not scroll");
    },
    scheduleNextCheck: () => {
      throw new Error("Untrusted state should not schedule post dwell");
    },
    advanceSession: () => {
      throw new Error("Untrusted state should not advance the session");
    },
  });

  assert.deepEqual(result, {
    status: "paused",
    reason: READ_STATE_PAUSE_REASONS.hiddenTab,
  });
  assert.equal(clearTimerCalls, 1);
});

test("Timing-failure trust pauses before post-level dwell detection", async () => {
  const timingMonitor = createTimingRequestMonitor({
    maxConsecutiveFailures: 2,
  });
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => false,
    hasPageFocus: () => true,
    getTimingRequestTrust: timingMonitor.getTrustState,
  });

  timingMonitor.recordFailure("https://linux.do/topics/timings");
  timingMonitor.recordFailure("https://linux.do/topics/timings");

  const result = await continueTopicReading({
    isActive: () => true,
    getReadStateTrust: trustGuard.getTrustState,
    getVisiblePosts: () => {
      throw new Error("Timing failures should pause before visible-Post checks");
    },
    getPostForDwell: () => {
      throw new Error("Timing failures should pause before post dwell checks");
    },
    getViewportMetrics: () => {
      throw new Error("Timing failures should pause before viewport checks");
    },
    scrollTopic: () => {
      throw new Error("Timing failures should not scroll");
    },
    scheduleNextCheck: () => {
      throw new Error("Timing failures should not schedule post dwell");
    },
    advanceSession: () => {
      throw new Error("Timing failures should not advance the session");
    },
  });

  assert.deepEqual(result, {
    status: "paused",
    reason: READ_STATE_PAUSE_REASONS.timingFailures,
  });
});
