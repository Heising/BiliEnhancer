const TARGET_ID = "web-player-module-area-mask-panel";
const TIMEOUT_MS = 10000;

const POLL_INTERVAL = 500;
const MAX_ATTEMPTS = 20;
let observer;
let intervalId; // 将 interval ID 存储在一个变量中

function tryRemoveMask() {
  const liveMask = document.getElementById(TARGET_ID); // 只声明一次
  if (!liveMask) return;
  try {
    liveMask.remove();
    console.log("[BiliEnhancer] 直播间遮罩已移除");
    clearTimeout(intervalId); // 只有成功移除时才清除间隔器
  } catch (error) {
    console.error("[BiliEnhancer] 移除遮罩失败:", error); // 使用 console.error 记录错误
  }
}

observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === "childList") {
      tryRemoveMask(); // 直接调用 removeMask 函数
    }
  });
});

const config = { childList: true, subtree: true };
observer.observe(document.body, config);

intervalId = setTimeout(() => {
  console.log("[BiliEnhancer] 超时：未找到直播间遮罩");
  observer.disconnect();
}, TIMEOUT_MS);
