// 投资工作台 — PWA Service Worker（基础版）
// 缓存策略：
//   /_next/static/**  → cache-first（文件名含 hash，永不过期）
//   页面导航           → network-first，离线回退首页
//   其他所有请求       → 直接透传网络，不缓存
// 注意：RSC payload（/_next/data/ 或带 _rsc 参数）必须透传，否则 router.refresh()
// 会拿到旧 payload 导致 PATCH 后前端数据不更新。

const CACHE_VERSION = "iw-cache-v2";
const APP_SHELL = ["/", "/manifest.json", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API 请求不缓存，始终走网络
  if (url.pathname.startsWith("/api/")) return;

  // 页面导航：网络优先，离线回退首页
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/").then((res) => res || Response.error())
      )
    );
    return;
  }

  // 只缓存真正的静态资源（/_next/static/ 下的带 hash 文件）。
  // 动态页面的 RSC payload（/_next/data/... 或带 _rsc 参数的请求）必须走网络，
  // 否则 router.refresh() 会拿到 SW 缓存的旧 payload，导致 PATCH 后数据不更新。
  const isNextStatic = url.pathname.startsWith("/_next/static/");
  if (!isNextStatic) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return res;
        })
    )
  );
});
