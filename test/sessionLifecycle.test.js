const assert = require("node:assert/strict");
const test = require("node:test");

const {
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

function createSessionHarness({
  queues = [],
  initialActive = false,
  getReadingQueue,
  messages,
} = {}) {
  let active = initialActive;
  let clearTimerCalls = 0;
  let queueBuilds = 0;
  const labels = [];
  const titles = [];
  const visibleMessages = [];
  const diagnostics = [];
  const openedUrls = [];
  const readingQueueStorage = createReadingQueueStorage({
    storage: createMemoryStorage(),
  });

  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadingQueue:
      getReadingQueue ||
      (async () => {
        const queue = queues[queueBuilds] || [];
        queueBuilds += 1;
        return queue;
      }),
    navigateTo: (url) => openedUrls.push(url),
    readingQueueStorage,
    clearTimers: () => {
      clearTimerCalls += 1;
    },
    setControlLabel: (label) => labels.push(label),
    setControlTitle: (title) => titles.push(title),
    showUserMessage: (message) => visibleMessages.push(message),
    logDiagnostic: (...args) => diagnostics.push(args),
    labels: {
      start: "Start Reading",
      stop: "Stop Reading",
    },
    messages,
  });

  return {
    diagnostics,
    get active() {
      return active;
    },
    get clearTimerCalls() {
      return clearTimerCalls;
    },
    get queueBuilds() {
      return queueBuilds;
    },
    labels,
    openedUrls,
    readingQueueStorage,
    session,
    titles,
    visibleMessages,
  };
}

test("One user action starts an Auto-Reading Session and renders Stop Reading", async () => {
  const harness = createSessionHarness({
    queues: [[{ id: 101, last_read_post_number: 7 }, { id: 102 }]],
  });

  const result = await harness.session.toggle();

  assert.equal(result.status, "opened");
  assert.equal(harness.active, true);
  assert.deepEqual(harness.labels, ["Stop Reading"]);
  assert.deepEqual(harness.openedUrls, ["https://linux.do/t/topic/101/7"]);
  assert.deepEqual(harness.readingQueueStorage.get(), [{ id: 102 }]);
});

test("Starting on the current Topic activates reading without opening the queue", () => {
  const harness = createSessionHarness({
    queues: [[{ id: 101, last_read_post_number: 7 }]],
  });
  harness.readingQueueStorage.set([{ id: 999 }]);

  const result = harness.session.startCurrentTopic();

  assert.equal(result.status, "reading-current-topic");
  assert.equal(harness.active, true);
  assert.equal(harness.clearTimerCalls, 1);
  assert.equal(harness.queueBuilds, 0);
  assert.deepEqual(harness.labels, ["Stop Reading"]);
  assert.deepEqual(harness.openedUrls, []);
  assert.deepEqual(harness.readingQueueStorage.get(), []);
});

test("Stop Reading clears active session state, timers, and Reading Queue state", () => {
  const harness = createSessionHarness({ initialActive: true });
  harness.readingQueueStorage.set([{ id: 101 }, { id: 102 }]);

  const result = harness.session.toggle();

  assert.equal(result.status, "stopped");
  assert.equal(harness.active, false);
  assert.equal(harness.clearTimerCalls, 1);
  assert.deepEqual(harness.labels, ["Start Reading"]);
  assert.deepEqual(harness.readingQueueStorage.get(), []);
});

test("Queue exhaustion builds another Reading Queue before ending the Auto-Reading Session", async () => {
  const harness = createSessionHarness({
    queues: [[{ id: 101 }], [{ id: 202 }], []],
  });

  await harness.session.start();
  await harness.session.advance();
  const finalResult = await harness.session.advance();

  assert.equal(finalResult.status, "stopped");
  assert.equal(harness.active, false);
  assert.equal(harness.queueBuilds, 3);
  assert.deepEqual(harness.openedUrls, [
    "https://linux.do/t/topic/101",
    "https://linux.do/t/topic/202",
  ]);
  assert.deepEqual(harness.labels, [
    "Stop Reading",
    "Start Reading",
  ]);
});

test("Login-required Session Errors stop the session and visibly tell the user", async () => {
  const loginError = new Error("Please log in before starting Auto Read.");
  loginError.name = "LoginRequiredError";
  const harness = createSessionHarness({
    getReadingQueue: async () => {
      throw loginError;
    },
  });

  const result = await harness.session.start();

  assert.equal(result.status, "error");
  assert.equal(result.error, loginError);
  assert.equal(harness.active, false);
  assert.deepEqual(harness.labels, ["Stop Reading", "Start Reading"]);
  assert.equal(harness.titles[harness.titles.length - 1], loginError.message);
  assert.deepEqual(harness.visibleMessages, [loginError.message]);
});

test("Non-login Session Errors stop the session, restore controls, and log diagnostics", async () => {
  const failure = new Error("HTTP 500 from unread.json");
  const harness = createSessionHarness({
    getReadingQueue: async () => {
      throw failure;
    },
    messages: {
      genericError: "Unable to read topics right now.",
    },
  });

  const result = await harness.session.start();

  assert.equal(result.status, "error");
  assert.equal(result.error, failure);
  assert.equal(harness.active, false);
  assert.deepEqual(harness.labels, ["Stop Reading", "Start Reading"]);
  assert.equal(
    harness.titles[harness.titles.length - 1],
    "Unable to read topics right now."
  );
  assert.deepEqual(harness.visibleMessages, []);
  assert.equal(harness.diagnostics.length, 1);
  assert.equal(harness.diagnostics[0][0], "Auto-Reading Session Error");
  assert.equal(harness.diagnostics[0][1], failure);
});
