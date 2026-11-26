// ---------- 配置 ----------
const TARGET_COMPONENTS = [
  "bili-comment-renderer",
  "bili-comment-action-buttons-renderer",
];
const IP_CLASS = "bili-ip-reveal-tag";
const LOCATION_SELECTOR = "#location-" + IP_CLASS;

// ---------- 工具函数 ----------

// 从组件实例上取出 IP 属地字符串
function getLocation(el) {
  // B站新版评论组件数据在 __data 或 data 上，两种都兼容
  const data = el.__data || el.data;
  if (!data) return null;

  const loc =
    data.reply_control?.location || // 根评论/子评论
    data.reply?.reply_control?.location; // 部分包装结构
  if (!loc || typeof loc !== "string") return null;

  // "IP属地：江苏" → "江苏"
  return loc.replace(/^IP属地[:：]\s*/, "");
}

function getFloor(el) {
  const data = el.__data || el.data;
  // console.log("楼层", floor);
  if (!data || typeof data.floor !== "number") return null;
  return data.floor;
}

// 找到评论组件在 light DOM 中的“数据源”祖先
// bili-comment-action-buttons-renderer 自身可能没有 __data，
// 需要向上找到最近的、携带 __data 的评论宿主元素
function findDataHost(el) {
  let node = el;
  while (node) {
    if (node.__data || node.data) return node;
    node = node.parentNode || node.host; // 穿透 shadow root
  }
  return null;
}

// 创建 IP 标签节点
function createIpNode(location) {
  const span = document.createElement("span");
  span.className = IP_CLASS;
  span.textContent = location;
  span.style.cssText =
    "display:inline-block;" +
    "margin-left:6px;" +
    "padding:0 6px;" +
    "font-size:12px;" +
    "line-height:18px;" +
    "border-radius:4px;" +
    "color:var(--bili-comment-tag-color-light,#757575);" +
    "background:var(--bili-comment-tag-bg-light,#F4F4F4);" +
    "vertical-align:middle;" +
    "white-space:nowrap;";
  return span;
}

// ---------- 注入逻辑：操作按钮组件（时间旁边）----------

function injectIntoActionButtons(el) {
  const host = findDataHost(el);
  if (!host) return;

  const location = getLocation(host);
  if (!location) return;

  const shadow = el.shadowRoot;
  if (!shadow) return;

  // 先清理旧标签，防止组件复用时堆叠
  shadow.querySelectorAll("." + IP_CLASS).forEach((n) => n.remove());

  const pubdate = shadow.getElementById("pubdate");
  if (!pubdate) return;

  pubdate.insertAdjacentElement("afterend", createIpNode(location));
}

// ---------- 注入逻辑：评论主体组件（标签栏兜底）----------

function injectIntoCommentRenderer(el) {
  const floor = getFloor(el);

  const location = getLocation(el);
  const shadow = el.shadowRoot;
  if (!location || !shadow) return;

  if ((!location && floor === null) || !shadow) return;

  // 清理旧标签
  shadow.querySelectorAll("." + IP_CLASS).forEach((n) => n.remove());

  if (floor !== null) {
    const floorNode = createMetaTag("#" + floor);
    anchor.insertAdjacentElement("afterend", floorNode);
    anchor = floorNode;
  }

  let container =
    shadow.getElementById("tags") || shadow.getElementById("main");
  if (!container) return;

  if (floor !== null) container.appendChild(createMetaTag("#" + floor));
  // if (location) container.appendChild(createMetaTag(location));

  // 优先插到 #tags 里（和"UP主觉得很赞"并列）
  // let tags = shadow.getElementById("tags");
  // if (tags) {
  // //   tags.appendChild(createIpNode(location));
  //   tags.appendChild(createMetaTag("#" + floor));
  //   return;
  // }

  // // 没有 #tags，则插到 #main 末尾
  // const main = shadow.getElementById("main");
  // if (main) {
  // //   main.appendChild(createIpNode(location));
  //   main.appendChild(createMetaTag("#" + floor));
  // }
}

// ---------- 统一调度 ----------

function inject(el) {
  if (el.localName === "bili-comment-action-buttons-renderer") {
    injectIntoActionButtons(el);
  } else if (el.localName === "bili-comment-renderer") {
    injectIntoCommentRenderer(el);
  }
}

// ---------- Hook customElements.define ----------

const _define = customElements.define;

customElements.define = function (name, ctor, options) {
  if (TARGET_COMPONENTS.includes(name)) {
    const proto = ctor.prototype;

    const _connected = proto.connectedCallback;
    proto.connectedCallback = function () {
      _connected && _connected.call(this);
      // 等待 Lit 完成首轮 Shadow DOM 渲染
      requestAnimationFrame(() => inject(this));
    };

    const _attrChanged = proto.attributeChangedCallback;
    proto.attributeChangedCallback = function (attr, oldV, newV) {
      _attrChanged && _attrChanged.call(this, attr, oldV, newV);
      if (oldV !== newV) {
        // 列表复用：属性变化后重新注入
        queueMicrotask(() => inject(this));
      }
    };
  }
  return _define.call(this, name, ctor, options);
};
