const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildTopicUrl,
  createReadingQueueStorage,
  openNextQueuedTopic,
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

test("Queued Eligible Topic opens at the exact Discourse Read Position", () => {
  const url = buildTopicUrl({
    baseUrl: "https://linux.do",
    topic: {
      id: 101,
      last_read_post_number: 7,
    },
  });

  assert.equal(url, "https://linux.do/t/topic/101/7");
});

test("Queued Eligible Topic without a usable Read Position opens from the beginning", () => {
  const topics = [
    { id: 101 },
    { id: 102, last_read_post_number: null },
    { id: 103, last_read_post_number: undefined },
    { id: 104, last_read_post_number: 0 },
  ];

  assert.deepEqual(
    topics.map((topic) =>
      buildTopicUrl({
        baseUrl: "https://linux.do/",
        topic,
      })
    ),
    [
      "https://linux.do/t/topic/101",
      "https://linux.do/t/topic/102",
      "https://linux.do/t/topic/103",
      "https://linux.do/t/topic/104",
    ]
  );
});

test("Reading Queue snapshot survives navigation during a running Auto-Reading Session", () => {
  const storage = createMemoryStorage();
  const firstPageQueueStorage = createReadingQueueStorage({ storage });

  firstPageQueueStorage.set([
    { id: 101, last_read_post_number: 4 },
    { id: 102 },
  ]);

  const nextPageQueueStorage = createReadingQueueStorage({ storage });

  assert.deepEqual(nextPageQueueStorage.get(), [
    { id: 101, last_read_post_number: 4 },
    { id: 102 },
  ]);
});

test("Stopping an Auto-Reading Session discards the Reading Queue snapshot", () => {
  const readingQueueStorage = createReadingQueueStorage({
    storage: createMemoryStorage(),
  });

  readingQueueStorage.set([{ id: 101 }, { id: 102 }]);
  readingQueueStorage.clear();

  assert.deepEqual(readingQueueStorage.get(), []);
});

test("Queued Eligible Topics are opened from the snapshot without revalidation", async () => {
  const readingQueueStorage = createReadingQueueStorage({
    storage: createMemoryStorage(),
  });
  const openedUrls = [];
  let queueBuilds = 0;

  readingQueueStorage.set([
    { id: 101, last_read_post_number: 4 },
    { id: 102 },
  ]);

  const result = await openNextQueuedTopic({
    baseUrl: "https://linux.do",
    getReadingQueue: async () => {
      queueBuilds += 1;
      return [{ id: 999 }];
    },
    navigateTo: (url) => openedUrls.push(url),
    readingQueueStorage,
  });

  assert.equal(queueBuilds, 0);
  assert.deepEqual(openedUrls, ["https://linux.do/t/topic/101/4"]);
  assert.deepEqual(readingQueueStorage.get(), [{ id: 102 }]);
  assert.equal(result.status, "opened");
});

test("Opening a newly built Reading Queue stores the remaining snapshot before navigation", async () => {
  const readingQueueStorage = createReadingQueueStorage({
    storage: createMemoryStorage(),
  });
  const openedUrls = [];

  await openNextQueuedTopic({
    baseUrl: "https://linux.do",
    getReadingQueue: async () => [
      { id: 101, last_read_post_number: 4 },
      { id: 102 },
    ],
    navigateTo: (url) => openedUrls.push(url),
    readingQueueStorage,
  });

  assert.deepEqual(openedUrls, ["https://linux.do/t/topic/101/4"]);
  assert.deepEqual(readingQueueStorage.get(), [{ id: 102 }]);
});
