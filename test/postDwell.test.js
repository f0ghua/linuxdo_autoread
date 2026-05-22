const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_READING_PROFILE,
  READ_STATE_PAUSE_REASONS,
  choosePostDwellDelay,
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

test("Initial visible Posts are baselined before the first paced scroll", async () => {
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

  const result = await continueTopicReading({
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
      throw new Error("Post dwell should not advance the session");
    },
    readingProfile: {
      minPostDwellMs: 1200,
      maxPostDwellMs: 3000,
    },
  });

  assert.equal(result.status, "scrolling");
  assert.deepEqual(scrollActions, [
    {
      stepPixels: DEFAULT_READING_PROFILE.minScrollStepPixels,
      delayMs: DEFAULT_READING_PROFILE.minScrollDelayMs,
    },
  ]);
  assert.deepEqual(scheduledDelays, [
    DEFAULT_READING_PROFILE.minScrollDelayMs,
  ]);
});

test("Newly visible Posts pause Topic scrolling for post-level dwell", async () => {
  const dwellController = createVisiblePostDwellController();
  const scheduledDelays = [];
  const scrollActions = [];
  const initialVisiblePosts = [
    {
      key: "post-101",
      textLength: 120,
      imageCount: 0,
    },
  ];
  const newlyVisiblePost = {
    key: "post-102",
    textLength: 120,
    imageCount: 0,
  };
  let visiblePosts = initialVisiblePosts;

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
    readingProfile: {
      minPostDwellMs: 1200,
      maxPostDwellMs: 3000,
    },
  };

  const initialScrollResult = await continueTopicReading(options);
  visiblePosts = [...initialVisiblePosts, newlyVisiblePost];
  const dwellResult = await continueTopicReading(options);

  assert.equal(initialScrollResult.status, "scrolling");
  assert.equal(dwellResult.status, "dwelling-post");
  assert.equal(dwellResult.post, newlyVisiblePost);
  assert.equal(dwellResult.delayMs, 1320);
  assert.deepEqual(scrollActions, [
    {
      stepPixels: DEFAULT_READING_PROFILE.minScrollStepPixels,
      delayMs: DEFAULT_READING_PROFILE.minScrollDelayMs,
    },
  ]);
  assert.deepEqual(scheduledDelays, [
    DEFAULT_READING_PROFILE.minScrollDelayMs,
    dwellResult.delayMs,
  ]);
});

test("Already-dwelled visible Posts do not block the next paced scroll", async () => {
  const dwellController = createVisiblePostDwellController();
  const scheduledDelays = [];
  const scrollActions = [];
  const initialVisiblePosts = [
    {
      key: "post-101",
      textLength: 120,
      imageCount: 0,
    },
  ];
  const newlyVisiblePost = {
    key: "post-102",
    textLength: 120,
    imageCount: 0,
  };
  let visiblePosts = initialVisiblePosts;

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

  const initialScrollResult = await continueTopicReading(options);
  visiblePosts = [...initialVisiblePosts, newlyVisiblePost];
  const dwellResult = await continueTopicReading(options);
  const scrollResult = await continueTopicReading(options);

  assert.equal(initialScrollResult.status, "scrolling");
  assert.equal(dwellResult.status, "dwelling-post");
  assert.equal(dwellResult.post, newlyVisiblePost);
  assert.equal(scrollResult.status, "scrolling");
  assert.deepEqual(scrollActions, [
    {
      stepPixels: DEFAULT_READING_PROFILE.minScrollStepPixels,
      delayMs: DEFAULT_READING_PROFILE.minScrollDelayMs,
    },
    {
      stepPixels: DEFAULT_READING_PROFILE.minScrollStepPixels,
      delayMs: DEFAULT_READING_PROFILE.minScrollDelayMs,
    },
  ]);
  assert.deepEqual(scheduledDelays, [
    DEFAULT_READING_PROFILE.minScrollDelayMs,
    dwellResult.delayMs,
    DEFAULT_READING_PROFILE.minScrollDelayMs,
  ]);
});

test("Duplicate visible Post representations only dwell once", async () => {
  const dwellController = createVisiblePostDwellController();
  const scheduledDelays = [];
  const scrollActions = [];
  const initialVisiblePosts = [
    {
      key: "post-101",
      textLength: 120,
      imageCount: 0,
    },
    {
      key: "post-101",
      textLength: 120,
      imageCount: 0,
    },
  ];
  const newlyVisiblePost = {
    key: "post-102",
    textLength: 120,
    imageCount: 0,
  };
  let visiblePosts = initialVisiblePosts;

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

  const initialScrollResult = await continueTopicReading(options);
  visiblePosts = [...initialVisiblePosts, newlyVisiblePost, newlyVisiblePost];
  const dwellResult = await continueTopicReading(options);
  const scrollResult = await continueTopicReading(options);

  assert.equal(initialScrollResult.status, "scrolling");
  assert.equal(dwellResult.status, "dwelling-post");
  assert.equal(dwellResult.post, newlyVisiblePost);
  assert.equal(scrollResult.status, "scrolling");
  assert.equal(scrollActions.length, 2);
  assert.deepEqual(scheduledDelays, [
    DEFAULT_READING_PROFILE.minScrollDelayMs,
    dwellResult.delayMs,
    DEFAULT_READING_PROFILE.minScrollDelayMs,
  ]);
});

test("Longer Posts and image Posts dwell longer within configured bounds", async () => {
  async function getDwellDelay(post) {
    const dwellController = createVisiblePostDwellController();
    dwellController.getPostForDwell([
      {
        key: "initial-post",
        textLength: 120,
        imageCount: 0,
      },
    ]);

    const result = await continueTopicReading({
      isActive: () => true,
      getVisiblePosts: () => [
        {
          key: "initial-post",
          textLength: 120,
          imageCount: 0,
        },
        post,
      ],
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

test("Default post dwell stays brief enough for continuous reading", () => {
  const delayMs = choosePostDwellDelay({
    post: {
      key: "long-image-post",
      textLength: 1200,
      imageCount: 3,
    },
  });

  assert.equal(delayMs, DEFAULT_READING_PROFILE.maxPostDwellMs);
  assert.ok(delayMs <= 2000);
});

test("Stop Reading during post-level dwell cancels the pending dwell check", async () => {
  let active = true;
  let pendingDwell = false;
  const dwellController = createVisiblePostDwellController();
  dwellController.getPostForDwell([
    {
      key: "post-100",
      textLength: 120,
      imageCount: 0,
    },
  ]);
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
        key: "post-100",
        textLength: 120,
        imageCount: 0,
      },
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
    ]),
    null
  );
  assert.equal(
    dwellController.getPostForDwell([
      {
        key: "post-101",
        textLength: 120,
        imageCount: 0,
      },
      {
        key: "post-102",
        textLength: 120,
        imageCount: 0,
      },
    ]).key,
    "post-102"
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
