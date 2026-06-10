// ==UserScript==
// @name         Auto Read
// @namespace    http://tampermonkey.net/
// @version      1.4.14
// @description  自动阅读 Discourse 论坛文章
// @author       liuweiqing
// @match        https://linux.do/*
// @match        https://nodeloc.com/*
// @match        https://www.nodeloc.com/*
// @exclude      https://linux.do/a/9611/0
// @grant        none
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=discourse.org
// @downloadURL https://update.greasyfork.org/scripts/489464/Auto%20Read.user.js
// @updateURL https://update.greasyfork.org/scripts/489464/Auto%20Read.meta.js
// ==/UserScript==

const AutoReadCore = (() => {
  const DEFAULT_CANDIDATE_SOURCES = ["new", "unread"];
  const DEFAULT_COMMENT_LIMIT = 1000;
  const DEFAULT_TOPIC_LIST_LIMIT = 100;
  const DEFAULT_MAX_TOPIC_PAGES = 10;
  const DEFAULT_READING_QUEUE_STORAGE_KEY = "readingQueue";
  const DEFAULT_AUTO_LIKE_STORAGE_KEY = "autoLikeEnabled";
  const DEFAULT_TOPIC_COMPLETION_TOLERANCE = 100;
  const DEFAULT_TOPIC_COMPLETION_POST_TOLERANCE = 1;
  const DEFAULT_READING_PROFILE = {
    minScrollStepPixels: 48,
    maxScrollStepPixels: 96,
    minScrollDelayMs: 180,
    maxScrollDelayMs: 420,
    topicStartDelayMs: 3500,
    bottomDelayMs: 10000,
    minTopicCompletionDelayMs: 6000,
    maxTopicCompletionDelayMs: 14000,
    maxConsecutiveTimingFailures: 24,
    minPostDwellMs: 250,
    maxPostDwellMs: 1200,
    postDwellMsPerCharacter: 1,
    imagePostDwellBonusMs: 250,
    topicAbandonmentEnabled: true,
    shortTopicPostThreshold: 20,
    longTopicPostThreshold: 80,
    topicAbandonmentProbability: 0.35,
    longTopicAbandonmentProbability: 0.65,
    minPostsBeforeAbandon: 8,
    maxPostsBeforeAbandon: 24,
    minRemainingPostsBeforeAbandon: 5,
  };
  const READ_STATE_PAUSE_REASONS = {
    hiddenTab: "hidden-tab",
    timingFailures: "timing-failures",
    unfocusedPage: "unfocused-page",
  };
  const DEFAULT_SESSION_LABELS = {
    start: "开始阅读",
    stop: "停止阅读",
  };
  const DEFAULT_SESSION_MESSAGES = {
    genericError: "读取未读主题失败，请稍后重试。",
    noTopics: "没有未读或新主题，已停止自动阅读。",
    hiddenTabPause: "页面已隐藏，自动阅读已暂停。",
    timingFailuresPause: "阅读计时请求连续失败，自动阅读已暂停。",
    unfocusedPagePause: "页面未聚焦，自动阅读已暂停。",
  };
  const DEFAULT_TRANSIENT_READ_STATE_RECOVERY_DELAY_MS = 3000;

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl).replace(/\/+$/, "");
  }

  function getReadPosition(topic) {
    const readPosition = topic && topic.last_read_post_number;

    return Number.isInteger(readPosition) && readPosition > 0
      ? readPosition
      : null;
  }

  function buildTopicUrl({ baseUrl, topic }) {
    const topicUrl = `${normalizeBaseUrl(baseUrl)}/t/topic/${topic.id}`;
    const readPosition = getReadPosition(topic);

    return readPosition === null ? topicUrl : `${topicUrl}/${readPosition}`;
  }

  function getTopicSessionKeyFromPathname(pathname) {
    const normalizedPathname = String(pathname || "").replace(/\/+$/, "");
    const topicPathMatch = normalizedPathname.match(
      /^(\/t\/[^/]+\/\d+)(?:\/\d+)?$/
    );

    return topicPathMatch ? topicPathMatch[1] : normalizedPathname || "/";
  }

  function getTopicIdFromPathname(pathname) {
    const topicSessionKey = getTopicSessionKeyFromPathname(pathname);
    const topicIdMatch = topicSessionKey.match(/^\/t\/[^/]+\/(\d+)$/);

    return topicIdMatch ? topicIdMatch[1] : null;
  }

  function createReadingQueueStorage({
    storage,
    storageKey = DEFAULT_READING_QUEUE_STORAGE_KEY,
  }) {
    return {
      clear() {
        storage.removeItem(storageKey);
      },

      get() {
        const queueStr = storage.getItem(storageKey);
        if (!queueStr) {
          return [];
        }

        try {
          const queue = JSON.parse(queueStr);
          return Array.isArray(queue) ? queue : [];
        } catch (error) {
          storage.removeItem(storageKey);
          return [];
        }
      },

      set(queue) {
        storage.setItem(
          storageKey,
          JSON.stringify(Array.isArray(queue) ? queue : [])
        );
      },
    };
  }

  function createAutoLikeController({
    storage,
    storageKey = DEFAULT_AUTO_LIKE_STORAGE_KEY,
  }) {
    return {
      isEnabled() {
        return storage.getItem(storageKey) === "true";
      },

      setEnabled(enabled) {
        storage.setItem(storageKey, enabled ? "true" : "false");
      },

      runIfEnabled(run) {
        if (storage.getItem(storageKey) !== "true") {
          return { status: "disabled" };
        }

        return { status: "ran", result: run() };
      },
    };
  }

  async function openNextQueuedTopic({
    baseUrl,
    getReadingQueue,
    navigateTo,
    readingQueueStorage,
  }) {
    let readingQueue = readingQueueStorage.get();

    if (readingQueue.length === 0) {
      readingQueue = await getReadingQueue();
    }

    if (readingQueue.length === 0) {
      return { status: "empty" };
    }

    const topic = readingQueue.shift();
    readingQueueStorage.set(readingQueue);

    const url = buildTopicUrl({ baseUrl, topic });
    navigateTo(url);

    return { status: "opened", topic, url };
  }

  function getTopicsFromTopicListPayload(payload) {
    if (
      payload &&
      payload.topic_list &&
      Array.isArray(payload.topic_list.topics)
    ) {
      return payload.topic_list.topics;
    }

    return [];
  }

  function isEligibleTopic(topic, commentLimit = DEFAULT_COMMENT_LIMIT) {
    return Boolean(topic) && topic.posts_count < commentLimit;
  }

  function getTopicPostCount(topic) {
    const postCount = Number(topic && topic.posts_count);

    return Number.isFinite(postCount) && postCount >= 0
      ? postCount
      : Number.MAX_SAFE_INTEGER;
  }

  function sortTopicsByPostCount(topics = []) {
    return topics
      .map((topic, index) => ({
        index,
        postCount: getTopicPostCount(topic),
        topic,
      }))
      .sort(
        (left, right) =>
          left.postCount - right.postCount || left.index - right.index
      )
      .map((entry) => entry.topic);
  }

  function getTopicId(topic) {
    if (!topic || topic.id === undefined || topic.id === null) {
      return null;
    }

    return String(topic.id);
  }

  function createAbandonedTopicTracker({ getCurrentTopicId = () => null } = {}) {
    const abandonedTopicIds = new Set();

    function normalizeTopicId(topicId) {
      return topicId === undefined || topicId === null ? null : String(topicId);
    }

    function isTopicAbandoned(topic) {
      const topicId = normalizeTopicId(getTopicId(topic));
      return topicId !== null && abandonedTopicIds.has(topicId);
    }

    return {
      recordCurrentTopicAbandoned() {
        const topicId = normalizeTopicId(getCurrentTopicId());
        if (topicId !== null) {
          abandonedTopicIds.add(topicId);
        }
      },

      isTopicAbandoned,

      filterTopics(topics = []) {
        return topics.filter((topic) => !isTopicAbandoned(topic));
      },

      clear() {
        abandonedTopicIds.clear();
      },
    };
  }

  async function getEligibleTopicsFromSource({
    source,
    fetchTopicPage,
    commentLimit = DEFAULT_COMMENT_LIMIT,
    maxTopicPages = DEFAULT_MAX_TOPIC_PAGES,
    topicListLimit = DEFAULT_TOPIC_LIST_LIMIT,
    isTopicExcluded = () => false,
  }) {
    let eligibleTopics = [];

    for (let page = 0; page < maxTopicPages; page++) {
      const result = await fetchTopicPage(source, page);
      const topics = getTopicsFromTopicListPayload(result);

      if (topics.length === 0) {
        break;
      }

      topics.forEach((topic) => {
        if (isEligibleTopic(topic, commentLimit) && !isTopicExcluded(topic)) {
          eligibleTopics.push(topic);
        }
      });

      if (eligibleTopics.length >= topicListLimit) {
        break;
      }
    }

    eligibleTopics = sortTopicsByPostCount(eligibleTopics);

    return eligibleTopics.length > topicListLimit
      ? eligibleTopics.slice(0, topicListLimit)
      : eligibleTopics;
  }

  async function selectReadingQueue({
    fetchTopicPage,
    candidateSources = DEFAULT_CANDIDATE_SOURCES,
    commentLimit = DEFAULT_COMMENT_LIMIT,
    maxTopicPages = DEFAULT_MAX_TOPIC_PAGES,
    topicListLimit = DEFAULT_TOPIC_LIST_LIMIT,
    isTopicExcluded = () => false,
  }) {
    for (const source of candidateSources) {
      const topics = await getEligibleTopicsFromSource({
        source,
        fetchTopicPage,
        commentLimit,
        maxTopicPages,
        topicListLimit,
        isTopicExcluded,
      });

      if (topics.length > 0) {
        return { source, topics };
      }
    }

    return { source: null, topics: [] };
  }

  async function buildReadingQueue(options) {
    const selectedQueue = await selectReadingQueue(options);
    return selectedQueue.topics;
  }

  function getPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function getHighestPositiveInteger(values) {
    const positiveIntegers = values
      .map(getPositiveInteger)
      .filter((value) => value !== null);

    return positiveIntegers.length > 0
      ? Math.max(...positiveIntegers)
      : null;
  }

  function getTopicFinalPostNumber(topicProgress = {}) {
    return getHighestPositiveInteger([
      topicProgress.finalPostNumber,
      topicProgress.highestPostNumber,
      topicProgress.postsCount,
    ]);
  }

  function getTopicCurrentPostNumber(topicProgress = {}) {
    const visiblePostNumbers = Array.isArray(topicProgress.visiblePostNumbers)
      ? topicProgress.visiblePostNumbers
      : [];

    return getHighestPositiveInteger([
      topicProgress.currentPostNumber,
      topicProgress.maxVisiblePostNumber,
      ...visiblePostNumbers,
    ]);
  }

  function getTopicVisiblePostNumber(topicProgress = {}) {
    const visiblePostNumbers = Array.isArray(topicProgress.visiblePostNumbers)
      ? topicProgress.visiblePostNumbers
      : [];

    return getHighestPositiveInteger([
      topicProgress.maxVisiblePostNumber,
      ...visiblePostNumbers,
    ]);
  }

  function getTopicReadThroughPostNumber(topicProgress = {}) {
    const readThroughPostNumbers = Array.isArray(
      topicProgress.readThroughPostNumbers
    )
      ? topicProgress.readThroughPostNumbers
      : [];

    return getHighestPositiveInteger([
      topicProgress.maxReadThroughPostNumber,
      ...readThroughPostNumbers,
    ]);
  }

  function isTopicCompletionReached({
    viewportHeight,
    scrollY,
    documentHeight,
    tolerance = DEFAULT_TOPIC_COMPLETION_TOLERANCE,
    topicCompletionPostTolerance = DEFAULT_TOPIC_COMPLETION_POST_TOLERANCE,
    ...topicProgress
  }) {
    const reachedRenderedBottom =
      viewportHeight + scrollY >= documentHeight - tolerance;

    const finalPostNumber = getTopicFinalPostNumber(topicProgress);
    const readThroughPostNumber = getTopicReadThroughPostNumber(topicProgress);

    if (finalPostNumber !== null) {
      if (
        readThroughPostNumber !== null &&
        readThroughPostNumber >= finalPostNumber
      ) {
        return true;
      }

      const visiblePostNumber = getTopicVisiblePostNumber(topicProgress);

      if (
        visiblePostNumber !== null &&
        visiblePostNumber >= finalPostNumber &&
        !reachedRenderedBottom
      ) {
        return false;
      }

      const currentPostNumber = getTopicCurrentPostNumber(topicProgress);

      if (currentPostNumber !== null) {
        return (
          reachedRenderedBottom &&
          currentPostNumber >= finalPostNumber - topicCompletionPostTolerance
        );
      }
    }

    if (
      finalPostNumber === null &&
      topicProgress.renderedPostCount === 1 &&
      readThroughPostNumber !== null
    ) {
      return true;
    }

    return reachedRenderedBottom;
  }

  function chooseBoundedInteger({ min, max, random }) {
    const randomValue = Math.min(Math.max(random(), 0), 1);
    const value = min + Math.floor(randomValue * (max - min + 1));

    return Math.min(Math.max(value, min), max);
  }

  function resolveReadingProfile(readingProfile = {}) {
    return {
      ...DEFAULT_READING_PROFILE,
      ...readingProfile,
    };
  }

  function chooseScrollAction({
    readingProfile = DEFAULT_READING_PROFILE,
    random = Math.random,
  } = {}) {
    const profile = resolveReadingProfile(readingProfile);

    return {
      stepPixels: chooseBoundedInteger({
        min: profile.minScrollStepPixels,
        max: profile.maxScrollStepPixels,
        random,
      }),
      delayMs: chooseBoundedInteger({
        min: profile.minScrollDelayMs,
        max: profile.maxScrollDelayMs,
        random,
      }),
    };
  }

  function chooseTopicCompletionDelay({
    readingProfile = DEFAULT_READING_PROFILE,
    random = Math.random,
  } = {}) {
    const profile = resolveReadingProfile(readingProfile);
    const fallbackDelay =
      getPositiveInteger(profile.bottomDelayMs) ||
      DEFAULT_READING_PROFILE.bottomDelayMs;
    const minDelay =
      getPositiveInteger(profile.minTopicCompletionDelayMs) || fallbackDelay;
    const maxDelay =
      getPositiveInteger(profile.maxTopicCompletionDelayMs) || minDelay;
    const min = Math.min(minDelay, maxDelay);
    const max = Math.max(minDelay, maxDelay);

    return chooseBoundedInteger({ min, max, random });
  }

  function createTopicStartDelayController({ getTopicKey = () => "" } = {}) {
    let delayedTopicKey = null;

    return {
      shouldDelayTopicStart() {
        return getTopicKey() !== delayedTopicKey;
      },

      recordTopicStartDelay() {
        delayedTopicKey = getTopicKey();
      },

      reset() {
        delayedTopicKey = null;
      },
    };
  }

  function getPostDwellKey(post) {
    if (!post || post.key === undefined || post.key === null) {
      return null;
    }

    return String(post.key);
  }

  function getUniquePostDwellEntries(visiblePosts) {
    const seenKeys = new Set();
    const entries = [];

    visiblePosts.forEach((post) => {
      const postKey = getPostDwellKey(post);
      if (postKey === null || seenKeys.has(postKey)) {
        return;
      }

      seenKeys.add(postKey);
      entries.push({
        key: postKey,
        post,
      });
    });

    return entries;
  }

  function createVisiblePostDwellController({ getTopicKey = () => "" } = {}) {
    let currentTopicKey = null;
    let dwelledPostKeys = new Set();
    let hasInitialVisiblePostBaseline = false;

    function syncTopicKey() {
      const topicKey = getTopicKey();
      if (topicKey !== currentTopicKey) {
        currentTopicKey = topicKey;
        dwelledPostKeys = new Set();
        hasInitialVisiblePostBaseline = false;
      }
    }

    return {
      getPostForDwell(visiblePosts = []) {
        syncTopicKey();

        const dwellEntries = getUniquePostDwellEntries(visiblePosts);

        if (!hasInitialVisiblePostBaseline) {
          dwellEntries.forEach((entry) => {
            dwelledPostKeys.add(entry.key);
          });
          hasInitialVisiblePostBaseline = dwellEntries.length > 0;

          return null;
        }

        const dwellEntry = dwellEntries.find(
          (entry) => !dwelledPostKeys.has(entry.key)
        );

        return dwellEntry ? dwellEntry.post : null;
      },

      recordPostDwell(post) {
        syncTopicKey();

        const postKey = getPostDwellKey(post);
        if (postKey !== null) {
          dwelledPostKeys.add(postKey);
        }
      },

      reset() {
        currentTopicKey = null;
        dwelledPostKeys = new Set();
        hasInitialVisiblePostBaseline = false;
      },
    };
  }

  function clampProbability(value) {
    const probability = Number(value);
    if (!Number.isFinite(probability)) {
      return 0;
    }

    return Math.min(Math.max(probability, 0), 1);
  }

  function createTopicAbandonmentController({
    getTopicKey = () => "",
    random = Math.random,
  } = {}) {
    let currentTopicKey = null;
    let startPostNumber = null;
    let maxObservedPostNumber = null;
    let abandonmentPlan = null;
    let abandonedTopicKeys = new Set();

    function resetCurrentTopicState() {
      startPostNumber = null;
      maxObservedPostNumber = null;
      abandonmentPlan = null;
    }

    function syncTopicKey() {
      const topicKey = getTopicKey();
      if (topicKey !== currentTopicKey) {
        currentTopicKey = topicKey;
        resetCurrentTopicState();
      }
    }

    function buildAbandonmentPlan({ profile, finalPostNumber }) {
      if (
        !profile.topicAbandonmentEnabled ||
        startPostNumber === null ||
        finalPostNumber === null
      ) {
        return { willAbandon: false };
      }

      const unreadSpan = finalPostNumber - startPostNumber + 1;
      if (unreadSpan <= profile.shortTopicPostThreshold) {
        return { willAbandon: false };
      }

      const probability =
        unreadSpan >= profile.longTopicPostThreshold
          ? profile.longTopicAbandonmentProbability
          : profile.topicAbandonmentProbability;
      const willAbandon = random() < clampProbability(probability);
      const maxReadablePosts = Math.max(
        0,
        unreadSpan - profile.minRemainingPostsBeforeAbandon
      );
      const maxPostsBeforeAbandon = Math.min(
        profile.maxPostsBeforeAbandon,
        maxReadablePosts
      );

      if (
        !willAbandon ||
        maxPostsBeforeAbandon < profile.minPostsBeforeAbandon
      ) {
        return { willAbandon: false };
      }

      return {
        willAbandon: true,
        targetReadPostCount: chooseBoundedInteger({
          min: profile.minPostsBeforeAbandon,
          max: maxPostsBeforeAbandon,
          random,
        }),
      };
    }

    return {
      shouldAbandonTopic(topicProgress = {}, readingProfile) {
        syncTopicKey();

        if (abandonedTopicKeys.has(currentTopicKey)) {
          return false;
        }

        const profile = resolveReadingProfile(readingProfile);
        const currentPostNumber = getTopicCurrentPostNumber(topicProgress);
        const finalPostNumber = getTopicFinalPostNumber(topicProgress);

        if (currentPostNumber === null || finalPostNumber === null) {
          return false;
        }

        if (startPostNumber === null) {
          startPostNumber = currentPostNumber;
        }

        maxObservedPostNumber =
          maxObservedPostNumber === null
            ? currentPostNumber
            : Math.max(maxObservedPostNumber, currentPostNumber);

        if (abandonmentPlan === null) {
          abandonmentPlan = buildAbandonmentPlan({
            profile,
            finalPostNumber,
          });
        }

        if (!abandonmentPlan.willAbandon) {
          return false;
        }

        const readPostCount = maxObservedPostNumber - startPostNumber + 1;
        const remainingPostCount = finalPostNumber - maxObservedPostNumber;

        return (
          readPostCount >= abandonmentPlan.targetReadPostCount &&
          remainingPostCount >= profile.minRemainingPostsBeforeAbandon
        );
      },

      recordTopicAbandonment() {
        syncTopicKey();
        abandonedTopicKeys.add(currentTopicKey);
      },

      reset() {
        currentTopicKey = null;
        abandonedTopicKeys = new Set();
        resetCurrentTopicState();
      },
    };
  }

  function choosePostDwellDelay({
    post,
    readingProfile = DEFAULT_READING_PROFILE,
  } = {}) {
    const profile = resolveReadingProfile(readingProfile);
    const textLength =
      post && Number.isFinite(post.textLength) && post.textLength > 0
        ? post.textLength
        : 0;
    const imageCount =
      post && Number.isFinite(post.imageCount) && post.imageCount > 0
        ? post.imageCount
        : 0;
    const imageBonusMs =
      imageCount > 0 ? profile.imagePostDwellBonusMs * imageCount : 0;
    const dwellMs =
      profile.minPostDwellMs +
      textLength * profile.postDwellMsPerCharacter +
      imageBonusMs;

    return Math.min(
      Math.max(dwellMs, profile.minPostDwellMs),
      profile.maxPostDwellMs
    );
  }

  function createReadStateTrustGuard({
    isPageHidden = () => false,
    hasPageFocus = () => true,
    getTimingRequestTrust = () => ({ trusted: true }),
    pauseOnHiddenTab = true,
    pauseOnUnfocusedPage = true,
  } = {}) {
    return {
      getTrustState() {
        if (pauseOnHiddenTab && isPageHidden()) {
          return {
            trusted: false,
            reason: READ_STATE_PAUSE_REASONS.hiddenTab,
          };
        }

        if (pauseOnUnfocusedPage && !hasPageFocus()) {
          return {
            trusted: false,
            reason: READ_STATE_PAUSE_REASONS.unfocusedPage,
          };
        }

        const timingRequestTrust = getTimingRequestTrust();
        if (timingRequestTrust && timingRequestTrust.trusted === false) {
          return timingRequestTrust;
        }

        return { trusted: true };
      },
    };
  }

  function getRequestUrl(request) {
    if (typeof request === "string") {
      return request;
    }

    if (request && typeof request.url === "string") {
      return request.url;
    }

    return "";
  }

  function isTopicTimingRequestUrl(request) {
    const requestUrl = getRequestUrl(request);
    if (!requestUrl) {
      return false;
    }

    try {
      const url = new URL(requestUrl, "https://example.invalid");
      return url.pathname === "/topics/timings";
    } catch (error) {
      return false;
    }
  }

  function createTimingRequestMonitor({ maxConsecutiveFailures = 3 } = {}) {
    let consecutiveFailures = 0;

    return {
      recordFailure(request) {
        if (!isTopicTimingRequestUrl(request)) {
          return;
        }

        consecutiveFailures += 1;
      },

      recordSuccess(request) {
        if (!isTopicTimingRequestUrl(request)) {
          return;
        }

        consecutiveFailures = 0;
      },

      getConsecutiveFailures() {
        return consecutiveFailures;
      },

      resetFailures() {
        consecutiveFailures = 0;
      },

      getTrustState() {
        if (consecutiveFailures >= maxConsecutiveFailures) {
          return {
            trusted: false,
            reason: READ_STATE_PAUSE_REASONS.timingFailures,
          };
        }

        return { trusted: true };
      },
    };
  }

  function installTimingRequestMonitor({
    globalObject,
    timingMonitor,
  } = {}) {
    if (!globalObject || !timingMonitor) {
      return { uninstall() {} };
    }

    const uninstallers = [];

    if (typeof globalObject.fetch === "function") {
      const originalFetch = globalObject.fetch;

      globalObject.fetch = function monitoredFetch(...args) {
        const request = args[0];

        return Promise.resolve(originalFetch.apply(this, args)).then(
          (response) => {
            if (response && response.ok) {
              timingMonitor.recordSuccess(request);
            } else {
              timingMonitor.recordFailure(request);
            }

            return response;
          },
          (error) => {
            timingMonitor.recordFailure(request);
            throw error;
          }
        );
      };

      uninstallers.push(() => {
        globalObject.fetch = originalFetch;
      });
    }

    const XMLHttpRequestCtor = globalObject.XMLHttpRequest;
    if (
      typeof XMLHttpRequestCtor === "function" &&
      XMLHttpRequestCtor.prototype &&
      typeof XMLHttpRequestCtor.prototype.open === "function" &&
      typeof XMLHttpRequestCtor.prototype.send === "function"
    ) {
      const originalOpen = XMLHttpRequestCtor.prototype.open;
      const originalSend = XMLHttpRequestCtor.prototype.send;

      XMLHttpRequestCtor.prototype.open = function monitoredOpen(...args) {
        this.__autoReadTimingRequest = args[1];
        return originalOpen.apply(this, args);
      };

      XMLHttpRequestCtor.prototype.send = function monitoredSend(...args) {
        const request = this.__autoReadTimingRequest;

        if (
          isTopicTimingRequestUrl(request) &&
          typeof this.addEventListener === "function"
        ) {
          this.addEventListener("loadend", () => {
            if (this.status >= 200 && this.status < 400) {
              timingMonitor.recordSuccess(request);
            } else {
              timingMonitor.recordFailure(request);
            }
          });
        }

        return originalSend.apply(this, args);
      };

      uninstallers.push(() => {
        XMLHttpRequestCtor.prototype.open = originalOpen;
        XMLHttpRequestCtor.prototype.send = originalSend;
      });
    }

    return {
      uninstall() {
        uninstallers.forEach((uninstall) => {
          uninstall();
        });
      },
    };
  }

  async function continueTopicReading({
    isActive,
    getReadStateTrust = () => ({ trusted: true }),
    isTopicReady = () => true,
    clearTimers = () => {},
    pauseReading = () => {},
    getViewportMetrics,
    scrollTopic,
    scheduleNextCheck,
    scheduleTopicCompletion = () => {},
    advanceSession,
    shouldDelayTopicStart = () => false,
    recordTopicStartDelay = () => {},
    getVisiblePosts = () => [],
    getPostForDwell = () => null,
    recordPostDwell = () => {},
    getTopicProgress = () => ({}),
    shouldAbandonTopic = () => false,
    recordTopicAbandonment = () => {},
    readingProfile,
    random,
    tolerance,
  }) {
    if (!isActive()) {
      return { status: "inactive" };
    }

    const readStateTrust = getReadStateTrust();
    if (readStateTrust && readStateTrust.trusted === false) {
      clearTimers();
      pauseReading(readStateTrust.reason);
      return {
        status: "paused",
        reason: readStateTrust.reason,
      };
    }

    if (!isTopicReady()) {
      scheduleNextCheck();
      return { status: "waiting" };
    }

    const profile = resolveReadingProfile(readingProfile);

    if (shouldDelayTopicStart()) {
      recordTopicStartDelay();
      scheduleNextCheck(profile.topicStartDelayMs);
      return {
        status: "waiting-topic-start",
        delayMs: profile.topicStartDelayMs,
      };
    }

    const postForDwell = getPostForDwell(getVisiblePosts());
    if (postForDwell) {
      recordPostDwell(postForDwell);
      const delayMs = choosePostDwellDelay({
        post: postForDwell,
        readingProfile: profile,
      });

      scheduleNextCheck(delayMs);
      return { status: "dwelling-post", post: postForDwell, delayMs };
    }

    const topicProgress = getTopicProgress();
    const viewportMetrics = getViewportMetrics();

    if (
      isTopicCompletionReached({
        ...viewportMetrics,
        ...topicProgress,
        tolerance,
      })
    ) {
      const completionDelayMs = chooseTopicCompletionDelay({
        readingProfile: profile,
        random,
      });

      scheduleTopicCompletion(completionDelayMs, advanceSession);
      return { status: "waiting-bottom", delayMs: completionDelayMs };
    }

    if (shouldAbandonTopic(topicProgress, profile)) {
      recordTopicAbandonment(topicProgress);
      const advanceResult = await advanceSession({
        reason: "abandoned-topic",
        topicProgress,
      });

      return {
        status: "abandoned-topic",
        advanceResult,
        topicProgress,
      };
    }

    const scrollAction = chooseScrollAction({ readingProfile, random });

    scrollTopic(scrollAction);
    scheduleNextCheck(scrollAction.delayMs);
    return { status: "scrolling", scrollAction };
  }

  function createAutoReadingSession({
    baseUrl,
    getActiveState,
    setActiveState,
    getReadStateTrust = () => ({ trusted: true }),
    getReadingQueue,
    navigateTo,
    readingQueueStorage,
    clearTimers = () => {},
    setControlLabel = () => {},
    setControlTitle = () => {},
    showUserMessage = () => {},
    logDiagnostic = () => {},
    labels = {},
    messages = {},
  }) {
    const sessionLabels = {
      ...DEFAULT_SESSION_LABELS,
      ...labels,
    };
    const sessionMessages = {
      ...DEFAULT_SESSION_MESSAGES,
      ...messages,
    };
    let readStatePauseReason = null;

    function isActive() {
      return getActiveState() === true;
    }

    function isLoginRequiredError(error) {
      return error && error.name === "LoginRequiredError";
    }

    function getPauseMessage(reason) {
      if (reason === READ_STATE_PAUSE_REASONS.hiddenTab) {
        return sessionMessages.hiddenTabPause;
      }

      if (reason === READ_STATE_PAUSE_REASONS.timingFailures) {
        return sessionMessages.timingFailuresPause;
      }

      if (reason === READ_STATE_PAUSE_REASONS.unfocusedPage) {
        return sessionMessages.unfocusedPagePause;
      }

      return sessionMessages.genericError;
    }

    function pause(reason, options = {}) {
      readStatePauseReason = reason;
      if (!options.timersAlreadyCleared) {
        clearTimers();
      }
      setControlLabel(sessionLabels.stop);
      setControlTitle(getPauseMessage(reason));

      return {
        status: "paused",
        reason,
      };
    }

    function pauseForUntrustedReadState(readStateTrust) {
      return pause(readStateTrust.reason);
    }

    function resume() {
      if (readStatePauseReason === null) {
        return { status: "active" };
      }

      readStatePauseReason = null;
      setControlLabel(sessionLabels.stop);
      setControlTitle("");

      return { status: "resumed" };
    }

    function getPauseReason() {
      return readStatePauseReason;
    }

    async function advance() {
      if (!isActive()) {
        return { status: "inactive" };
      }

      const readStateTrust = getReadStateTrust();
      if (readStateTrust && readStateTrust.trusted === false) {
        return pauseForUntrustedReadState(readStateTrust);
      }

      if (readStatePauseReason !== null) {
        resume();
      } else {
        setControlTitle("");
      }
      clearTimers();

      let result;
      try {
        result = await openNextQueuedTopic({
          baseUrl,
          getReadingQueue,
          navigateTo,
          readingQueueStorage,
        });
      } catch (error) {
        const loginRequired = isLoginRequiredError(error);

        logDiagnostic("Auto-Reading Session Error", error);
        stop(loginRequired ? error.message : sessionMessages.genericError, {
          visible: loginRequired,
        });

        return { status: "error", error };
      }

      if (result.status === "empty") {
        return stop(sessionMessages.noTopics);
      }

      return result;
    }

    async function start() {
      setActiveState(true);
      readStatePauseReason = null;
      readingQueueStorage.clear();
      setControlTitle("");
      setControlLabel(sessionLabels.stop);

      return advance();
    }

    function startCurrentTopic() {
      setActiveState(true);
      readStatePauseReason = null;
      readingQueueStorage.clear();
      clearTimers();
      setControlTitle("");
      setControlLabel(sessionLabels.stop);

      return { status: "reading-current-topic" };
    }

    function stop(message, options = {}) {
      setActiveState(false);
      readStatePauseReason = null;
      readingQueueStorage.clear();
      clearTimers();
      setControlLabel(sessionLabels.start);

      if (message) {
        setControlTitle(message);
        if (options.visible) {
          showUserMessage(message);
        }
      }

      return { status: "stopped" };
    }

    function toggle() {
      return isActive() ? stop() : start();
    }

    return {
      advance,
      getPauseReason,
      isActive,
      pause,
      resume,
      start,
      startCurrentTopic,
      stop,
      toggle,
    };
  }

  return {
    DEFAULT_CANDIDATE_SOURCES,
    DEFAULT_AUTO_LIKE_STORAGE_KEY,
    DEFAULT_COMMENT_LIMIT,
    DEFAULT_MAX_TOPIC_PAGES,
    DEFAULT_READING_PROFILE,
    DEFAULT_READING_QUEUE_STORAGE_KEY,
    DEFAULT_TOPIC_COMPLETION_TOLERANCE,
    DEFAULT_TOPIC_LIST_LIMIT,
    READ_STATE_PAUSE_REASONS,
    continueTopicReading,
    createAbandonedTopicTracker,
    createAutoLikeController,
    createAutoReadingSession,
    createReadStateTrustGuard,
    createTimingRequestMonitor,
    createTopicAbandonmentController,
    createTopicStartDelayController,
    createVisiblePostDwellController,
    buildTopicUrl,
    buildReadingQueue,
    choosePostDwellDelay,
    chooseScrollAction,
    chooseTopicCompletionDelay,
    createReadingQueueStorage,
    getTopicIdFromPathname,
    getTopicSessionKeyFromPathname,
    DEFAULT_TRANSIENT_READ_STATE_RECOVERY_DELAY_MS,
    getEligibleTopicsFromSource,
    getReadPosition,
    getTopicsFromTopicListPayload,
    installTimingRequestMonitor,
    isTopicCompletionReached,
    isEligibleTopic,
    normalizeBaseUrl,
    openNextQueuedTopic,
    selectReadingQueue,
  };
})();

