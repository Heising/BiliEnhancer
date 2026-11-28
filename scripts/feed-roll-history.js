/**
 * 首页「换一换」回溯与 R 快捷键。
 *
 * 核心思路：每次点「换一换」之前，把当前 feed 的 DOM 节点数组存进历史；
 * 「返回 / 前进」按钮从历史里取快照，用 replaceWith 把原节点换回来。
 * 快照存的是节点引用而非 HTML 字符串，所以节点上的事件监听、
 * Vue 内部状态、懒加载进度都能保留。
 */
function initFeedRollHistory() {
  const globalScope = globalThis;

  const BACK_BUTTON_ID = "feed-roll-back-btn";
  const NEXT_BUTTON_ID = "feed-roll-next-btn";
  const STORAGE_KEYS = ["bili-enhancer-enable", "feed-roll-history-btn"];

  // 内容过滤模块在节点连接时打上的运行时标记。
  // 这些标记不属于 feed 的「真实状态」，恢复快照前必须清掉，
  // 让过滤观察器按当前设置重新判定。
  const TRANSIENT_FILTER_CLASSES = [
    "bili-enhancer-filtered-live-content",
    "bili-enhancer-filtered-ad-content",
  ];
  const TRANSIENT_FILTER_SELECTOR = [
    ".bili-enhancer-filtered-live-content",
    ".bili-enhancer-filtered-ad-content",
    "[data-bili-enhancer-filter-reason]",
  ].join(",");

  // 按引用逐项比较两个快照是否完全一致（同一批节点、同一顺序）。
  const snapshotsEqual = (left, right) =>
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);

  /**
   * 一个小巧的、与 DOM 无关的历史状态机。
   *
   * 关键约定：
   *   index === snapshots.length 表示「当前页还没被保存进历史」。
   *   这个特殊状态让「首次 back」可以把当前页补进栈再回退，
   *   而不需要额外维护一个「已保存」标志。
   */
  const createFeedHistory = (maxEntries) => {
    const snapshots = [];
    let index = 0;
    const historyLimit = Math.max(
      2,
      Number.isFinite(maxEntries) ? Math.floor(maxEntries) : 20,
    );

    const validSnapshot = (snapshot) =>
      Array.isArray(snapshot) && snapshot.length > 0;

    // 超出上限时从头部裁掉最旧的条目，index 同步减。
    const trimToLimit = () => {
      const overflow = snapshots.length - historyLimit;
      if (overflow <= 0) {
        return;
      }
      snapshots.splice(0, overflow);
      index = Math.max(0, index - overflow);
    };

    // 点原生「换一换」之前调用：把当前可见页存进历史。
    const saveBeforeRoll = (snapshot) => {
      if (!validSnapshot(snapshot)) {
        return;
      }

      if (index === snapshots.length) {
        // 正常前进：当前页还没保存，push 进去。
        // snapshotsEqual 挡掉「没变化也保存」的重复条目。
        if (!snapshotsEqual(snapshots[snapshots.length - 1], snapshot)) {
          snapshots.push(snapshot);
          trimToLimit();
        }
      } else {
        // 用户之前回退过，现在又点换一换：
        // 截断 index 之后的分支，用新快照替换 index 位置。
        // 等价于浏览器历史里「从旧页面跳转会丢弃前进分支」的语义。
        snapshots[index] = snapshot;
        snapshots.splice(index + 1);
      }
      index = snapshots.length;
    };

    // 点「返回」时调用：返回上一页快照，或 null 表示到顶。
    const back = (currentSnapshot) => {
      if (index === snapshots.length) {
        // 当前页还没保存，先补进历史再回退。
        if (!validSnapshot(currentSnapshot)) {
          return null;
        }

        // B 站还没加载完就第二次点击时，不能重复入栈，
        // 也不能一次跳两页。
        if (snapshotsEqual(snapshots[snapshots.length - 1], currentSnapshot)) {
          return null;
        }
        snapshots.push(currentSnapshot);
        trimToLimit();
      }

      if (index <= 0) {
        return null;
      }
      index -= 1;
      return snapshots[index] || null;
    };

    // 点「前进」时调用。
    const next = () => {
      if (index >= snapshots.length - 1) {
        return null;
      }
      index += 1;
      return snapshots[index] || null;
    };

    // 给按钮状态用的只读视图。
    const getState = () => ({
      index,
      length: snapshots.length,
      canGoBack: index > 0,
      canGoNext: index < snapshots.length - 1,
    });

    const reset = () => {
      snapshots.splice(0);
      index = 0;
    };

    return { saveBeforeRoll, back, next, getState, reset };
  };

  // 判断元素是否是可编辑区域（输入框、contenteditable 等）。
  // 用于避免用户在搜索框里打 r 时误触发换一换。
  const isEditableElement = (element) => {
    if (!element || element.nodeType !== 1) {
      return false;
    }
    if (element.isContentEditable) {
      return true;
    }
    if (typeof element.closest !== "function") {
      return false;
    }
    return Boolean(
      element.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]',
      ),
    );
  };

  // 判断当前是否在 B 站首页（含 /index.html）。
  const isHomePageLocation = (locationObject) =>
    Boolean(
      locationObject &&
      locationObject.hostname === "www.bilibili.com" &&
      (locationObject.pathname === "/" ||
        locationObject.pathname === "/index.html"),
    );

  /**
   * 首页内容过滤模块会在节点连接时给 feed 卡片打标记。
   * 历史快照保留的是真实节点，这些「运行时注解」不能越过产生它们的设置继续存在。
   * 恢复快照前先清掉，之后如果过滤仍然开启，观察器会按结构信号重新分类这些干净节点。
   */
  const clearTransientFilterState = (root) => {
    if (!root || typeof root !== "object") {
      return;
    }

    const markedElements = [root];
    if (typeof root.querySelectorAll === "function") {
      markedElements.push(...root.querySelectorAll(TRANSIENT_FILTER_SELECTOR));
    }

    for (const element of markedElements) {
      element.classList?.remove(...TRANSIENT_FILTER_CLASSES);
      element.removeAttribute?.("data-bili-enhancer-filter-reason");
    }
  };

  // 判断一次 keydown 是否应该被当作「R 快捷键换一换」处理。
  const shouldHandleRollShortcut = (
    event,
    locationObject,
    activeElement,
    hasRollButton,
  ) =>
    Boolean(
      hasRollButton &&
      isHomePageLocation(locationObject) &&
      event &&
      String(event.key || "").toLowerCase() === "r" &&
      !event.defaultPrevented &&
      !event.repeat &&
      !event.isComposing &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !isEditableElement(event.target) &&
      !isEditableElement(activeElement),
    );

  // 导出纯函数部分，方便单测与外部模块复用。
  const api = {
    snapshotsEqual,
    createFeedHistory,
    clearTransientFilterState,
    isEditableElement,
    isHomePageLocation,
    shouldHandleRollShortcut,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  globalScope.BILIENHANCERFeedRollHistory = api;

  // 以下进入运行时：只在有 document 和 chrome.storage.sync 的环境里工作。
  const documentObject = globalScope.document;
  const storage = globalScope.chrome?.storage;
  if (!documentObject?.documentElement || !storage?.sync) {
    return;
  }

  const feedRollButton = documentObject.querySelector(".roll-btn");
  const feedRollButtonText = feedRollButton.querySelector(".roll-btn-text")
  feedRollButton.classList.add("primary-btn");
  feedRollButton.title = feedRollButtonText.textContent;
  feedRollButton.setAttribute("aria-label", feedRollButtonText.textContent);

  feedRollButton.querySelector(".roll-btn-text").remove();

  const history = createFeedHistory();
  let configured = false; // 用户设置里是否开启（总开关 + 换一换历史）
  let enabled = false; // 当前是否实际生效（configured 且当前在首页）
  let mountScheduled = false; // 防止 mountButtons 被重复调度
  let mountObserving = false;
  let mountObserver = null;
  let routeMonitor = null;
  let nativeCaptureTimer = null;
  let nativeSnapshot = null; // B 站原生换一换产生的当前页快照
  let nativeLoading = false; // 原生换一换请求进行中
  let displayingHistory = false; // 当前显示的页面是否来自历史回溯

  // B 站推荐卡片「不感兴趣」里用的同一个返回图标，视觉上保持原生一致。
  const historyIconPaths = [
    "M8.28032 2.46967C8.57321 2.76257 8.57321 3.23744 8.28032 3.53033L4.81065 7L8.28032 10.46965C8.57321 10.76255 8.57321 11.23745 8.28032 11.53035C7.98743 11.8232 7.51254 11.8232 7.21966 11.53035L3.57321 7.88389C3.08505 7.39573 3.08505 6.60428 3.57321 6.11612L7.21966 2.46967C7.51254 2.17678 7.98743 2.17678 8.28032 2.46967Z",
    "M3.75 7C3.75 6.58579 4.08579 6.25 4.5 6.25L14.25 6.25C17.97795 6.25 21 9.27208 21 13C21 16.72795 17.97795 19.75 14.25 19.75L7.5 19.75C7.08579 19.75 6.75 19.4142 6.75 19C6.75 18.5858 7.08579 18.25 7.5 18.25L14.25 18.25C17.1495 18.25 19.5 15.8995 19.5 13C19.5 10.10052 17.1495 7.75 14.25 7.75L4.5 7.75C4.08579 7.75 3.75 7.41421 3.75 7Z",
  ];

  // 创建「返回 / 前进」按钮，初始为禁用状态。
  const createFeedRollButton = (id, className, label) => {
    const button = documentObject.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = `primary-btn ${className} bili-enhancer-disabled`;
    button.disabled = true;
    button.title = label;
    button.setAttribute("aria-label", label);

    const svg = documentObject.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    for (const iconPath of historyIconPaths) {
      const path = documentObject.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", iconPath);
      svg.appendChild(path);
    }
    button.appendChild(svg);
    return button;
  };

  // 抓取当前 feed 的所有卡片节点（返回真实 DOM 节点引用，不是 HTML 字符串）。
  const snapshotCurrentFeed = () =>
    Array.from(documentObject.getElementsByClassName("feed-card"));

  // 用每张卡片的第一个链接 href 拼成签名，用来判断「内容是否真的换了」。
  // 只看节点引用不够：B 站可能复用节点只改内容。
  const snapshotSignature = (snapshot) =>
    (Array.isArray(snapshot) ? snapshot : [])
      .map((card) => card.querySelector?.("a[href]")?.href || "")
      .filter(Boolean)
      .join("\n");

  // 把快照恢复到页面上，替换当前 feed。
  const restoreFeed = (snapshot) => {
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      return false;
    }
    const feedCards = snapshotCurrentFeed();
    if (feedCards.length === 0) {
      return false;
    }

    // 快照里的节点可能在被替换下后、过滤设置变化的这段时间里脱离过文档。
    // 插入前先清掉派生出来的 UI 状态；如果过滤仍开启，
    // 观察器会看到随后的替换动作，并按当前设置重新应用。
    for (const card of snapshot) {
      clearTransientFilterState(card);
    }

    // 多退少补：B 站每次换一换返回的卡片数量可能不同。
    const count = Math.min(feedCards.length, snapshot.length);
    for (let index = 0; index < count; index += 1) {
      feedCards[index].replaceWith(snapshot[index]);
    }
    if (snapshot.length > count) {
      // 快照比当前多：把剩余节点插到父容器里。
      const parent =
        documentObject.querySelector(
          ".recommended-container_floor-aside .container",
        ) || feedCards[0].parentElement;
      if (!parent) return false;
      const previousSnapshotNode = snapshot[count - 1];
      const insertionPoint =
        previousSnapshotNode?.parentElement === parent
          ? previousSnapshotNode.nextSibling
          : null;
      for (let index = count; index < snapshot.length; index += 1) {
        parent.insertBefore(snapshot[index], insertionPoint);
      }
    } else {
      // 当前比快照多：移除多余节点。
      for (let index = count; index < feedCards.length; index += 1) {
        feedCards[index].remove();
      }
    }

    // 插入产生的 DOM 变化会让过滤模块重新应用直播 / 广告的可见性。
    // 同时派发一个事件，作为给其他 BILIENHANCER 模块的显式集成信号。
    documentObject.dispatchEvent(
      new CustomEvent("bili-enhancer:feed-history-restored"),
    );
    return true;
  };

  const setButtonDisabled = (id, disabled) => {
    const button = documentObject.getElementById(id);
    if (!button) {
      return;
    }
    button.disabled = disabled;
    button.classList.toggle("bili-enhancer-disabled", disabled);
  };

  // 根据历史状态刷新两个按钮的禁用态。
  // 原生换一换加载中也禁用，避免用户连点。
  const updateButtonStates = () => {
    const state = history.getState();
    setButtonDisabled(BACK_BUTTON_ID, nativeLoading || !state.canGoBack);
    setButtonDisabled(NEXT_BUTTON_ID, nativeLoading || !state.canGoNext);
  };

  const handleBack = () => {
    const currentSnapshot = snapshotCurrentFeed();
    // 第一次从原生页回退时，先把原生页记到 nativeSnapshot。
    if (!displayingHistory) {
      nativeSnapshot = currentSnapshot;
    }
    const snapshot = history.back(currentSnapshot);
    if (snapshot && restoreFeed(snapshot)) {
      // 如果恢复出来的正好是原生页，说明不在「历史页」状态了。
      displayingHistory = !snapshotsEqual(snapshot, nativeSnapshot);
    }
    updateButtonStates();
  };

  const handleNext = () => {
    const snapshot = history.next();
    if (snapshot && restoreFeed(snapshot)) {
      displayingHistory = !snapshotsEqual(snapshot, nativeSnapshot);
    }
    updateButtonStates();
  };

  const removeButtons = () => {
    documentObject.getElementById(BACK_BUTTON_ID)?.remove();
    documentObject.getElementById(NEXT_BUTTON_ID)?.remove();
  };

  const mountButtons = () => {
    mountScheduled = false;
    if (!enabled) {
      removeButtons();
      return;
    }

    const feedRollButton = documentObject.querySelector(".roll-btn");
    if (!feedRollButton?.parentElement) {
      return;
    }

    const parent = feedRollButton.parentElement;
    let backButton = documentObject.getElementById(BACK_BUTTON_ID);
    let nextButton = documentObject.getElementById(NEXT_BUTTON_ID);

    // 首页可能把整个 roll 按钮容器替换掉。
    // 在这种情况下要在新容器里重建，而不是继续持有已脱离文档的旧引用。
    if (!backButton || backButton.parentElement !== parent) {
      backButton?.remove();
      backButton = createFeedRollButton(
        BACK_BUTTON_ID,
        "feed-roll-back-btn",
        "返回上一组",
      );
      parent.appendChild(backButton);
      backButton.addEventListener("click", handleBack);
    }

    if (!nextButton || nextButton.parentElement !== parent) {
      nextButton?.remove();
      nextButton = createFeedRollButton(
        NEXT_BUTTON_ID,
        "feed-roll-next-btn",
        "前往下一组",
      );
      parent.appendChild(nextButton);
      nextButton.addEventListener("click", handleNext);
    }

    updateButtonStates();
    // 如果还没记录过原生页，且当前不在历史页，就把初始 feed 记下来。
    if (!displayingHistory && !nativeSnapshot) {
      const initialSnapshot = snapshotCurrentFeed();
      if (initialSnapshot.length > 0) {
        nativeSnapshot = initialSnapshot;
      }
    }
  };

  // 用微任务合并多次 observer 触发的 mount。
  const scheduleMount = () => {
    if (mountScheduled) {
      return;
    }
    mountScheduled = true;
    queueMicrotask(mountButtons);
  };

  const stopNativeCapture = () => {
    clearTimeout(nativeCaptureTimer);
    nativeCaptureTimer = null;
    nativeLoading = false;
  };

  // B 站换一换是异步请求，点完之后 DOM 不会立刻更新。
  // 这里用「轮询 + 签名比对」捕获换一换之后的新快照。
  const scheduleNativeCapture = (previousSnapshot) => {
    stopNativeCapture();
    nativeLoading = true;
    updateButtonStates();
    let attempts = 0;
    const previousSignature = snapshotSignature(previousSnapshot);
    const capture = () => {
      nativeCaptureTimer = null;
      if (!enabled) {
        nativeLoading = false;
        return;
      }
      const currentSnapshot = snapshotCurrentFeed();
      const currentSignature = snapshotSignature(currentSnapshot);
      // 双重校验：节点引用变了 且 签名变了，才算真正换了一页。
      // 只看引用会因为 B 站复用节点而误判；
      // 只看签名会因为懒加载还没填 href 而误判。
      if (
        currentSnapshot.length > 0 &&
        !snapshotsEqual(currentSnapshot, previousSnapshot) &&
        currentSignature &&
        currentSignature !== previousSignature
      ) {
        nativeSnapshot = currentSnapshot;
        nativeLoading = false;
        displayingHistory = false;
        updateButtonStates();
        return;
      }
      attempts += 1;
      if (attempts < 40) {
        // 每 100ms 检查一次，最多 4 秒。
        nativeCaptureTimer = setTimeout(capture, 100);
      } else {
        if (currentSnapshot.length > 0) {
          nativeSnapshot = currentSnapshot;
        }
        nativeLoading = false;
        updateButtonStates();
      }
    };
    nativeCaptureTimer = setTimeout(capture, 0);
  };

  const stopMountObserver = () => {
    mountObserver?.disconnect();
    mountObserving = false;
  };

  const startMountObserver = () => {
    if (mountObserving) {
      return;
    }
    if (!mountObserver) {
      mountObserver = new MutationObserver(() => {
        if (!enabled) {
          return;
        }
        const backButton = documentObject.getElementById(BACK_BUTTON_ID);
        const nextButton = documentObject.getElementById(NEXT_BUTTON_ID);
        const parent = backButton?.parentElement;
        // 两个按钮都在、父节点一致、父节点里还有 .roll-btn —— 状态健康，直接跳过。
        if (
          backButton &&
          nextButton &&
          parent &&
          nextButton.parentElement === parent &&
          parent.querySelector(".roll-btn")
        ) {
          return;
        }
        scheduleMount();
      });
    }
    mountObserver.observe(documentObject.documentElement, {
      childList: true,
      subtree: true,
    });
    mountObserving = true;
  };

  const resetRuntimeState = () => {
    stopNativeCapture();
    history.reset();
    nativeSnapshot = null;
    nativeLoading = false;
    displayingHistory = false;
  };

  // 根据当前路由同步 enabled 状态。
  // 不是首页时关掉按钮、监听器，如果正在显示历史页就先恢复原生页。
  const syncRouteState = () => {
    const isRuntimeHomePage =
      globalScope.__BILIENHANCER_BROWSER_TEST__ === true ||
      isHomePageLocation(globalScope.location);
    const nextEnabled = configured && isRuntimeHomePage;
    const changed = nextEnabled !== enabled;
    enabled = nextEnabled;
    documentObject.documentElement.toggleAttribute(
      "bili-enhancer-feed-roll-history",
      enabled,
    );

    if (enabled) {
      startMountObserver();
      scheduleMount();
    } else {
      stopMountObserver();
      // 离开首页时如果停在历史页，先切回原生页，避免「挂着历史快照离开」。
      if (changed && displayingHistory && nativeSnapshot) {
        restoreFeed(nativeSnapshot);
      }
      removeButtons();
      if (changed) {
        resetRuntimeState();
      }
    }
  };

  // SPA 的 pushState 不派发 popstate，所以用 1 秒轮询 location 兜底。
  const updateRouteMonitor = () => {
    if (configured && !routeMonitor) {
      routeMonitor = setInterval(syncRouteState, 1000);
    } else if (!configured && routeMonitor) {
      clearInterval(routeMonitor);
      routeMonitor = null;
    }
  };

  const applyStorage = (values) => {
    configured = Boolean(
      //   values['bili-enhancer-enable'] && values['feed-roll-history-btn']
      true,
    );
    updateRouteMonitor();
    syncRouteState();
  };

  storage.sync.get(STORAGE_KEYS, applyStorage);

  storage.onChanged?.addListener((changes, areaName) => {
    if (
      areaName === "sync" &&
      STORAGE_KEYS.some((key) =>
        Object.prototype.hasOwnProperty.call(changes, key),
      )
    ) {
      storage.sync.get(STORAGE_KEYS, applyStorage);
    }
  });

  // 在 B 站处理原生点击之前捕获（捕获阶段 + true），
  // 这样从旧的历史页点「换一换」时，能确定地丢掉过时的前进分支。
  documentObject.addEventListener(
    "click",
    (event) => {
      if (!enabled || !(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest(".roll-btn")) {
        const visibleSnapshot = snapshotCurrentFeed();
        const previousNativeSnapshot = nativeSnapshot?.length
          ? nativeSnapshot
          : visibleSnapshot;
        history.saveBeforeRoll(visibleSnapshot);
        // 如果当前停在历史页，先切回原生页，让 B 站基于原生页换一换。
        if (displayingHistory && nativeSnapshot) {
          restoreFeed(nativeSnapshot);
        }
        displayingHistory = false;
        scheduleNativeCapture(previousNativeSnapshot);
        updateButtonStates();
      }
    },
    true,
  );

  // R 快捷键：在捕获阶段拦截，阻止其他脚本 / B 站也响应 r。
  documentObject.addEventListener(
    "keydown",
    (event) => {
      const rollButton = documentObject.querySelector(".roll-btn");
      const canClick = Boolean(
        rollButton &&
        !rollButton.disabled &&
        rollButton.getAttribute("aria-disabled") !== "true",
      );
      if (
        !enabled ||
        !shouldHandleRollShortcut(
          event,
          globalScope.__BILIENHANCER_BROWSER_TEST__ === true
            ? { hostname: "www.bilibili.com", pathname: "/" }
            : globalScope.location,
          documentObject.activeElement,
          canClick,
        )
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      rollButton.click();
    },
    true,
  );

  globalScope.addEventListener("popstate", syncRouteState);
  globalScope.addEventListener("pageshow", syncRouteState);
}

// 启动
initFeedRollHistory();
