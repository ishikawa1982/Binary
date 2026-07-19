// pwa.js — Service Worker を登録する（対応ブラウザのみ）。
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service Worker の登録に失敗しました:", err);
    });
  });
}