if (typeof module === "object" && module.exports && typeof window === "undefined") {
  module.exports = AutoReadCore;
} else {
  (function () {
  ("use strict");
  const SITE_CONFIGS = {
    "linux.do": {
      siteName: "linux.do",
      topicListPath: "/new",
    },
    "nodeloc.com": {
      siteName: "nodeloc.com",
      topicListPath: "/new",
    },
    "www.nodeloc.com": {
      siteName: "nodeloc.com",
      topicListPath: "/new",
    },
  };

  function resolveSiteConfig(location) {
    const config = SITE_CONFIGS[location.hostname];
    if (!config) {
      return null;
    }

    return {
      ...config,
      baseUrl: location.origin,
    };
  }

  const siteConfig = resolveSiteConfig(window.location);
  if (!siteConfig) {
    console.warn("Auto Read 不支持当前站点:", window.location.hostname);
    return;
  }

  const BASE_URL = siteConfig.baseUrl;
  const topicListPath = siteConfig.topicListPath;
  const topicListUrl = `${BASE_URL}${topicListPath}`;
  const topicListNavigationDelay = 1500;
  const topicListWaitDelay = 2000;
  const maxTopicListWaitAttempts = 10;
  const recentReadTopicStorageKey = "recentReadTopicIds";
  const recentReadTopicLimit = 2;
  const staleTopicListRefreshStorageKey = "staleTopicListRefreshTopicId";
  const diagnosticLogStorageKey = "autoReadDiagnosticLogs";
  const diagnosticLogLimit = 200;
  const expectedReturnUrlStorageKey = "autoReadLastExpectedReturnUrl";
  const lastTopicClickUrlStorageKey = "autoReadLastTopicClickUrl";
  const returningTopicIdStorageKey = "autoReadReturningTopicId";
  const returningStartedAtStorageKey = "autoReadReturningStartedAt";
  const topicListReturnFallbackDelay = 2500;
  const likeLimit = 50;
  const readingQueueStorage = AutoReadCore.createReadingQueueStorage({
    storage: localStorage,
  });
  const sessionReadingQueueStorage = {
    clear() {
      readingQueueStorage.clear();
      abandonedTopicTracker.clear();
      localStorage.removeItem("topicList");
    },
    get() {
      return readingQueueStorage.get();
    },
    set(queue) {
      readingQueueStorage.set(queue);
    },
  };
  const autoLikeController = AutoReadCore.createAutoLikeController({
    storage: localStorage,
  });
  const timingRequestMonitor = AutoReadCore.createTimingRequestMonitor({
    maxConsecutiveFailures:
      AutoReadCore.DEFAULT_READING_PROFILE.maxConsecutiveTimingFailures,
  });
  AutoReadCore.installTimingRequestMonitor({
    globalObject: window,
    timingMonitor: timingRequestMonitor,
  });

  console.log("脚本正在运行在: " + siteConfig.siteName, BASE_URL);
  function getAutoReadDiagnosticState(extra = {}) {
    return {
      url: window.location.href,
      pathname: window.location.pathname,
      referrer: document.referrer || "",
      historyLength: window.history.length,
      read: localStorage.getItem("read"),
      hidden: document.hidden === true,
      hasFocus:
        typeof document.hasFocus === "function" ? document.hasFocus() : null,
      openingTopic,
      navigatingToNextTopic: localStorage.getItem("navigatingToNextTopic"),
      expectedReturnUrl: localStorage.getItem(expectedReturnUrlStorageKey),
      lastTopicClickUrl: localStorage.getItem(lastTopicClickUrlStorageKey),
      returningTopicId: localStorage.getItem(returningTopicIdStorageKey),
      returningStartedAt: localStorage.getItem(returningStartedAtStorageKey),
      timingFailures: timingRequestMonitor.getConsecutiveFailures(),
      ...extra,
    };
  }

  function logAutoReadDiagnostic(eventName, extra = {}) {
    const state = getAutoReadDiagnosticState(extra);
    console.log(
      `[AutoReadDiag] ${eventName}`,
      state
    );
    persistAutoReadDiagnostic(eventName, state);
  }

  function getPersistedAutoReadDiagnostics() {
    const logs = localStorage.getItem(diagnosticLogStorageKey);
    if (!logs) {
      return [];
    }

    try {
      const parsedLogs = JSON.parse(logs);
      return Array.isArray(parsedLogs) ? parsedLogs : [];
    } catch (error) {
      localStorage.removeItem(diagnosticLogStorageKey);
      return [];
    }
  }

  function persistAutoReadDiagnostic(eventName, state) {
    try {
      const logs = getPersistedAutoReadDiagnostics();
      logs.push({
        at: new Date().toISOString(),
        event: eventName,
        state,
      });
      localStorage.setItem(
        diagnosticLogStorageKey,
        JSON.stringify(logs.slice(-diagnosticLogLimit))
      );
    } catch (error) {
      console.warn("[AutoReadDiag] failed to persist diagnostic log", error);
    }
  }

  window.AutoReadDiag = {
    dump() {
      return getPersistedAutoReadDiagnostics();
    },
    clear() {
      localStorage.removeItem(diagnosticLogStorageKey);
      console.log("[AutoReadDiag] cleared");
    },
  };

  function isTransientReadStatePause(reason) {
    return (
      reason === AutoReadCore.READ_STATE_PAUSE_REASONS.hiddenTab ||
      reason === AutoReadCore.READ_STATE_PAUSE_REASONS.unfocusedPage ||
      reason === AutoReadCore.READ_STATE_PAUSE_REASONS.timingFailures
    );
  }

  function recoverFromTransientReadStatePause(reason) {
    if (!autoReadingSession || !autoReadingSession.isActive()) {
      return;
    }

    if (!isTransientReadStatePause(reason)) {
      return;
    }

    logAutoReadDiagnostic("transient-pause-retry-scheduled", { reason });

    if (reason === AutoReadCore.READ_STATE_PAUSE_REASONS.timingFailures) {
      timingRequestMonitor.resetFailures();
    }

    scheduleActiveRouteCheck(
      AutoReadCore.DEFAULT_TRANSIENT_READ_STATE_RECOVERY_DELAY_MS
    );
  }
  //1.进入网页 https://<supported-site>/t/topic/数字（1，2，3，4）
  //2.使滚轮均衡的往下移动模拟刷文章
  // 检查是否是第一次运行脚本
  function checkFirstRun() {
    if (localStorage.getItem("isFirstRun") === null) {
      console.log("脚本第一次运行，执行初始化操作...");
      updateInitialData();
      localStorage.setItem("isFirstRun", "false");
    } else {
      console.log("脚本非第一次运行");
    }
  }

  // 更新初始数据的函数
  function updateInitialData() {
    localStorage.setItem("read", "false"); // 开始时自动滚动关闭
    autoLikeController.setEnabled(false); //默认关闭自动点赞
    console.log("执行了初始数据更新操作");
  }
  const topicReadinessDelay = 2000; // Topic Posts render check interval.
  let checkScrollTimeout = null;
  let routeCheckTimeout = null;
  let autoLikeInterval = null;
  let openingTopic = false;
  let topicClickStartedAt = null;
  let topicListWaitAttempts = 0;
  let autoLikedTopicKey = null;
  const abandonedTopicTracker = AutoReadCore.createAbandonedTopicTracker({
    getCurrentTopicId: () =>
      AutoReadCore.getTopicIdFromPathname(window.location.pathname),
  });
  const topicStartDelayController =
    AutoReadCore.createTopicStartDelayController({
      getTopicKey: getCurrentTopicSessionKey,
    });
  const visiblePostDwellController =
    AutoReadCore.createVisiblePostDwellController({
      getTopicKey: getCurrentTopicSessionKey,
    });
  const topicAbandonmentController =
    AutoReadCore.createTopicAbandonmentController({
      getTopicKey: getCurrentTopicSessionKey,
    });
  const readStateTrustGuard = AutoReadCore.createReadStateTrustGuard({
    isPageHidden: () => document.hidden === true,
    hasPageFocus: () =>
      typeof document.hasFocus === "function" ? document.hasFocus() : true,
    getTimingRequestTrust: timingRequestMonitor.getTrustState,
    pauseOnHiddenTab: false,
    pauseOnUnfocusedPage: false,
  });

  function isReadingEnabled() {
    return localStorage.getItem("read") === "true";
  }

  function isTopicPage() {
    return /^\/t\/[^/]+\/\d+(?:\/\d+)?\/?$/.test(window.location.pathname);
  }

  function isTopicListPage() {
    return window.location.pathname.replace(/\/+$/, "") === topicListPath;
  }

  function getCurrentTopicSessionKey() {
    return AutoReadCore.getTopicSessionKeyFromPathname(window.location.pathname);
  }

  function clearReadTimers() {
    if (checkScrollTimeout !== null) {
      clearTimeout(checkScrollTimeout);
      checkScrollTimeout = null;
    }
    if (routeCheckTimeout !== null) {
      clearTimeout(routeCheckTimeout);
      routeCheckTimeout = null;
    }
    topicStartDelayController.reset();
    visiblePostDwellController.reset();
    topicAbandonmentController.reset();
    autoLikedTopicKey = null;
    localStorage.removeItem("navigatingToNextTopic");
    localStorage.removeItem(staleTopicListRefreshStorageKey);
  }

  let autoReadingSession = null;

  function pauseAutoReadingForReason(reason, options = {}) {
    logAutoReadDiagnostic("pause", { reason });
    const result = autoReadingSession.pause(reason, options);
    recoverFromTransientReadStatePause(reason);
    return result;
  }

  function continueAfterTrustedPageState() {
    logAutoReadDiagnostic("resume-after-trusted-state", {
      reason: autoReadingSession.getPauseReason(),
    });
    autoReadingSession.resume();
    continueAutoReadFlow();
  }

  function handleReadStateTrustChange() {
    if (!autoReadingSession || !autoReadingSession.isActive()) {
      return;
    }

    const readStateTrust = readStateTrustGuard.getTrustState();
    if (readStateTrust.trusted === false) {
      pauseAutoReadingForReason(readStateTrust.reason);
      return;
    }

    if (autoReadingSession.getPauseReason() !== null) {
      continueAfterTrustedPageState();
    }
  }

  function scrollTopicOnce(scrollAction) {
    window.scrollBy(0, scrollAction.stepPixels);
  }

  function scheduleActiveRouteCheck(delayMs = topicListNavigationDelay) {
    logAutoReadDiagnostic("route-check-scheduled", { delayMs });
    if (routeCheckTimeout !== null) {
      clearTimeout(routeCheckTimeout);
    }
    routeCheckTimeout = setTimeout(() => {
      routeCheckTimeout = null;
      logAutoReadDiagnostic("route-check-fired");
      continueAutoReadFlow();
    }, delayMs);
  }

  function getTopicIdFromLink(link) {
    try {
      const url = new URL(link.href, BASE_URL);
      return AutoReadCore.getTopicIdFromPathname(url.pathname);
    } catch (error) {
      return null;
    }
  }

  function getRecentReadTopicIds() {
    const recentReadTopicIds = localStorage.getItem(recentReadTopicStorageKey);
    if (!recentReadTopicIds) {
      return [];
    }

    try {
      const parsedTopicIds = JSON.parse(recentReadTopicIds);
      return Array.isArray(parsedTopicIds)
        ? parsedTopicIds.filter((topicId) => topicId !== null).map(String)
        : [];
    } catch (error) {
      localStorage.removeItem(recentReadTopicStorageKey);
      return [];
    }
  }

  function recordRecentReadTopic(topicId) {
    if (topicId === null) {
      return;
    }

    const normalizedTopicId = String(topicId);
    const recentReadTopicIds = [
      normalizedTopicId,
      ...getRecentReadTopicIds().filter(
        (recentTopicId) => recentTopicId !== normalizedTopicId
      ),
    ].slice(0, recentReadTopicLimit);

    localStorage.setItem(
      recentReadTopicStorageKey,
      JSON.stringify(recentReadTopicIds)
    );
  }

  function recordCurrentTopicRead() {
    recordRecentReadTopic(
      AutoReadCore.getTopicIdFromPathname(window.location.pathname)
    );
  }

  function markReturningToTopicList() {
    const topicId = AutoReadCore.getTopicIdFromPathname(window.location.pathname);
    if (topicId === null) {
      return;
    }

    localStorage.setItem(returningTopicIdStorageKey, String(topicId));
    localStorage.setItem(returningStartedAtStorageKey, Date.now().toString());
    localStorage.setItem(expectedReturnUrlStorageKey, topicListUrl);
    logAutoReadDiagnostic("return-to-topic-list-marked", { topicId });
  }

  function clearReturningToTopicList(reason) {
    if (localStorage.getItem(returningTopicIdStorageKey) === null) {
      return;
    }

    logAutoReadDiagnostic("return-to-topic-list-cleared", { reason });
    localStorage.removeItem(returningTopicIdStorageKey);
    localStorage.removeItem(returningStartedAtStorageKey);
  }

  function shouldFallbackToTopicListFromTopicPage() {
    const returningTopicId = localStorage.getItem(returningTopicIdStorageKey);
    if (returningTopicId === null) {
      return false;
    }

    const currentTopicId = AutoReadCore.getTopicIdFromPathname(
      window.location.pathname
    );
    if (currentTopicId !== returningTopicId) {
      clearReturningToTopicList("different-topic");
      return false;
    }

    const startedAt = Number(localStorage.getItem(returningStartedAtStorageKey));
    const elapsedMs = Number.isFinite(startedAt) ? Date.now() - startedAt : null;

    return elapsedMs === null || elapsedMs >= topicListReturnFallbackDelay;
  }

  function fallbackToTopicListAfterReturnBounce() {
    logAutoReadDiagnostic("return-to-topic-list-bounced-to-topic", {
      topicListUrl,
    });
    clearReturningToTopicList("fallback-navigation");
    window.location.href = topicListUrl;

    return { status: "fallback-topic-list-navigation", url: topicListUrl };
  }

  function isRecentlyReadTopicId(topicId) {
    return topicId !== null && getRecentReadTopicIds().includes(String(topicId));
  }

  function isUsableTopicListLink(link) {
    const topicId = getTopicIdFromLink(link);
    if (
      topicId === null ||
      abandonedTopicTracker.isTopicAbandoned({ id: topicId })
    ) {
      return false;
    }

    const rect = link.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getTopicListLinks() {
    const selectors = [
      "#list-area .topic-list .topic-list-item .main-link a.title",
      "#list-area .topic-list .topic-list-item a.raw-topic-link",
      ".topic-list-item .main-link a.title",
      ".topic-list-item a.raw-topic-link",
      "a.title.raw-link.raw-topic-link",
      "a.raw-topic-link",
    ];

    return Array.from(document.querySelectorAll(selectors.join(","))).filter(
      isUsableTopicListLink
    );
  }

  function getFirstTopicListLink() {
    return getTopicListLinks()[0] || null;
  }

  function getFirstUnreadTopicListLink() {
    return (
      getTopicListLinks().find(
        (link) => !isRecentlyReadTopicId(getTopicIdFromLink(link))
      ) || null
    );
  }

  function refreshStaleTopicList(topicId) {
    console.log("new 页面第一个主题刚读过，刷新列表后再读取。", topicId);
    localStorage.setItem(staleTopicListRefreshStorageKey, String(topicId));
    openingTopic = false;
    topicClickStartedAt = null;
    window.location.reload();

    return { status: "refreshing-stale-topic-list", topicId };
  }

  function anchorTopicListReturnUrl(topicUrl) {
    localStorage.setItem(expectedReturnUrlStorageKey, topicListUrl);
    localStorage.setItem(lastTopicClickUrlStorageKey, topicUrl);

    try {
      window.history.pushState(
        { autoReadReturnUrl: topicListUrl, autoReadTopicUrl: topicUrl },
        document.title,
        topicListUrl
      );
      logAutoReadDiagnostic("topic-list-return-anchor-pushed", {
        topicUrl,
        expectedReturnUrl: topicListUrl,
      });
    } catch (error) {
      logAutoReadDiagnostic("topic-list-return-anchor-error", {
        topicUrl,
        expectedReturnUrl: topicListUrl,
        message: error && error.message ? error.message : String(error),
      });
    }
  }

  function chooseTopicListLink() {
    const firstTopicLink = getFirstTopicListLink();
    if (!firstTopicLink) {
      return null;
    }

    const firstTopicId = getTopicIdFromLink(firstTopicLink);
    if (!isRecentlyReadTopicId(firstTopicId)) {
      localStorage.removeItem(staleTopicListRefreshStorageKey);
      return firstTopicLink;
    }

    const refreshedTopicId = localStorage.getItem(
      staleTopicListRefreshStorageKey
    );
    if (refreshedTopicId !== String(firstTopicId)) {
      return refreshStaleTopicList(firstTopicId);
    }

    localStorage.removeItem(staleTopicListRefreshStorageKey);
    return getFirstUnreadTopicListLink();
  }

  function openFirstTopicFromList() {
    logAutoReadDiagnostic("open-first-topic-from-list-enter");
    if (openingTopic) {
      const topicClickTimedOut =
        topicClickStartedAt !== null && Date.now() - topicClickStartedAt > 8000;

      if (!topicClickTimedOut) {
        logAutoReadDiagnostic("topic-click-still-opening", {
          elapsedMs:
            topicClickStartedAt === null ? null : Date.now() - topicClickStartedAt,
        });
        scheduleActiveRouteCheck(topicListNavigationDelay);
        return { status: "opening" };
      }

      logAutoReadDiagnostic("topic-click-timeout");
      openingTopic = false;
      topicClickStartedAt = null;
    }

    const topicLink = chooseTopicListLink();
    if (topicLink && topicLink.status === "refreshing-stale-topic-list") {
      return topicLink;
    }

    if (!topicLink) {
      topicListWaitAttempts += 1;

      if (topicListWaitAttempts >= maxTopicListWaitAttempts) {
        logAutoReadDiagnostic("topic-list-empty-stop", {
          topicListWaitAttempts,
        });
        return autoReadingSession.stop("new 页面没有可点击主题，已停止自动阅读。");
      }

      logAutoReadDiagnostic("topic-list-waiting", {
        topicListWaitAttempts,
      });
      scheduleActiveRouteCheck(topicListWaitDelay);
      return { status: "waiting-topic-list" };
    }

    topicListWaitAttempts = 0;
    openingTopic = true;
    topicClickStartedAt = Date.now();
    localStorage.setItem("navigatingToNextTopic", "true");
    topicLink.scrollIntoView({ block: "center" });
    logAutoReadDiagnostic("topic-click", {
      topicUrl: topicLink.href,
      topicId: getTopicIdFromLink(topicLink),
    });
    anchorTopicListReturnUrl(topicLink.href);
    topicLink.click();
    scheduleActiveRouteCheck(topicListNavigationDelay);

    return { status: "clicked-topic", url: topicLink.href };
  }

  function goToTopicList() {
    logAutoReadDiagnostic("go-to-topic-list-enter", { topicListUrl });
    if (window.location.href === topicListUrl) {
      scheduleActiveRouteCheck(topicListNavigationDelay);
      return { status: "already-topic-list" };
    }

    window.location.href = topicListUrl;
    return { status: "opening-topic-list", url: topicListUrl };
  }

  function goBackToTopicList() {
    logAutoReadDiagnostic("go-back-to-topic-list-enter", { topicListUrl });
    markReturningToTopicList();
    recordCurrentTopicRead();
    clearReadTimers();
    openingTopic = false;
    topicClickStartedAt = null;
    topicListWaitAttempts = 0;

    if (window.history.length > 1) {
      window.history.back();
      logAutoReadDiagnostic("history-back-called");
      scheduleActiveRouteCheck(topicListNavigationDelay + topicListReturnFallbackDelay);
      return { status: "back-to-topic-list" };
    }

    clearReturningToTopicList("no-history-fallback");
    window.location.href = topicListUrl;
    logAutoReadDiagnostic("fallback-topic-list-navigation", { topicListUrl });
    return { status: "opening-topic-list", url: topicListUrl };
  }

  function continueAutoReadFlow() {
    logAutoReadDiagnostic("continue-flow-enter", {
      isTopicPage: isTopicPage(),
      isTopicListPage: isTopicListPage(),
    });
    if (!autoReadingSession || !autoReadingSession.isActive()) {
      logAutoReadDiagnostic("continue-flow-inactive");
      return { status: "inactive" };
    }

    const readStateTrust = readStateTrustGuard.getTrustState();
    if (readStateTrust.trusted === false) {
      return pauseAutoReadingForReason(readStateTrust.reason);
    }

    if (autoReadingSession.getPauseReason() !== null) {
      autoReadingSession.resume();
    }

    if (isTopicPage()) {
      if (shouldFallbackToTopicListFromTopicPage()) {
        return fallbackToTopicListAfterReturnBounce();
      }

      logAutoReadDiagnostic("continue-flow-topic-page");
      openingTopic = false;
      topicClickStartedAt = null;
      topicListWaitAttempts = 0;
      checkScroll();
      runAutoLikeOnceForCurrentTopic();
      return { status: "reading-topic" };
    }

    if (isTopicListPage()) {
      clearReturningToTopicList("topic-list-page");
      logAutoReadDiagnostic("continue-flow-topic-list-page");
      return openFirstTopicFromList();
    }

    logAutoReadDiagnostic("continue-flow-unknown-page");
    return goToTopicList();
  }

  function runAutoLikeOnceForCurrentTopic() {
    const topicKey = getCurrentTopicSessionKey();
    if (autoLikedTopicKey === topicKey) {
      return;
    }

    autoLikedTopicKey = topicKey;
    autoLikeController.runIfEnabled(autoLike);
  }

  function getRenderedDocumentHeight() {
    return Math.max(
      document.body ? document.body.offsetHeight : 0,
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.clientHeight : 0,
      document.documentElement ? document.documentElement.offsetHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
  }

  function getViewportMetrics() {
    return {
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      documentHeight: getRenderedDocumentHeight(),
    };
  }

  function isTopicContentReady() {
    return Boolean(
      document.querySelector(
        ".topic-post, article[data-post-id], .post-stream .topic-body"
      )
    );
  }

  function isElementMeaningfullyVisibleForDwell(element) {
    const rect = element.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight
    ) {
      return false;
    }

    const visibleHeight =
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    const requiredVisibleHeight = Math.min(160, rect.height * 0.35);

    return (
      visibleHeight >= requiredVisibleHeight ||
      (rect.top >= 0 && rect.top <= window.innerHeight * 0.65)
    );
  }

  function getPostRootElement(element) {
    return (
      element.closest(".topic-post[data-post-number]") ||
      element.closest(".topic-post") ||
      element.closest("article[data-post-id]") ||
      element.closest("[data-post-id]") ||
      element.closest("article") ||
      element
    );
  }

  function getMatchingElementAttribute(element, selector, attributeName) {
    const matchingElement =
      (element.matches(selector) ? element : null) ||
      element.closest(selector) ||
      element.querySelector(selector);

    return matchingElement ? matchingElement.getAttribute(attributeName) : null;
  }

  function getPostElementNumber(element) {
    const postNumber = getMatchingElementAttribute(
      element,
      ".topic-post[data-post-number], [data-post-number]",
      "data-post-number"
    );
    const numericPostNumber = Number(postNumber);

    return Number.isInteger(numericPostNumber) && numericPostNumber > 0
      ? numericPostNumber
      : null;
  }

  function getPostReadThroughElement(element) {
    return (
      (element.matches(".topic-body .cooked, .topic-body, .cooked")
        ? element
        : null) ||
      element.querySelector(".topic-body .cooked, .topic-body, .cooked") ||
      element
    );
  }

  function isElementReadThroughForCompletion(element) {
    const rect = element.getBoundingClientRect();

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top < window.innerHeight &&
      rect.bottom <= window.innerHeight
    );
  }

  function getPostElementKey(element, fallbackIndex) {
    const textPreview = (element.textContent || "").trim().slice(0, 80);
    const postNumber = getMatchingElementAttribute(
      element,
      ".topic-post[data-post-number], [data-post-number]",
      "data-post-number"
    );
    const postId = getMatchingElementAttribute(
      element,
      "[data-post-id]",
      "data-post-id"
    );

    return (
      (postNumber ? `post-number:${postNumber}` : null) ||
      (postId ? `post-id:${postId}` : null) ||
      element.id ||
      `${getCurrentTopicSessionKey()}:visible-post-${fallbackIndex}:${textPreview}`
    );
  }

  function getVisiblePostsForDwell() {
    const roots = [];
    const seenRoots = new Set();

    document
      .querySelectorAll(".topic-post, article[data-post-id], .post-stream .topic-body")
      .forEach((element) => {
        const root = getPostRootElement(element);
        if (seenRoots.has(root) || !isElementMeaningfullyVisibleForDwell(root)) {
          return;
        }

        seenRoots.add(root);
        roots.push(root);
      });

    return roots.map((root, index) => ({
      key: getPostElementKey(root, index),
      textLength: (root.textContent || "").trim().length,
      imageCount: root.querySelectorAll("img").length,
    }));
  }

  function getVisiblePostNumbers() {
    const postNumbers = [];
    const seenRoots = new Set();

    document
      .querySelectorAll(".topic-post, article[data-post-id], .post-stream .topic-body")
      .forEach((element) => {
        const root = getPostRootElement(element);
        if (seenRoots.has(root) || !isElementMeaningfullyVisibleForDwell(root)) {
          return;
        }

        const postNumber = getMatchingElementAttribute(
          root,
          ".topic-post[data-post-number], [data-post-number]",
          "data-post-number"
        );
        const numericPostNumber = Number(postNumber);
        if (Number.isInteger(numericPostNumber) && numericPostNumber > 0) {
          postNumbers.push(numericPostNumber);
        }
        seenRoots.add(root);
      });

    return postNumbers;
  }

  function getReadThroughPostNumbers() {
    const postNumbers = [];
    const seenRoots = new Set();

    document
      .querySelectorAll(".topic-post, article[data-post-id], .post-stream .topic-body")
      .forEach((element) => {
        const root = getPostRootElement(element);
        const readThroughElement = getPostReadThroughElement(root);
        if (
          seenRoots.has(root) ||
          !isElementReadThroughForCompletion(readThroughElement)
        ) {
          return;
        }

        const postNumber = getPostElementNumber(root);
        if (postNumber !== null) {
          postNumbers.push(postNumber);
        }
        seenRoots.add(root);
      });

    return postNumbers;
  }

  function getRenderedPostNumbers() {
    const postNumbers = [];
    const seenRoots = new Set();

    document
      .querySelectorAll(".topic-post, article[data-post-id], .post-stream .topic-body")
      .forEach((element) => {
        const root = getPostRootElement(element);
        if (seenRoots.has(root)) {
          return;
        }

        const postNumber = getPostElementNumber(root);
        if (postNumber !== null) {
          postNumbers.push(postNumber);
        }
        seenRoots.add(root);
      });

    return postNumbers;
  }

  function getPostNumberFromPathname() {
    const postNumberMatch = window.location.pathname.match(
      /^\/t\/[^/]+\/\d+\/(\d+)\/?$/
    );
    const postNumber = postNumberMatch ? Number(postNumberMatch[1]) : null;

    return Number.isInteger(postNumber) && postNumber > 0 ? postNumber : null;
  }

  function getTimelineTopicProgress() {
    const timelineReplies = document.querySelector(".timeline-replies");
    const timelineText = timelineReplies
      ? (timelineReplies.textContent || "").replace(/\s+/g, " ").trim()
      : "";
    const progressMatch = timelineText.match(/(\d+)\s*\/\s*(\d+)/);

    if (!progressMatch) {
      return {};
    }

    return {
      currentPostNumber: Number(progressMatch[1]),
      highestPostNumber: Number(progressMatch[2]),
    };
  }

  function getTopicProgressMetrics() {
    const timelineProgress = getTimelineTopicProgress();
    const renderedPostNumbers = getRenderedPostNumbers();
    const visiblePostNumbers = getVisiblePostNumbers();
    const readThroughPostNumbers = getReadThroughPostNumbers();
    const maxVisiblePostNumber =
      visiblePostNumbers.length > 0 ? Math.max(...visiblePostNumbers) : null;
    const maxReadThroughPostNumber =
      readThroughPostNumbers.length > 0
        ? Math.max(...readThroughPostNumbers)
        : null;

    return {
      ...timelineProgress,
      currentPostNumber:
        timelineProgress.currentPostNumber || getPostNumberFromPathname(),
      maxVisiblePostNumber,
      maxReadThroughPostNumber,
      renderedPostCount: renderedPostNumbers.length,
      renderedPostNumbers,
      visiblePostNumbers,
      readThroughPostNumbers,
    };
  }

  // 检查是否已滚动到底部(不断重复执行),到底部时跳转到下一个话题
  function checkScroll() {
    AutoReadCore.continueTopicReading({
      isActive: isReadingEnabled,
      getReadStateTrust: readStateTrustGuard.getTrustState,
      clearTimers: clearReadTimers,
      pauseReading: (reason) =>
        pauseAutoReadingForReason(reason, { timersAlreadyCleared: true }),
      isTopicReady: isTopicContentReady,
      shouldDelayTopicStart: topicStartDelayController.shouldDelayTopicStart,
      recordTopicStartDelay: topicStartDelayController.recordTopicStartDelay,
      getVisiblePosts: getVisiblePostsForDwell,
      getPostForDwell: visiblePostDwellController.getPostForDwell,
      recordPostDwell: visiblePostDwellController.recordPostDwell,
      getTopicProgress: getTopicProgressMetrics,
      shouldAbandonTopic: topicAbandonmentController.shouldAbandonTopic,
      recordTopicAbandonment: () => {
        topicAbandonmentController.recordTopicAbandonment();
        abandonedTopicTracker.recordCurrentTopicAbandoned();
      },
      getViewportMetrics,
      scrollTopic: scrollTopicOnce,
      scheduleNextCheck: (delayMs = topicReadinessDelay) => {
        if (checkScrollTimeout !== null) {
          clearTimeout(checkScrollTimeout);
        }
        checkScrollTimeout = setTimeout(checkScroll, delayMs);
      },
      scheduleTopicCompletion: (delayMs, advance) => {
        logAutoReadDiagnostic("topic-completion-scheduled", { delayMs });
        if (checkScrollTimeout !== null) {
          clearTimeout(checkScrollTimeout);
        }
        checkScrollTimeout = setTimeout(() => {
          checkScrollTimeout = null;
          logAutoReadDiagnostic("topic-completion-fired");
          Promise.resolve(advance()).catch((error) => {
            console.error("延迟跳转到下一个主题失败", error);
            logAutoReadDiagnostic("topic-completion-error", {
              message: error && error.message ? error.message : String(error),
            });
          });
        }, delayMs);
      },
      advanceSession: ({ reason } = {}) => {
        console.log(reason === "abandoned-topic" ? "中途跳过主题" : "已滚动到底部");
        logAutoReadDiagnostic("advance-session", { reason });
        return goBackToTopicList();
      },
    });
  }

  // 入口函数
  function initAutoRead() {
    checkFirstRun();
    console.log(
      "autoRead",
      localStorage.getItem("read"),
      "autoLikeEnabled",
      autoLikeController.isEnabled()
    );
    if (isReadingEnabled()) {
      console.log("执行正常的滚动和检查逻辑");
      continueAutoReadFlow();
    }
  }

  // 获取当前时间戳
  const currentTime = Date.now();
  // 获取存储的时间戳
  const defaultTimestamp = new Date("1999-01-01T00:00:00Z").getTime(); //默认值为1999年
  const storedTime = parseInt(
    localStorage.getItem("clickCounterTimestamp") ||
      defaultTimestamp.toString(),
    10
  );

  // 获取当前的点击计数，如果不存在则初始化为0
  let clickCounter = parseInt(localStorage.getItem("clickCounter") || "0", 10);
  // 检查是否超过24小时（24小时 = 24 * 60 * 60 * 1000 毫秒）
  if (currentTime - storedTime > 24 * 60 * 60 * 1000) {
    // 超过24小时，清空点击计数器并更新时间戳
    clickCounter = 0;
    localStorage.setItem("clickCounter", "0");
    localStorage.setItem("clickCounterTimestamp", currentTime.toString());
  }

  console.log(`Initial clickCounter: ${clickCounter}`);
  function triggerClick(button) {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    button.dispatchEvent(event);
  }

  function autoLike() {
    console.log(`Initial clickCounter: ${clickCounter}`);
    // 寻找所有的discourse-reactions-reaction-button
    const buttons = document.querySelectorAll(
      ".discourse-reactions-reaction-button"
    );
    if (buttons.length === 0) {
      console.error(
        "No buttons found with the selector '.discourse-reactions-reaction-button'"
      );
      return;
    }
    console.log(`Found ${buttons.length} buttons.`); // 调试信息

    // 逐个点击找到的按钮
    buttons.forEach((button, index) => {
      if (
        (button.title !== "点赞此帖子" && button.title !== "Like this post") ||
        clickCounter >= likeLimit
      ) {
        return;
      }

      // 新增：点赞前加一个随机概率判断（如30%概率）
      const likeProbability = 0.3; // 0~1之间，0.3表示30%概率
      if (Math.random() > likeProbability) {
        console.log(`跳过第${index + 1}个按钮（未通过概率判断）`);
        return;
      }

      // 点赞间隔时间也随机（2~5秒之间）
      const randomDelay = 2000 + Math.floor(Math.random() * 3000);

      autoLikeInterval = setTimeout(() => {
        // 模拟点击
        triggerClick(button); // 使用自定义的触发点击方法
        console.log(`Clicked like button ${index + 1}`);
        clickCounter++; // 更新点击计数器
        // 将新的点击计数存储到localStorage
        localStorage.setItem("clickCounter", clickCounter.toString());
        // 如果点击次数达到likeLimit次，则设置点赞变量为false
        if (clickCounter === likeLimit) {
          console.log(
            `Reached ${likeLimit} likes, setting the like variable to false.`
          );
          localStorage.setItem("autoLikeEnabled", "false"); // 使用localStorage存储点赞变量状态
        } else {
          console.log("clickCounter:", clickCounter);
        }
      }, index * randomDelay); // 每次点赞的延迟为随机值
    });
  }
  const button = document.createElement("button");
  // 初始化按钮文本基于当前的阅读状态
  button.textContent =
    localStorage.getItem("read") === "true" ? "停止阅读" : "开始阅读";
  button.style.position = "fixed";
  button.style.bottom = "10px"; // 之前是 top
  button.style.left = "10px"; // 之前是 right
  button.style.zIndex = 1000;
  button.style.backgroundColor = "#f0f0f0"; // 浅灰色背景
  button.style.color = "#000"; // 黑色文本
  button.style.border = "1px solid #ddd"; // 浅灰色边框
  button.style.padding = "5px 10px"; // 内边距
  button.style.borderRadius = "5px"; // 圆角
  document.body.appendChild(button);

  autoReadingSession = AutoReadCore.createAutoReadingSession({
    baseUrl: BASE_URL,
    getActiveState: isReadingEnabled,
    setActiveState: (active) => {
      localStorage.setItem("read", active.toString());
    },
    getReadStateTrust: readStateTrustGuard.getTrustState,
    getReadingQueue: async () => [],
    navigateTo: () => {
      goToTopicList();
    },
    readingQueueStorage: sessionReadingQueueStorage,
    clearTimers: clearReadTimers,
    setControlLabel: (label) => {
      button.textContent = label;
    },
    setControlTitle: (message) => {
      button.title = message;
      if (message) {
        console.warn(message);
      }
    },
    showUserMessage: (message) => {
      window.alert(message);
    },
    logDiagnostic: (message, error) => {
      console.error(message, error);
    },
  });

  button.onclick = function () {
    if (autoReadingSession.isActive()) {
      autoReadingSession.stop();
      return;
    }

    autoReadingSession.startCurrentTopic();
    continueAutoReadFlow();
  };

  document.addEventListener("visibilitychange", () => {
    logAutoReadDiagnostic("visibilitychange");
    handleReadStateTrustChange();
  });
  window.addEventListener("focus", () => {
    logAutoReadDiagnostic("window-focus");
    handleReadStateTrustChange();
  });
  window.addEventListener("blur", () => {
    logAutoReadDiagnostic("window-blur");
    handleReadStateTrustChange();
  });
  window.addEventListener("popstate", () => {
    logAutoReadDiagnostic("popstate");
    openingTopic = false;
    topicClickStartedAt = null;
    scheduleActiveRouteCheck(topicListNavigationDelay);
  });
  window.addEventListener("pageshow", () => {
    logAutoReadDiagnostic("pageshow");
    openingTopic = false;
    topicClickStartedAt = null;
    if (isReadingEnabled()) {
      scheduleActiveRouteCheck(topicListNavigationDelay);
    }
  });

  //自动点赞按钮
  // 在页面上添加一个控制自动点赞的按钮
  const toggleAutoLikeButton = document.createElement("button");
  toggleAutoLikeButton.textContent = autoLikeController.isEnabled()
    ? "禁用自动点赞"
    : "启用自动点赞";
  toggleAutoLikeButton.style.position = "fixed";
  toggleAutoLikeButton.style.bottom = "50px"; // 之前是 top，且与另一个按钮错开位置
  toggleAutoLikeButton.style.left = "10px"; // 之前是 right
  toggleAutoLikeButton.style.zIndex = "1000";
  toggleAutoLikeButton.style.backgroundColor = "#f0f0f0"; // 浅灰色背景
  toggleAutoLikeButton.style.color = "#000"; // 黑色文本
  toggleAutoLikeButton.style.border = "1px solid #ddd"; // 浅灰色边框
  toggleAutoLikeButton.style.padding = "5px 10px"; // 内边距
  toggleAutoLikeButton.style.borderRadius = "5px"; // 圆角
  document.body.appendChild(toggleAutoLikeButton);

  // 为按钮添加点击事件处理函数
  toggleAutoLikeButton.addEventListener("click", () => {
    const isEnabled = !autoLikeController.isEnabled();
    autoLikeController.setEnabled(isEnabled);
    toggleAutoLikeButton.textContent = isEnabled
      ? "禁用自动点赞"
      : "启用自动点赞";
  });

  if (document.readyState === "loading") {
    window.addEventListener("load", initAutoRead);
  } else {
    initAutoRead();
  }
})();
}
