// 从页面初始状态拿 bvid 和 cid→page 的映射
function getMeta() {
  const s = window.__INITIAL_STATE__;
  if (!s || !s.videoData) return null;

  const bvid = s.videoData.bvid || s.bvid || null;
  const pages = s.videoData.pages;
  const map = new Map();
  if (Array.isArray(pages)) {
    for (const p of pages) {
      if (p && p.cid != null && p.page != null) {
        map.set(String(p.cid), p.page);
      }
    }
  }
  return { bvid, map };
}

function enhance() {
  const list = document.querySelector(".video-pod__list");
  if (!list) return;

  const meta = getMeta();
  const bvid = meta?.bvid || location.pathname.match(/\/video\/(BV[\w]+)/)?.[1];
  const cidMap = meta?.map;

  const items = list.querySelectorAll(".video-pod__item");
  items.forEach((item, idx) => {
    const titleEl = item.querySelector(".title-txt");
    if (!titleEl) return;
    if (titleEl.querySelector("a[data-pod-link]")) return; // 已处理

    // data-key 就是分P的 cid
    const cid = item.dataset.key;
    let p = cidMap ? cidMap.get(String(cid)) : undefined;
    if (p == null) p = idx + 1; // 兜底：按 DOM 顺序

    const href = bvid
      ? `https://www.bilibili.com/video/${bvid}?p=${p}`
      : `?p=${p}`;

    const a = document.createElement("a");
    a.href = href;
    a.setAttribute("data-pod-link", "1");
    a.style.color = "inherit";
    a.style.textDecoration = "none";

    // 把原有子节点整体搬进 a（文本节点、em 等都会保留）
    while (titleEl.firstChild) a.appendChild(titleEl.firstChild);
    titleEl.appendChild(a);

    // 左键点击交给 B 站 SPA 处理，避免整页刷新；
    // 右键、中键、Ctrl+左键 仍然走原生链接行为
    a.addEventListener("click", (e) => {
      if (
        e.button === 0 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        // 可选：主动触发原 item 的点击，走 B 站自己的切P逻辑
        // item.click();
      }
    });
  });
}
let scheduled = false;
let mo = null;
let currentTarget = null;

function retargetObserver() {
  if (!mo) return;
  const list = document.querySelector(".video-pod__list");
  const next = (list && list.parentElement) || document.documentElement;
  if (!next || next === currentTarget) return;

  mo.disconnect();
  mo.observe(next, { childList: true, subtree: true });
  currentTarget = next;
}

function startObserver() {
  const target = document.documentElement;
  if (!target || typeof MutationObserver === "undefined") return;

  mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
      retargetObserver();
    });
  });

  mo.observe(target, { childList: true, subtree: true });
  currentTarget = target;
}

// 首次执行
enhance();

// 启动：documentElement 通常已存在；极端情况下等它出现
if (document.documentElement) {
  startObserver();
} else {
  new MutationObserver((_, obs) => {
    if (document.documentElement) {
      obs.disconnect();
      startObserver();
    }
  }).observe(document, { childList: true, subtree: true });
}

// SPA 切换视频 / 列表重渲染后重新包裹
//   let scheduled = false;
//   const mo = new MutationObserver(() => {
//     if (scheduled) return;
//     scheduled = true;
//     requestAnimationFrame(() => {
//       scheduled = false;
//       enhance();
//     });
//   });

//   const container = document.querySelector('.video-pod__list')?.parentElement
//                  || document.body;
//   mo.observe(container, { childList: true, subtree: true });
