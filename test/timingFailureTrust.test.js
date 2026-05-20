const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAutoReadingSession,
  createReadingQueueStorage,
  continueTopicReading,
  createReadStateTrustGuard,
  createTimingRequestMonitor,
  installTimingRequestMonitor,
  READ_STATE_PAUSE_REASONS,
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

test("Successful Topic timing requests reset consecutive timing failures", () => {
  const timingMonitor = createTimingRequestMonitor({
    maxConsecutiveFailures: 3,
  });

  timingMonitor.recordFailure("https://linux.do/topics/timings");
  timingMonitor.recordFailure("https://linux.do/topics/timings");
  timingMonitor.recordSuccess("https://linux.do/topics/timings");

  assert.equal(timingMonitor.getConsecutiveFailures(), 0);
});

test("Only Topic timing request failures affect the consecutive failure count", () => {
  const timingMonitor = createTimingRequestMonitor({
    maxConsecutiveFailures: 3,
  });

  timingMonitor.recordFailure("https://linux.do/assets/application.js");
  timingMonitor.recordFailure("https://linux.do/topics/timings");

  assert.equal(timingMonitor.getConsecutiveFailures(), 1);
});

test("Repeated Topic timing failures pause Topic reading before scrolling", async () => {
  const timingMonitor = createTimingRequestMonitor({
    maxConsecutiveFailures: 3,
  });
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => false,
    hasPageFocus: () => true,
    getTimingRequestTrust: timingMonitor.getTrustState,
  });
  let clearTimerCalls = 0;
  let scrollCalls = 0;

  timingMonitor.recordFailure("https://linux.do/topics/timings");
  timingMonitor.recordFailure("https://linux.do/topics/timings");
  timingMonitor.recordFailure("https://linux.do/topics/timings");

  const result = await continueTopicReading({
    isActive: () => true,
    getReadStateTrust: trustGuard.getTrustState,
    clearTimers: () => {
      clearTimerCalls += 1;
    },
    isTopicReady: () => {
      throw new Error("Timing failures should pause before Topic readiness checks");
    },
    getViewportMetrics: () => {
      throw new Error("Timing failures should pause before viewport checks");
    },
    scrollTopic: () => {
      scrollCalls += 1;
    },
    scheduleNextCheck: () => {
      throw new Error("Timing failures should not schedule more work");
    },
    advanceSession: () => {
      throw new Error("Timing failures should not advance the session");
    },
  });

  assert.deepEqual(result, {
    status: "paused",
    reason: READ_STATE_PAUSE_REASONS.timingFailures,
  });
  assert.equal(clearTimerCalls, 1);
  assert.equal(scrollCalls, 0);
});

test("Repeated Topic timing failures prevent delayed navigation to the next Eligible Topic", async () => {
  let active = true;
  let pendingAdvance = null;
  let clearTimerCalls = 0;
  const openedUrls = [];
  const timingMonitor = createTimingRequestMonitor({
    maxConsecutiveFailures: 3,
  });
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => false,
    hasPageFocus: () => true,
    getTimingRequestTrust: timingMonitor.getTrustState,
  });
  const session = createAutoReadingSession({
    baseUrl: "https://linux.do",
    getActiveState: () => active,
    setActiveState: (nextActive) => {
      active = nextActive;
    },
    getReadStateTrust: trustGuard.getTrustState,
    getReadingQueue: async () => [{ id: 102, last_read_post_number: 5 }],
    navigateTo: (url) => {
      openedUrls.push(url);
    },
    readingQueueStorage: createReadingQueueStorage({
      storage: createMemoryStorage(),
    }),
    clearTimers: () => {
      clearTimerCalls += 1;
      pendingAdvance = null;
    },
  });

  const bottomDelayResult = await continueTopicReading({
    isActive: session.isActive,
    getReadStateTrust: trustGuard.getTrustState,
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
    scheduleTopicCompletion: (_delayMs, advance) => {
      pendingAdvance = advance;
    },
    advanceSession: session.advance,
  });

  const delayedAdvance = pendingAdvance;
  timingMonitor.recordFailure("https://linux.do/topics/timings");
  timingMonitor.recordFailure("https://linux.do/topics/timings");
  timingMonitor.recordFailure("https://linux.do/topics/timings");
  const delayedAdvanceResult = await delayedAdvance();

  assert.equal(bottomDelayResult.status, "waiting-bottom");
  assert.deepEqual(delayedAdvanceResult, {
    status: "paused",
    reason: READ_STATE_PAUSE_REASONS.timingFailures,
  });
  assert.equal(active, true);
  assert.equal(clearTimerCalls, 1);
  assert.deepEqual(openedUrls, []);
  assert.equal(pendingAdvance, null);
});

test("Page-state trust reasons take precedence over timing failure trust", () => {
  const timingMonitor = createTimingRequestMonitor({
    maxConsecutiveFailures: 1,
  });
  const trustGuard = createReadStateTrustGuard({
    isPageHidden: () => true,
    hasPageFocus: () => false,
    getTimingRequestTrust: timingMonitor.getTrustState,
  });

  timingMonitor.recordFailure("https://linux.do/topics/timings");

  assert.deepEqual(trustGuard.getTrustState(), {
    trusted: false,
    reason: READ_STATE_PAUSE_REASONS.hiddenTab,
  });
});

test("Fetch timing monitoring observes success without changing request arguments", async () => {
  const timingMonitor = createTimingRequestMonitor({
    maxConsecutiveFailures: 3,
  });
  const fetchCalls = [];
  const request = { url: "https://linux.do/topics/timings" };
  const init = { method: "POST", body: "unchanged" };
  const response = { ok: true };
  const globalObject = {
    fetch(input, options) {
      fetchCalls.push({ input, options });
      return Promise.resolve(response);
    },
  };

  timingMonitor.recordFailure("https://linux.do/topics/timings");
  installTimingRequestMonitor({
    globalObject,
    timingMonitor,
  });

  const result = await globalObject.fetch(request, init);

  assert.equal(result, response);
  assert.deepEqual(fetchCalls, [{ input: request, options: init }]);
  assert.equal(timingMonitor.getConsecutiveFailures(), 0);
});

test("XHR timing monitoring observes failures without changing request arguments", () => {
  const timingMonitor = createTimingRequestMonitor({
    maxConsecutiveFailures: 3,
  });
  const openCalls = [];
  const sendCalls = [];

  function FakeXMLHttpRequest() {
    this.listeners = {};
    this.status = 500;
  }
  FakeXMLHttpRequest.prototype.open = function open(...args) {
    openCalls.push(args);
  };
  FakeXMLHttpRequest.prototype.send = function send(...args) {
    sendCalls.push(args);
  };
  FakeXMLHttpRequest.prototype.addEventListener = function addEventListener(
    type,
    listener
  ) {
    this.listeners[type] = listener;
  };

  const globalObject = {
    XMLHttpRequest: FakeXMLHttpRequest,
  };

  installTimingRequestMonitor({
    globalObject,
    timingMonitor,
  });

  const xhr = new globalObject.XMLHttpRequest();
  xhr.open("POST", "https://linux.do/topics/timings", true);
  xhr.send("unchanged");
  xhr.listeners.loadend();

  assert.deepEqual(openCalls, [
    ["POST", "https://linux.do/topics/timings", true],
  ]);
  assert.deepEqual(sendCalls, [["unchanged"]]);
  assert.equal(timingMonitor.getConsecutiveFailures(), 1);
});
