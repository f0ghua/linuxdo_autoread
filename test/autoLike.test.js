const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildReadingQueue,
  continueTopicReading,
  createAutoLikeController,
  createAutoReadingSession,
  createReadingQueueStorage,
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

function topic(overrides = {}) {
  return {
    id: 1,
    posts_count: 12,
    ...overrides,
  };
}

function topicList(topics) {
  return {
    topic_list: {
      topics,
    },
  };
}

test("Auto-like is disabled by default without an explicit opt-in setting", () => {
  const storage = createMemoryStorage();
  const autoLike = createAutoLikeController({ storage });

  assert.equal(autoLike.isEnabled(), false);
  assert.equal(storage.getItem("autoLikeEnabled"), null);
});

test("Auto-like only runs after explicit user opt-in", () => {
  const storage = createMemoryStorage();
  const autoLike = createAutoLikeController({ storage });

  autoLike.setEnabled(true);

  assert.equal(autoLike.isEnabled(), true);
  assert.equal(storage.getItem("autoLikeEnabled"), "true");

  autoLike.setEnabled(false);

  assert.equal(autoLike.isEnabled(), false);
  assert.equal(storage.getItem("autoLikeEnabled"), "false");
});

test("Auto-like work is skipped until explicit user opt-in", () => {
  const storage = createMemoryStorage();
  const autoLike = createAutoLikeController({ storage });
  let runCount = 0;

  const defaultResult = autoLike.runIfEnabled(() => {
    runCount += 1;
  });

  autoLike.setEnabled(true);

  const enabledResult = autoLike.runIfEnabled(() => {
    runCount += 1;
  });

  assert.equal(defaultResult.status, "disabled");
  assert.equal(enabledResult.status, "ran");
  assert.equal(runCount, 1);
});

test("Auto-like state does not change Candidate Source selection or Reading Queue contents", async () => {
  async function buildQueueWithAutoLike(autoLikeEnabled) {
    const storage = createMemoryStorage();
    const autoLike = createAutoLikeController({ storage });
    const calls = [];

    autoLike.setEnabled(autoLikeEnabled);

    const queue = await buildReadingQueue({
      fetchTopicPage: async (source, page) => {
        calls.push(`${source}:${page}`);

        if (source === "new") {
          return topicList([
            topic({ id: 101, posts_count: 12 }),
            topic({ id: 102, posts_count: 1000 }),
          ]);
        }

        return topicList([topic({ id: 202, posts_count: 12 })]);
      },
      maxTopicPages: 1,
    });

    return {
      calls,
      queuedTopicIds: queue.map((queuedTopic) => queuedTopic.id),
    };
  }

  const disabledResult = await buildQueueWithAutoLike(false);
  const enabledResult = await buildQueueWithAutoLike(true);

  assert.deepEqual(disabledResult, {
    calls: ["new:0"],
    queuedTopicIds: [101],
  });
  assert.deepEqual(enabledResult, disabledResult);
});

test("Auto-like state does not change Topic navigation, Topic Completion, or stop behavior", async () => {
  async function runAutoReadingSessionWithAutoLike(autoLikeEnabled) {
    const storage = createMemoryStorage();
    const autoLike = createAutoLikeController({ storage });
    const readingQueueStorage = createReadingQueueStorage({ storage });
    let active = false;
    let clearTimerCalls = 0;
    let scheduledCompletion = null;
    const labels = [];
    const openedUrls = [];

    autoLike.setEnabled(autoLikeEnabled);

    const session = createAutoReadingSession({
      baseUrl: "https://linux.do",
      getActiveState: () => active,
      setActiveState: (nextActive) => {
        active = nextActive;
      },
      getReadingQueue: async () => [
        { id: 101, last_read_post_number: 4 },
        { id: 102 },
      ],
      navigateTo: (url) => openedUrls.push(url),
      readingQueueStorage,
      clearTimers: () => {
        clearTimerCalls += 1;
      },
      setControlLabel: (label) => labels.push(label),
      labels: {
        start: "Start Reading",
        stop: "Stop Reading",
      },
    });

    const startResult = await session.start();
    const completionResult = await continueTopicReading({
      isActive: session.isActive,
      getViewportMetrics: () => ({
        viewportHeight: 800,
        scrollY: 1100,
        documentHeight: 2000,
      }),
      scrollTopic: () => {
        throw new Error("Completed Topics should not keep scrolling");
      },
      scheduleNextCheck: () => {
        throw new Error("Completed Topics should not schedule checks");
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
    const completionAdvanceResult = await scheduledCompletion.advance();
    const stopResult = session.stop();

    return {
      autoLikeEnabledAfterStop: autoLike.isEnabled(),
      flow: {
        active,
        clearTimerCalls,
        labels,
        openedUrls,
        queue: readingQueueStorage.get(),
        startStatus: startResult.status,
        completionStatus: completionResult.status,
        completionDelayMs: completionResult.delayMs,
        completionAdvanceStatus: completionAdvanceResult.status,
        stopStatus: stopResult.status,
      },
    };
  }

  const disabledResult = await runAutoReadingSessionWithAutoLike(false);
  const enabledResult = await runAutoReadingSessionWithAutoLike(true);

  assert.equal(disabledResult.autoLikeEnabledAfterStop, false);
  assert.equal(enabledResult.autoLikeEnabledAfterStop, true);
  assert.deepEqual(enabledResult.flow, disabledResult.flow);
  assert.deepEqual(disabledResult.flow, {
    active: false,
    clearTimerCalls: 3,
    labels: ["Stop Reading", "Start Reading"],
    openedUrls: [
      "https://linux.do/t/topic/101/4",
      "https://linux.do/t/topic/102",
    ],
    queue: [],
    startStatus: "opened",
    completionStatus: "waiting-bottom",
    completionDelayMs: 10000,
    completionAdvanceStatus: "opened",
    stopStatus: "stopped",
  });
});
