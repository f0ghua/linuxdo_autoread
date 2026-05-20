// ==UserScript==
// @name         Auto Read
// @namespace    http://tampermonkey.net/
// @version      1.4.7
// @description  自动刷linuxdo文章
// @author       liuweiqing
// @match        https://meta.discourse.org/*
// @match        https://linux.do/*
// @match        https://meta.appinn.net/*
// @match        https://community.openai.com/
// @match        https://idcflare.com/*
// @exclude      https://linux.do/a/9611/0
// @grant        none
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=linux.do
// @downloadURL https://update.greasyfork.org/scripts/489464/Auto%20Read.user.js
// @updateURL https://update.greasyfork.org/scripts/489464/Auto%20Read.meta.js
// ==/UserScript==

const AutoReadCore = (() => {
  const DEFAULT_CANDIDATE_SOURCES = ["unread", "new"];
  const DEFAULT_COMMENT_LIMIT = 1000;
  const DEFAULT_TOPIC_LIST_LIMIT = 100;
  const DEFAULT_MAX_TOPIC_PAGES = 10;
  const DEFAULT_READING_QUEUE_STORAGE_KEY = "readingQueue";
  const DEFAULT_AUTO_LIKE_STORAGE_KEY = "autoLikeEnabled";
  const DEFAULT_TOPIC_COMPLETION_TOLERANCE = 100;
  const DEFAULT_READING_PROFILE = {
    minScrollStepPixels: 8,
    maxScrollStepPixels: 20,
    minScrollDelayMs: 250,
    maxScrollDelayMs: 600,
    topicStartDelayMs: 5000,
    bottomDelayMs: 10000,
  };
  const READ_STATE_PAUSE_REASONS = {
    hiddenTab: "hidden-tab",
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
    unfocusedPagePause: "页面未聚焦，自动阅读已暂停。",
  };

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

  async function getEligibleTopicsFromSource({
    source,
    fetchTopicPage,
    commentLimit = DEFAULT_COMMENT_LIMIT,
    maxTopicPages = DEFAULT_MAX_TOPIC_PAGES,
    topicListLimit = DEFAULT_TOPIC_LIST_LIMIT,
  }) {
    let eligibleTopics = [];

    for (let page = 0; page < maxTopicPages; page++) {
      const result = await fetchTopicPage(source, page);
      const topics = getTopicsFromTopicListPayload(result);

      if (topics.length === 0) {
        break;
      }

      topics.forEach((topic) => {
        if (isEligibleTopic(topic, commentLimit)) {
          eligibleTopics.push(topic);
        }
      });

      if (eligibleTopics.length >= topicListLimit) {
        break;
      }
    }

    if (eligibleTopics.length > topicListLimit) {
      eligibleTopics = eligibleTopics.slice(0, topicListLimit);
    }

    return eligibleTopics;
  }

  async function selectReadingQueue({
    fetchTopicPage,
    candidateSources = DEFAULT_CANDIDATE_SOURCES,
    commentLimit = DEFAULT_COMMENT_LIMIT,
    maxTopicPages = DEFAULT_MAX_TOPIC_PAGES,
    topicListLimit = DEFAULT_TOPIC_LIST_LIMIT,
  }) {
    for (const source of candidateSources) {
      const topics = await getEligibleTopicsFromSource({
        source,
        fetchTopicPage,
        commentLimit,
        maxTopicPages,
        topicListLimit,
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

  function isTopicCompletionReached({
    viewportHeight,
    scrollY,
    documentHeight,
    tolerance = DEFAULT_TOPIC_COMPLETION_TOLERANCE,
  }) {
    return viewportHeight + scrollY >= documentHeight - tolerance;
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

  function createReadStateTrustGuard({
    isPageHidden = () => false,
    hasPageFocus = () => true,
  } = {}) {
    return {
      getTrustState() {
        if (isPageHidden()) {
          return {
            trusted: false,
            reason: READ_STATE_PAUSE_REASONS.hiddenTab,
          };
        }

        if (!hasPageFocus()) {
          return {
            trusted: false,
            reason: READ_STATE_PAUSE_REASONS.unfocusedPage,
          };
        }

        return { trusted: true };
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

    if (
      isTopicCompletionReached({
        ...getViewportMetrics(),
        tolerance,
      })
    ) {
      scheduleTopicCompletion(profile.bottomDelayMs, advanceSession);
      return { status: "waiting-bottom", delayMs: profile.bottomDelayMs };
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
    createAutoLikeController,
    createAutoReadingSession,
    createReadStateTrustGuard,
    createTopicStartDelayController,
    buildTopicUrl,
    buildReadingQueue,
    chooseScrollAction,
    createReadingQueueStorage,
    getEligibleTopicsFromSource,
    getReadPosition,
    getTopicsFromTopicListPayload,
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
  // 定义可能的基本URL
  const possibleBaseURLs = [
    "https://linux.do",
    "https://meta.discourse.org",
    "https://meta.appinn.net",
    "https://community.openai.com",
    "https://idcflare.com/",
  ];
  const commentLimit = AutoReadCore.DEFAULT_COMMENT_LIMIT;
  const topicListLimit = AutoReadCore.DEFAULT_TOPIC_LIST_LIMIT;
  const maxTopicPages = AutoReadCore.DEFAULT_MAX_TOPIC_PAGES;
  const likeLimit = 50;
  const readingQueueStorage = AutoReadCore.createReadingQueueStorage({
    storage: localStorage,
  });
  const sessionReadingQueueStorage = {
    clear() {
      readingQueueStorage.clear();
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
  const topicSources = AutoReadCore.DEFAULT_CANDIDATE_SOURCES;
  // 获取当前页面的URL
  const currentURL = window.location.href;

  // 确定当前页面对应的BASE_URL
  let BASE_URL = possibleBaseURLs.find((url) => currentURL.startsWith(url));
  console.log("currentURL:", currentURL);
  // 环境变量：阅读网址，如果没有找到匹配的URL，则默认为第一个
  if (!BASE_URL) {
    BASE_URL = possibleBaseURLs[0];
    console.log("默认BASE_URL设置为: " + BASE_URL);
  } else {
    console.log("当前BASE_URL是: " + BASE_URL);
  }
  BASE_URL = BASE_URL.replace(/\/$/, "");

  console.log("脚本正在运行在: " + BASE_URL);
  //1.进入网页 https://linux.do/t/topic/数字（1，2，3，4）
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
  let autoLikeInterval = null;
  let openingTopic = false;
  const topicStartDelayController =
    AutoReadCore.createTopicStartDelayController({
      getTopicKey: () => window.location.pathname,
    });
  const readStateTrustGuard = AutoReadCore.createReadStateTrustGuard({
    isPageHidden: () => document.hidden === true,
    hasPageFocus: () =>
      typeof document.hasFocus === "function" ? document.hasFocus() : true,
  });

  function isReadingEnabled() {
    return localStorage.getItem("read") === "true";
  }

  function isTopicPage() {
    return /^\/t\/[^/]+\/\d+(?:\/\d+)?\/?$/.test(window.location.pathname);
  }

  function clearReadTimers() {
    if (checkScrollTimeout !== null) {
      clearTimeout(checkScrollTimeout);
      checkScrollTimeout = null;
    }
    topicStartDelayController.reset();
    localStorage.removeItem("navigatingToNextTopic");
  }

  let autoReadingSession = null;

  function continueAfterTrustedPageState() {
    autoReadingSession.resume();

    if (isTopicPage()) {
      checkScroll();
    } else {
      openNewTopic();
    }
  }

  function handleReadStateTrustChange() {
    if (!autoReadingSession || !autoReadingSession.isActive()) {
      return;
    }

    const readStateTrust = readStateTrustGuard.getTrustState();
    if (readStateTrust.trusted === false) {
      autoReadingSession.pause(readStateTrust.reason);
      return;
    }

    if (autoReadingSession.getPauseReason() !== null) {
      continueAfterTrustedPageState();
    }
  }

  function scrollTopicOnce(scrollAction) {
    window.scrollBy(0, scrollAction.stepPixels);
  }

  async function fetchTopicPage(source, page) {
    const url = `${BASE_URL}/${source}.json?no_definitions=true&page=${page}`;
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });

    let result = null;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error(`${source}.json 没有返回 JSON，可能被登录或验证拦截`);
    }

    if (result && result.error_type === "not_logged_in") {
      const error = new Error("请先登录 linux.do，再启动自动阅读。");
      error.name = "LoginRequiredError";
      throw error;
    }

    if (!response.ok) {
      throw new Error(`${source}.json 请求失败：HTTP ${response.status}`);
    }

    return result;
  }

  async function getTopicsFromSource(source) {
    return AutoReadCore.getEligibleTopicsFromSource({
      source,
      fetchTopicPage,
      commentLimit,
      maxTopicPages,
      topicListLimit,
    });
  }

  async function getReadingQueue() {
    const selectedQueue = await AutoReadCore.selectReadingQueue({
      fetchTopicPage,
      candidateSources: topicSources,
      commentLimit,
      maxTopicPages,
      topicListLimit,
    });

    if (selectedQueue.topics.length > 0) {
      console.log(
        `从 ${selectedQueue.source}.json 获取到 ${selectedQueue.topics.length} 个主题`
      );
    }

    return selectedQueue.topics;
  }

  async function openNewTopic() {
    if (openingTopic) {
      return { status: "opening" };
    }

    openingTopic = true;
    try {
      return await autoReadingSession.advance();
    } finally {
      openingTopic = false;
    }
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

  // 检查是否已滚动到底部(不断重复执行),到底部时跳转到下一个话题
  function checkScroll() {
    AutoReadCore.continueTopicReading({
      isActive: isReadingEnabled,
      getReadStateTrust: readStateTrustGuard.getTrustState,
      clearTimers: clearReadTimers,
      pauseReading: (reason) =>
        autoReadingSession.pause(reason, { timersAlreadyCleared: true }),
      isTopicReady: isTopicContentReady,
      shouldDelayTopicStart: topicStartDelayController.shouldDelayTopicStart,
      recordTopicStartDelay: topicStartDelayController.recordTopicStartDelay,
      getViewportMetrics,
      scrollTopic: scrollTopicOnce,
      scheduleNextCheck: (delayMs = topicReadinessDelay) => {
        if (checkScrollTimeout !== null) {
          clearTimeout(checkScrollTimeout);
        }
        checkScrollTimeout = setTimeout(checkScroll, delayMs);
      },
      scheduleTopicCompletion: (delayMs, advance) => {
        if (checkScrollTimeout !== null) {
          clearTimeout(checkScrollTimeout);
        }
        checkScrollTimeout = setTimeout(() => {
          checkScrollTimeout = null;
          Promise.resolve(advance()).catch((error) => {
            console.error("延迟跳转到下一个主题失败", error);
          });
        }, delayMs);
      },
      advanceSession: () => {
        console.log("已滚动到底部");
        return openNewTopic();
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
      if (isTopicPage()) {
        checkScroll();
      } else {
        openNewTopic();
      }
      autoLikeController.runIfEnabled(autoLike);
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
    getReadingQueue,
    navigateTo: (url) => {
      localStorage.setItem("navigatingToNextTopic", "true");
      window.location.href = url;
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
    autoReadingSession.toggle();
  };

  document.addEventListener("visibilitychange", handleReadStateTrustChange);
  window.addEventListener("focus", handleReadStateTrustChange);
  window.addEventListener("blur", handleReadStateTrustChange);

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
