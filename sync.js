/* Синк «Семейного капитала»: шифрованный blob в приватном репо GitHub.
   Механизм перенесён из «Бюджета» (devsync) и параметризован: репо capital-data,
   файл data.enc, конфиг под ключом capital-devsync. Форма блоба та же: iv(12)||ct, AES-GCM-256,
   в GitHub Contents API уходит base64 от base64.
   Один файл на два рантайма: браузер подключает <script src="sync.js">, Node делает require.
   Из платформенного кода используются только fetch, crypto.subtle, btoa и atob.
   Токен и ключ живут только в storage, не в state: в экспорт, снимок и репо они не попадают. */
var Sync = (function () {
  'use strict';

  var LS_KEY = 'capital-devsync';
  var REPO = 'capital-data';
  var PATH = 'data.enc';
  var INTERVAL_SEC = 30;

  function b64enc(bytes) {
    var s = '', ch = 0x8000;
    for (var i = 0; i < bytes.length; i += ch) s += String.fromCharCode.apply(null, bytes.subarray(i, i + ch));
    return btoa(s);
  }
  function b64dec(str) {
    var s = atob(str), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function randomKey(cryptoImpl) {
    var c = cryptoImpl || globalThis.crypto;
    return b64enc(c.getRandomValues(new Uint8Array(32)));
  }

  /* Хранилище конфига: в браузере localStorage, в Node файл agent/state/sync.json.
     fs инжектируется, чтобы sync.js не тянул модулей в браузере. */
  function fileStorage(filePath, fsModule) {
    var fs = fsModule;
    function readAll() {
      if (!fs.existsSync(filePath)) return {};
      try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {}; } catch (e) { return {}; }
    }
    function writeAll(obj) {
      var dir = String(filePath).split('/').slice(0, -1).join('/');
      if (dir && fs.mkdirSync) { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* каталог уже есть */ } }
      fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
    }
    return {
      getItem: function (k) { var all = readAll(); return Object.prototype.hasOwnProperty.call(all, k) ? all[k] : null; },
      setItem: function (k, v) { var all = readAll(); all[k] = String(v); writeAll(all); },
      removeItem: function (k) { var all = readAll(); delete all[k]; writeAll(all); },
    };
  }

  function memoryStorage() {
    var map = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
      setItem: function (k, v) { map[k] = String(v); },
      removeItem: function (k) { delete map[k]; },
    };
  }

  function create(opts) {
    var o = opts || {};
    var storage = o.storage || (typeof localStorage !== 'undefined' ? localStorage : memoryStorage());
    var lsKey = o.lsKey || LS_KEY;
    var repo = o.repo || REPO;
    var path = o.path || PATH;
    var intervalSec = o.intervalSec || INTERVAL_SEC;
    var fetchImpl = o.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    var cryptoImpl = o.cryptoImpl || globalThis.crypto;
    var getState = typeof o.getState === 'function' ? o.getState : null;
    var onApply = typeof o.onApply === 'function' ? o.onApply : null;
    var onStatus = typeof o.onStatus === 'function' ? o.onStatus : null;
    var nowIso = typeof o.now === 'function' ? o.now : function () { return new Date().toISOString(); };

    var cfg = null;
    var state = 'idle';
    var timer = null;
    var applying = false;

    function setStatus(s) { state = s; if (onStatus) onStatus(s); }

    async function loadCfg() {
      if (cfg) return cfg;
      try {
        var raw = await storage.getItem(lsKey);
        var c = raw ? JSON.parse(raw) : null;
        cfg = c && c.token && c.key ? c : null;
      } catch (e) { cfg = null; }
      return cfg;
    }
    async function saveCfg() { if (cfg) await storage.setItem(lsKey, JSON.stringify(cfg)); }
    async function clearCfg() { cfg = null; await storage.removeItem(lsKey); }

    async function keyFor(keyB64) {
      return cryptoImpl.subtle.importKey('raw', b64dec(keyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    async function encrypt(obj, keyB64) {
      var iv = cryptoImpl.getRandomValues(new Uint8Array(12));
      var k = await keyFor(keyB64);
      var ct = await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
      var out = new Uint8Array(12 + ct.byteLength);
      out.set(iv, 0);
      out.set(new Uint8Array(ct), 12);
      return b64enc(out);
    }

    async function decrypt(blobB64, keyB64) {
      var raw = b64dec(blobB64);
      var iv = raw.slice(0, 12), ct = raw.slice(12);
      var k = await keyFor(keyB64);
      var pt = await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv: iv }, k, ct);
      return JSON.parse(new TextDecoder().decode(pt));
    }

    function headers() {
      return { 'Authorization': 'token ' + cfg.token, 'Accept': 'application/vnd.github+json' };
    }
    function contentsUrl() {
      return 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + cfg.path;
    }

    async function ghUser(token) {
      var r = await fetchImpl('https://api.github.com/user', {
        headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' },
      });
      if (!r.ok) throw new Error('токен не принят (' + r.status + ')');
      return (await r.json()).login;
    }

    async function ghEnsureRepo() {
      var u = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo;
      var r = await fetchImpl(u, { headers: headers() });
      if (r.status === 404) {
        r = await fetchImpl('https://api.github.com/user/repos', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ name: cfg.repo, private: true, description: 'Encrypted family capital sync', auto_init: false }),
        });
        if (!r.ok) throw new Error('не создать репо (' + r.status + ')');
        return;
      }
      if (!r.ok) throw new Error('нет доступа к репо (' + r.status + ')');
      var j = await r.json();
      if (j.private === false) throw new Error('репо ' + cfg.repo + ' ПУБЛИЧНЫЙ: сделай его приватным и включи синк заново');
    }

    function localState(given) {
      if (given) return given;
      return getState ? getState() : null;
    }

    /* Чужое применяется только если оно новее локального или если force.
       Так два писателя (приложение и агент) не затирают друг друга. */
    async function pull(options) {
      var opt = options || {};
      var force = !!opt.force;
      await loadCfg();
      if (!cfg || !cfg.enabled) return { state: null, sha: null };
      try {
        if (!force) setStatus('sync');
        var r = await fetchImpl(contentsUrl() + '?t=' + Date.now(), { headers: headers(), cache: 'no-store' });
        if (r.status === 404) { cfg.sha = null; await saveCfg(); setStatus('ok'); return { state: null, sha: null }; }
        if (!r.ok) throw new Error('pull ' + r.status);
        var j = await r.json();
        cfg.sha = j.sha || null;
        var blob = String(j.content || '').replace(/\s/g, '');
        blob = blob ? atob(blob) : '';
        if (!blob && j.download_url) {
          blob = (await (await fetchImpl(j.download_url, { cache: 'no-store' })).text()).trim();
        }
        if (!blob) { await saveCfg(); setStatus('ok'); return { state: null, sha: cfg.sha }; }
        var remote;
        try {
          remote = await decrypt(blob, cfg.key);
        } catch (e) {
          /* неверный ключ или битый блоб: локальные данные целы, наружу идёт только статус */
          setStatus('err');
          return { state: null, sha: cfg.sha };
        }
        var local = localState(opt.local);
        var localSavedAt = local && local.savedAt;
        if (remote && remote.version && (force || !localSavedAt || (remote.savedAt && remote.savedAt > localSavedAt))) {
          applying = true;
          cfg.lastPushSavedAt = remote.savedAt || null;
          cfg.lastSync = nowIso();
          await saveCfg();
          try { if (onApply) await onApply(remote); } finally { applying = false; }
          setStatus('ok');
          return { state: remote, sha: cfg.sha };
        }
        cfg.lastSync = nowIso();
        await saveCfg();
        setStatus('ok');
        return { state: null, sha: cfg.sha };
      } catch (e) {
        setStatus('err');
        throw e;
      }
    }

    async function pushOnce(st, retry) {
      if (!retry && cfg.lastPushSavedAt && st.savedAt && st.savedAt <= cfg.lastPushSavedAt) {
        setStatus('ok');
        return { sha: cfg.sha || null, skipped: true };
      }
      setStatus('sync');
      var blob = await encrypt(st, cfg.key);
      var body = { message: 'sync ' + (st.savedAt || ''), content: btoa(blob) };
      if (cfg.sha) body.sha = cfg.sha;
      var r = await fetchImpl(contentsUrl(), { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
      if (r.status === 409 && !retry) {
        /* sha устарел: другое устройство успело запушить. Подтянуть без force и повторить один раз. */
        await pull({ force: false });
        if (cfg.lastPushSavedAt && st.savedAt && st.savedAt <= cfg.lastPushSavedAt) {
          setStatus('ok');
          return { sha: cfg.sha || null, skipped: true };
        }
        return pushOnce(st, true);
      }
      if (!r.ok) throw new Error('push ' + r.status);
      var j = await r.json();
      cfg.sha = (j.content && j.content.sha) || cfg.sha || null;
      cfg.lastPushSavedAt = st.savedAt || null;
      cfg.lastSync = nowIso();
      await saveCfg();
      setStatus('ok');
      return { sha: cfg.sha, skipped: false };
    }

    async function push(st) {
      await loadCfg();
      if (!cfg || !cfg.enabled || applying) return { sha: null, skipped: true };
      var data = st || localState(null);
      if (!data) return { sha: null, skipped: true };
      try {
        return await pushOnce(data, false);
      } catch (e) {
        setStatus('err');
        throw e;
      }
    }

    async function enable(token) {
      var t = String(token || '').trim();
      if (!t) throw new Error('нужен GitHub-токен с правом Contents на один репо');
      try {
        var owner = await ghUser(t);
        cfg = { enabled: true, token: t, owner: owner, repo: repo, path: path, key: randomKey(cryptoImpl), sha: null, lastPushSavedAt: null, lastSync: null, intervalSec: intervalSec };
        await ghEnsureRepo();
        await pull({ force: false });  /* сначала чужое свежее, локальное старьё не затирается */
        var data = localState(null);
        if (data) await pushOnce(data, true);
        await saveCfg();
        setStatus('ok');
        return { owner: owner, repo: cfg.repo };
      } catch (e) {
        await clearCfg();
        setStatus('err');
        throw e;
      }
    }

    async function code() {
      await loadCfg();
      if (!cfg) return '';
      /* base64 как в бюджете; через TextEncoder, чтобы не падать на не-ASCII символах */
      return b64enc(new TextEncoder().encode(JSON.stringify({ t: cfg.token, o: cfg.owner, r: cfg.repo, k: cfg.key })));
    }

    async function link(codeStr) {
      try {
        var raw = JSON.parse(new TextDecoder().decode(b64dec(String(codeStr || '').trim())));
        if (!raw.t || !raw.o || !raw.k) throw new Error('код повреждён');
        cfg = { enabled: true, token: raw.t, owner: raw.o, repo: raw.r || repo, path: path, key: raw.k, sha: null, lastPushSavedAt: null, lastSync: null, intervalSec: intervalSec };
        await saveCfg();
        await pull({ force: true });
        setStatus('ok');
        return { owner: cfg.owner, repo: cfg.repo };
      } catch (e) {
        await clearCfg();
        setStatus('err');
        throw new Error('код не подошёл: ' + e.message);
      }
    }

    async function disable() {
      if (timer) { clearInterval(timer); timer = null; }
      await clearCfg();
      setStatus('idle');
    }

    async function config() {
      await loadCfg();
      if (!cfg) return null;
      /* наружу только безопасные поля: токен и ключ не выходят из модуля */
      return {
        enabled: !!cfg.enabled,
        owner: cfg.owner,
        repo: cfg.repo,
        path: cfg.path,
        sha: cfg.sha || null,
        lastSync: cfg.lastSync || null,
        lastPushSavedAt: cfg.lastPushSavedAt || null,
        intervalSec: cfg.intervalSec || intervalSec,
        hasToken: !!cfg.token,
        hasKey: !!cfg.key,
      };
    }

    /* loop('start'): опрос, пока вкладка видима; loop('stop'): остановить. */
    async function loop(action) {
      if (action === 'stop') {
        if (timer) { clearInterval(timer); timer = null; }
        return;
      }
      await loadCfg();
      if (!cfg || !cfg.enabled) return;
      if (timer) clearInterval(timer);
      await pull({ force: false });
      var sec = Math.max(15, cfg.intervalSec || intervalSec);
      timer = setInterval(function () {
        var hidden = typeof document !== 'undefined' && document.hidden;
        if (!hidden) pull({ force: false }).catch(function () { /* статус уже выставлен */ });
      }, sec * 1000);
      if (timer && timer.unref) timer.unref();
    }

    return {
      encrypt: encrypt,
      decrypt: decrypt,
      pull: pull,
      push: push,
      enable: enable,
      disable: disable,
      code: code,
      link: link,
      loop: loop,
      config: config,
      status: function () { return state; },
    };
  }

  return {
    create: create,
    fileStorage: fileStorage,
    memoryStorage: memoryStorage,
    randomKey: randomKey,
    b64enc: b64enc,
    b64dec: b64dec,
    LS_KEY: LS_KEY,
    REPO: REPO,
    PATH: PATH,
  };
})();

if (typeof module !== 'undefined') module.exports = Sync;
