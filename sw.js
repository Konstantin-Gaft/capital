/* Семейный капитал: минимальный service worker, как в бюджете.
   index.html, core.js и sync.js: сеть с ревалидацией, кэш как запас офлайн.
   Иконки, манифест и шрифты Google: сначала кэш.
   Курсы ЦБ и GitHub API не кэшируются никогда: иначе в приложении залипнут старые цифры. */
const CACHE = 'capital-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './core.js', './sync.js'])));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(e) {
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request).then(m => m || caches.match('./')))
  );
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);

  /* cache:'no-cache' обходит десятиминутный HTTP-кэш GitHub Pages: правка видна сразу */
  if (e.request.mode === 'navigate' || u.pathname.endsWith('/index.html')) { networkFirst(e); return; }
  if (u.origin === location.origin && u.pathname.endsWith('.js')) { networkFirst(e); return; }

  if (u.origin === location.origin || u.hostname.startsWith('fonts.')) {
    e.respondWith(
      caches.match(e.request).then(m => m || fetch(e.request).then(r => {
        const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r;
      }))
    );
  }
});
