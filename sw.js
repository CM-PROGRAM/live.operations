const CACHE = 'suplelive-v5';
const ASSETS = ['/live.operations/', '/live.operations/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// O sistema é um arquivo só: se a página vier do cache, a máquina fica rodando
// uma versão antiga sem ninguém perceber. Por isso a página e a marca de versão
// são sempre buscadas na rede, sem passar pelo cache do navegador. O cache só
// entra quando a rede falha — aí é melhor abrir velho do que não abrir.
self.addEventListener('fetch', e => {
  const url = e.request.url;
  const semCache = e.request.mode === 'navigate'
    || /\/(index\.html|versao\.json)(\?|$)/.test(url);
  if (semCache) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(resp => {
          if (resp && resp.ok && e.request.method === 'GET') {
            const copia = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, copia)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// A página pede a troca imediata quando detecta versão nova
self.addEventListener('message', e => {
  if (e.data === 'assumir-agora') self.skipWaiting();
});
