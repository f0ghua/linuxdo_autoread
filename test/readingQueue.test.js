const assert = require("node:assert/strict");
const test = require("node:test");

const { DEFAULT_CANDIDATE_SOURCES, buildReadingQueue } = require("../autoread");

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

test("Default Candidate Sources are new then unread and do not include latest", () => {
  assert.deepEqual(DEFAULT_CANDIDATE_SOURCES, ["new", "unread"]);
});

test("Reading Queue uses new Candidate Source before unread when new has Eligible Topics", async () => {
  const calls = [];

  const queue = await buildReadingQueue({
    fetchTopicPage: async (source, page) => {
      calls.push(`${source}:${page}`);

      if (source === "new") {
        return topicList([
          topic({
            id: 101,
            unread: 0,
            unread_posts: 0,
            new_posts: 0,
          }),
        ]);
      }

      return topicList([topic({ id: 202 })]);
    },
    maxTopicPages: 1,
  });

  assert.deepEqual(calls, ["new:0"]);
  assert.deepEqual(
    queue.map((queuedTopic) => queuedTopic.id),
    [101]
  );
});

test("Reading Queue falls back to unread Candidate Source when new has only Skipped Topics", async () => {
  const calls = [];

  const queue = await buildReadingQueue({
    fetchTopicPage: async (source, page) => {
      calls.push(`${source}:${page}`);

      if (source === "new" && page === 0) {
        return topicList([topic({ id: 101, posts_count: 1000 })]);
      }

      if (source === "unread" && page === 0) {
        return topicList([topic({ id: 202, posts_count: 12 })]);
      }

      return topicList([]);
    },
    maxTopicPages: 2,
  });

  assert.equal(calls[0], "new:0");
  assert.ok(calls.includes("unread:0"));
  assert.deepEqual(
    queue.map((queuedTopic) => queuedTopic.id),
    [202]
  );
});

test("Reading Queue falls back to unread Candidate Source when new is empty", async () => {
  const queue = await buildReadingQueue({
    fetchTopicPage: async (source) => {
      if (source === "new") {
        return topicList([]);
      }

      return topicList([topic({ id: 202, posts_count: 12 })]);
    },
    maxTopicPages: 1,
  });

  assert.deepEqual(
    queue.map((queuedTopic) => queuedTopic.id),
    [202]
  );
});

test("Reading Queue sorts Eligible Topics by total Post count", async () => {
  const queue = await buildReadingQueue({
    fetchTopicPage: async () =>
      topicList([
        topic({ id: 101, posts_count: 30 }),
        topic({ id: 102, posts_count: 5 }),
        topic({ id: 103, posts_count: 12 }),
      ]),
    maxTopicPages: 1,
  });

  assert.deepEqual(
    queue.map((queuedTopic) => queuedTopic.id),
    [102, 103, 101]
  );
});

test("Reading Queue preserves Discourse order for equal-sized Topics", async () => {
  const queue = await buildReadingQueue({
    fetchTopicPage: async () =>
      topicList([
        topic({ id: 101, posts_count: 12 }),
        topic({ id: 102, posts_count: 12 }),
        topic({ id: 103, posts_count: 12 }),
      ]),
    maxTopicPages: 1,
  });

  assert.deepEqual(
    queue.map((queuedTopic) => queuedTopic.id),
    [101, 102, 103]
  );
});

test("Eligible Topic filtering uses total Topic size instead of unread post count", async () => {
  const queue = await buildReadingQueue({
    fetchTopicPage: async () =>
      topicList([
        topic({
          id: 101,
          posts_count: 1000,
          unread_posts: 1,
          new_posts: 1,
        }),
        topic({
          id: 102,
          posts_count: 12,
          unread_posts: 1200,
          new_posts: 1200,
        }),
      ]),
    maxTopicPages: 1,
  });

  assert.deepEqual(
    queue.map((queuedTopic) => queuedTopic.id),
    [102]
  );
});

test("Skipped Topics are not carried into a persistent blacklist between queue builds", async () => {
  let session = "first";

  async function fetchTopicPage(source) {
    if (source === "new") {
      return topicList([
        topic({
          id: 101,
          posts_count: session === "first" ? 1000 : 12,
        }),
      ]);
    }

    return topicList([topic({ id: 202, posts_count: 12 })]);
  }

  const firstQueue = await buildReadingQueue({
    fetchTopicPage,
    maxTopicPages: 1,
  });

  session = "second";

  const secondQueue = await buildReadingQueue({
    fetchTopicPage,
    maxTopicPages: 1,
  });

  assert.deepEqual(
    firstQueue.map((queuedTopic) => queuedTopic.id),
    [202]
  );
  assert.deepEqual(
    secondQueue.map((queuedTopic) => queuedTopic.id),
    [101]
  );
});
