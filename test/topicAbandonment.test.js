const assert = require("node:assert/strict");
const test = require("node:test");

const {
  continueTopicReading,
  createAbandonedTopicTracker,
  createTopicAbandonmentController,
  selectReadingQueue,
} = require("../autoread");

test("Long Topics can be abandoned after a planned partial read", async () => {
  let currentPostNumber = 1;
  const scrollActions = [];
  const scheduledDelays = [];
  const abandonmentController = createTopicAbandonmentController({
    getTopicKey: () => "/t/topic/101",
    random: () => 0,
  });
  let abandonmentRecords = 0;
  const options = {
    isActive: () => true,
    getTopicProgress: () => ({
      currentPostNumber,
      highestPostNumber: 100,
    }),
    shouldAbandonTopic: abandonmentController.shouldAbandonTopic,
    recordTopicAbandonment: () => {
      abandonmentRecords += 1;
      abandonmentController.recordTopicAbandonment();
    },
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 100,
      documentHeight: 5000,
    }),
    scrollTopic: (scrollAction) => {
      scrollActions.push(scrollAction);
    },
    scheduleNextCheck: (delayMs) => {
      scheduledDelays.push(delayMs);
    },
    advanceSession: () => ({ status: "opened" }),
    readingProfile: {
      minPostsBeforeAbandon: 8,
      maxPostsBeforeAbandon: 12,
      minRemainingPostsBeforeAbandon: 5,
    },
  };

  for (currentPostNumber = 1; currentPostNumber < 8; currentPostNumber += 1) {
    const result = await continueTopicReading(options);
    assert.equal(result.status, "scrolling");
  }

  currentPostNumber = 8;
  const abandonResult = await continueTopicReading(options);

  assert.equal(abandonResult.status, "abandoned-topic");
  assert.deepEqual(abandonResult.advanceResult, { status: "opened" });
  assert.equal(abandonmentRecords, 1);
  assert.equal(scrollActions.length, 7);
  assert.equal(scheduledDelays.length, 7);
});

test("Topic abandonment is probabilistic and can choose to finish a long Topic", async () => {
  const abandonmentController = createTopicAbandonmentController({
    getTopicKey: () => "/t/topic/101",
    random: () => 1,
  });
  let scrollCalls = 0;

  const result = await continueTopicReading({
    isActive: () => true,
    getTopicProgress: () => ({
      currentPostNumber: 40,
      highestPostNumber: 100,
    }),
    shouldAbandonTopic: abandonmentController.shouldAbandonTopic,
    recordTopicAbandonment: () => {
      throw new Error("Topic should not be abandoned when probability misses");
    },
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 100,
      documentHeight: 5000,
    }),
    scrollTopic: () => {
      scrollCalls += 1;
    },
    scheduleNextCheck: () => {},
    advanceSession: () => {
      throw new Error("Topic should not advance");
    },
  });

  assert.equal(result.status, "scrolling");
  assert.equal(scrollCalls, 1);
});

test("Short Topics are not abandoned early", async () => {
  const abandonmentController = createTopicAbandonmentController({
    getTopicKey: () => "/t/topic/101",
    random: () => 0,
  });
  let scrollCalls = 0;

  const result = await continueTopicReading({
    isActive: () => true,
    getTopicProgress: () => ({
      currentPostNumber: 8,
      highestPostNumber: 12,
    }),
    shouldAbandonTopic: abandonmentController.shouldAbandonTopic,
    recordTopicAbandonment: () => {
      throw new Error("Short Topics should not be abandoned");
    },
    getViewportMetrics: () => ({
      viewportHeight: 800,
      scrollY: 100,
      documentHeight: 5000,
    }),
    scrollTopic: () => {
      scrollCalls += 1;
    },
    scheduleNextCheck: () => {},
    advanceSession: () => {
      throw new Error("Short Topics should not advance early");
    },
  });

  assert.equal(result.status, "scrolling");
  assert.equal(scrollCalls, 1);
});

test("Abandoned Topics are skipped for the active session queue", async () => {
  const tracker = createAbandonedTopicTracker({
    getCurrentTopicId: () => "101",
  });

  tracker.recordCurrentTopicAbandoned();

  const selectedQueue = await selectReadingQueue({
    candidateSources: ["unread", "new"],
    fetchTopicPage: async (source) => ({
      topic_list: {
        topics:
          source === "unread"
            ? [{ id: 101, posts_count: 10 }]
            : [{ id: 102, posts_count: 10 }],
      },
    }),
    maxTopicPages: 1,
    isTopicExcluded: tracker.isTopicAbandoned,
  });

  assert.deepEqual(selectedQueue, {
    source: "new",
    topics: [{ id: 102, posts_count: 10 }],
  });

  tracker.clear();
  assert.deepEqual(
    tracker.filterTopics([
      { id: 101, posts_count: 10 },
      { id: 102, posts_count: 10 },
    ]),
    [
      { id: 101, posts_count: 10 },
      { id: 102, posts_count: 10 },
    ]
  );
});
