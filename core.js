/* Ядро «Семейного капитала»: чистые функции, без DOM и без сети.
   Один файл на два рантайма: браузер подключает <script src="core.js">, Node делает require.
   Деньги хранятся числом в валюте актива, в доллары и рубли пересчитываются только при выводе. */
var Capital = (function () {
  'use strict';

  var VERSION = 1;
  var OWNERS = ['Костя', 'Люба', 'общий'];

  /* Словарь типов активов в одном месте: цвет и иконка типа одинаковы во всех разделах и графиках.
     sign: -1 только у долга, он входит в капитал с минусом. */
  var ASSET_TYPES = {
    exchange:     { id: 'exchange',     label: 'Биржа',          color: '#FF7A59', icon: '📈', sign: 1 },
    cash:         { id: 'cash',         label: 'Наличка',        color: '#6CC8FF', icon: '💵', sign: 1 },
    card:         { id: 'card',         label: 'Карта',          color: '#8FE3FF', icon: '💳', sign: 1 },
    bank:         { id: 'bank',         label: 'Банк',           color: '#3FA7F5', icon: '🏦', sign: 1 },
    cryptoWallet: { id: 'cryptoWallet', label: 'Крипто-кошелёк', color: '#FFB38F', icon: '🪙', sign: 1 },
    deposit:      { id: 'deposit',      label: 'Вклад',          color: '#C8F55A', icon: '🧾', sign: 1 },
    stocks:       { id: 'stocks',       label: 'Акции и фонды',  color: '#9BE15D', icon: '📊', sign: 1 },
    realty:       { id: 'realty',       label: 'Недвижимость',   color: '#19C6B8', icon: '🏠', sign: 1 },
    loanGiven:    { id: 'loanGiven',    label: 'Выданный займ',  color: '#FFC857', icon: '🤝', sign: 1 },
    business:     { id: 'business',     label: 'Доля в бизнесе', color: '#FF8FC7', icon: '🏢', sign: 1 },
    other:        { id: 'other',        label: 'Прочее',         color: '#9FB4BC', icon: '📦', sign: 1 },
    debt:         { id: 'debt',         label: 'Долг',           color: '#FF5C7A', icon: '📉', sign: -1 },
  };

  var CUSHION_KINDS = ['cash', 'card', 'bank'];
  var CURRENCIES = ['USD', 'USDT', 'RUB', 'KZT', 'AMD'];

  /* Статьи месяца из листа БЮДЖЕТ: названия совпадают с таблицей. */
  var MONTH_TEMPLATE = {
    income: [
      'Костина зарплата',
      'Костины мероприятия',
      'Костины бонусы',
      'Любина зарплата',
      'Доход на биржах',
      'Любины экстра',
      'Костины экстра',
    ],
    expense: [
      'Десятина Кости',
      'Десятина Любы',
      'Десятина с бирж',
      'Потратили на жизнь',
      'Оплаты с зарубежных карт',
      'Иррегулярные траты',
      'Потери',
    ],
    /* в таблице помечено «не включать в ИТОГО, просто для понимания» */
    excludeFromTotal: ['Иррегулярные траты'],
  };

  /* Сценарии роста из листа ФАКТ: старт, месяц старта, процент в месяц, пополнение. */
  function defaultScenarios() {
    return [
      { id: 'sc-5-0',    name: '5%+0',    start: 15000, startYm: '2024-07', ratePct: 5, monthlyAdd: 0 },
      { id: 'sc-0-2500', name: '0%+2500', start: 15000, startYm: '2024-07', ratePct: 0, monthlyAdd: 2500 },
      { id: 'sc-3-2000', name: '3%+2000', start: 15000, startYm: '2024-07', ratePct: 3, monthlyAdd: 2000 },
      { id: 'sc-5-2500', name: '5%+2500', start: 10000, startYm: '2024-07', ratePct: 5, monthlyAdd: 2500 },
    ];
  }

  /* ===================== утилиты ===================== */

  var uid = function () { return 'x' + Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5); };

  function pad2(n) { return String(n).padStart(2, '0'); }

  /* локальная дата, без toISOString: около полуночи UTC-версия даёт вчерашний день */
  function todayStr(d) {
    var x = d || new Date();
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  }
  function todayYm(d) { return todayStr(d).slice(0, 7); }
  function ddmm(dateStr) {
    if (!dateStr) return '';
    var p = String(dateStr).split('-');
    return p.length < 3 ? '' : p[2] + '.' + p[1];
  }
  function ymAdd(ym, n) {
    var parts = String(ym).split('-').map(Number);
    var y = parts[0], m = parts[1] + (n || 0);
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12 + 12) % 12 + 1;
    return y + '-' + pad2(m);
  }
  function ymDiff(a, b) {
    var pa = String(a).split('-').map(Number), pb = String(b).split('-').map(Number);
    return (pb[0] - pa[0]) * 12 + (pb[1] - pa[1]);
  }
  function ageDays(dateStr, today) {
    if (!dateStr) return null;
    var a = new Date(String(dateStr) + 'T12:00:00');
    if (isNaN(a.getTime())) return null;
    var b = new Date(String(today || todayStr()) + 'T12:00:00');
    return Math.round((b - a) / 86400000);
  }
  function fmt(n) {
    if (n == null || isNaN(n)) return '-';
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n));
  }
  function fmtS(n) {
    if (n == null || isNaN(n)) return '-';
    return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  }
  var SYMBOLS = { USD: '$', USDT: '$', RUB: '₽', KZT: '₸', AMD: '֏' };
  function fmtMoney(n, currency) {
    var cur = currency || 'USD';
    var sym = SYMBOLS[cur] || cur;
    if (cur === 'USD' || cur === 'USDT') return sym + fmt(n);
    return fmt(n) + ' ' + sym;
  }
  function parseNum(v) {
    if (v == null) return null;
    var s = String(v).replace(/[\s ₽$₸֏]/g, '').replace(',', '.');
    if (s === '') return null;
    var n = Number(s);
    return isNaN(n) ? null : n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n, a, b, c) {
    var m = Math.abs(n) % 100, d = m % 10;
    if (m > 10 && m < 20) return c;
    if (d > 1 && d < 5) return b;
    if (d === 1) return a;
    return c;
  }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function num(v) { var n = parseNum(v); return n == null ? 0 : n; }

  /* ===================== состояние ===================== */

  function defaultState() {
    return {
      version: VERSION,
      settings: {
        baseCurrency: 'USD',
        planRate: 78,
        scenarios: defaultScenarios(),
        assetTypes: Object.keys(ASSET_TYPES),
        owners: OWNERS.slice(),
        agentStaleHours: 2,
        monthTemplate: {
          income: MONTH_TEMPLATE.income.slice(),
          expense: MONTH_TEMPLATE.expense.slice(),
          excludeFromTotal: MONTH_TEMPLATE.excludeFromTotal.slice(),
        },
        staleBalanceDays: 45,
        apartmentStaleDays: 90,
      },
      accounts: [],
      exchanges: [],
      apartment: { address: '', area: null, buyPrice: null, buyDate: '', currency: 'RUB', owner: 'общий', valuations: [] },
      investments: [],
      months: {},
      snapshots: {},
      rates: {},
      agent: { lastRunAt: null, lastError: null },
      savedAt: null,
    };
  }

  function normAccount(a) {
    if (!isObj(a)) return null;
    return {
      id: a.id || uid(),
      name: a.name == null ? '' : String(a.name),
      kind: CUSHION_KINDS.indexOf(a.kind) >= 0 ? a.kind : 'cash',
      bank: a.bank == null ? '' : String(a.bank),
      country: a.country == null ? '' : String(a.country),
      currency: a.currency || 'USD',
      owner: OWNERS.indexOf(a.owner) >= 0 ? a.owner : 'общий',
      balances: (Array.isArray(a.balances) ? a.balances : []).filter(isObj).map(function (b) {
        return { date: b.date || '', value: parseNum(b.value) };
      }),
    };
  }

  function normLast(l) {
    var o = isObj(l) ? l : {};
    return {
      at: o.at || null,
      equity: parseNum(o.equity),
      free: parseNum(o.free),
      inPositions: parseNum(o.inPositions),
      unrealizedPnl: parseNum(o.unrealizedPnl),
      positions: (Array.isArray(o.positions) ? o.positions : []).filter(isObj),
      currency: o.currency || 'USD',
      error: o.error == null ? null : String(o.error),
      /* at это момент последних удачных цифр, errorAt это момент неудачного опроса:
         давность считается по at, иначе ошибка выглядела бы свежими данными */
      errorAt: o.errorAt || null,
    };
  }

  function normExchange(e) {
    if (!isObj(e)) return null;
    var monthly = {};
    if (isObj(e.monthly)) {
      Object.keys(e.monthly).forEach(function (ym) {
        var m = isObj(e.monthly[ym]) ? e.monthly[ym] : {};
        monthly[ym] = { deposits: num(m.deposits), withdrawals: num(m.withdrawals), tithe: num(m.tithe) };
      });
    }
    return {
      id: e.id || uid(),
      exchange: e.exchange || 'okx',
      label: e.label == null ? String(e.id || '') : String(e.label),
      owner: OWNERS.indexOf(e.owner) >= 0 ? e.owner : 'Костя',
      veles: !!e.veles,
      source: e.source === 'manual' ? 'manual' : 'agent',
      last: normLast(e.last),
      monthly: monthly,
    };
  }

  function normValuation(v) {
    if (!isObj(v)) return null;
    return {
      date: v.date || '',
      value: parseNum(v.value),
      source: v.source == null ? '' : String(v.source),
      url: v.url == null ? '' : String(v.url),
    };
  }

  function normInvestment(i) {
    if (!isObj(i)) return null;
    return {
      id: i.id || uid(),
      type: ASSET_TYPES[i.type] ? i.type : 'other',
      name: i.name == null ? '' : String(i.name),
      owner: OWNERS.indexOf(i.owner) >= 0 ? i.owner : 'общий',
      currency: i.currency || 'USD',
      valuations: (Array.isArray(i.valuations) ? i.valuations : []).map(normValuation).filter(Boolean),
      expectedYield: parseNum(i.expectedYield),
      maturity: i.maturity || '',
      note: i.note == null ? '' : String(i.note),
    };
  }

  function normMonth(m) {
    var o = isObj(m) ? m : {};
    return {
      income: isObj(o.income) ? o.income : {},
      expense: isObj(o.expense) ? o.expense : {},
      filledAt: o.filledAt || null,
    };
  }

  function normScenario(s) {
    if (!isObj(s)) return null;
    if (!/^\d{4}-\d{2}$/.test(String(s.startYm || ''))) return null;
    return {
      id: s.id || uid(),
      name: s.name == null ? '' : String(s.name),
      start: num(s.start),
      startYm: s.startYm,
      ratePct: num(s.ratePct),
      monthlyAdd: num(s.monthlyAdd),
    };
  }

  /* Защитный бэкфилл плюс лесенка версий: state приходит из синка и может быть частичным или битым,
     приложение на этом падать не должно. */
  function migrate(input) {
    var state = isObj(input) ? input : defaultState();
    var def = defaultState();

    if (!isObj(state.settings)) state.settings = {};
    var s = state.settings;
    if (s.baseCurrency !== 'RUB') s.baseCurrency = 'USD';
    if (!(num(s.planRate) > 0)) s.planRate = def.settings.planRate;
    var scenarios = (Array.isArray(s.scenarios) ? s.scenarios : []).map(normScenario).filter(Boolean);
    s.scenarios = scenarios.length ? scenarios : def.settings.scenarios;
    s.assetTypes = (Array.isArray(s.assetTypes) ? s.assetTypes : []).filter(function (id) { return !!ASSET_TYPES[id]; });
    if (!s.assetTypes.length) s.assetTypes = def.settings.assetTypes;
    s.owners = Array.isArray(s.owners) && s.owners.length ? s.owners : def.settings.owners;
    if (!(num(s.agentStaleHours) > 0)) s.agentStaleHours = def.settings.agentStaleHours;
    if (!(num(s.staleBalanceDays) > 0)) s.staleBalanceDays = def.settings.staleBalanceDays;
    if (!(num(s.apartmentStaleDays) > 0)) s.apartmentStaleDays = def.settings.apartmentStaleDays;
    if (!isObj(s.monthTemplate)) s.monthTemplate = {};
    var mt = s.monthTemplate;
    if (!Array.isArray(mt.income) || !mt.income.length) mt.income = def.settings.monthTemplate.income;
    if (!Array.isArray(mt.expense) || !mt.expense.length) mt.expense = def.settings.monthTemplate.expense;
    if (!Array.isArray(mt.excludeFromTotal)) mt.excludeFromTotal = def.settings.monthTemplate.excludeFromTotal;

    state.accounts = (Array.isArray(state.accounts) ? state.accounts : []).map(normAccount).filter(Boolean);
    state.exchanges = (Array.isArray(state.exchanges) ? state.exchanges : []).map(normExchange).filter(Boolean);
    state.investments = (Array.isArray(state.investments) ? state.investments : []).map(normInvestment).filter(Boolean);

    var ap = isObj(state.apartment) ? state.apartment : {};
    state.apartment = {
      address: ap.address == null ? '' : String(ap.address),
      area: parseNum(ap.area),
      buyPrice: parseNum(ap.buyPrice),
      buyDate: ap.buyDate || '',
      currency: ap.currency || 'RUB',
      owner: OWNERS.indexOf(ap.owner) >= 0 ? ap.owner : 'общий',
      valuations: (Array.isArray(ap.valuations) ? ap.valuations : []).map(normValuation).filter(Boolean),
    };

    var months = {};
    if (isObj(state.months)) {
      Object.keys(state.months).forEach(function (ym) {
        if (/^\d{4}-\d{2}$/.test(ym)) months[ym] = normMonth(state.months[ym]);
      });
    }
    state.months = months;

    var snaps = {};
    if (isObj(state.snapshots)) {
      Object.keys(state.snapshots).forEach(function (ym) {
        if (/^\d{4}-\d{2}$/.test(ym) && isObj(state.snapshots[ym])) snaps[ym] = state.snapshots[ym];
      });
    }
    state.snapshots = snaps;

    var rates = {};
    if (isObj(state.rates)) {
      Object.keys(state.rates).forEach(function (cur) {
        var r = state.rates[cur];
        if (!isObj(r) || parseNum(r.value) == null) return;
        rates[cur] = { value: parseNum(r.value), date: r.date || '', nominal: num(r.nominal) > 0 ? num(r.nominal) : 1 };
      });
    }
    state.rates = rates;

    if (!isObj(state.agent)) state.agent = { lastRunAt: null, lastError: null };
    if (state.demo !== true) delete state.demo;

    /* лесенка версий: version 1 первая, расти ей некуда */
    state.version = VERSION;
    return state;
  }

  /* ===================== курсы ===================== */

  /* rates: {CUR:{value, date, nominal}} в формате ЦБ: value рублей за nominal единиц валюты.
     USD нужен всегда, потому что приложение считает в долларах, а ЦБ даёт рубли. */
  function rubPerUnit(currency, rates) {
    if (currency === 'RUB') return 1;
    var r = isObj(rates) ? rates[currency] : null;
    if (!isObj(r) || parseNum(r.value) == null) return null;
    var nom = num(r.nominal) > 0 ? num(r.nominal) : 1;
    return parseNum(r.value) / nom;
  }

  function toUsd(value, currency, rates) {
    var v = parseNum(value);
    if (v == null) return null;
    var cur = currency || 'USD';
    if (cur === 'USD' || cur === 'USDT') return v;
    var usdRub = rubPerUnit('USD', rates);
    if (usdRub == null) return null;
    if (cur === 'RUB') return v / usdRub;
    var per = rubPerUnit(cur, rates);
    if (per == null) return null;
    return v * per / usdRub;
  }

  function toRub(value, currency, rates) {
    var v = parseNum(value);
    if (v == null) return null;
    var cur = currency || 'USD';
    if (cur === 'RUB') return v;
    var per = rubPerUnit(cur === 'USDT' ? 'USD' : cur, rates);
    if (per == null) return null;
    return v * per;
  }

  /* ===================== балансы и оценки ===================== */

  function byDateAsc(a, b) { return String(a.date || '') < String(b.date || '') ? -1 : 1; }

  function accountBalance(account) {
    var list = (isObj(account) && Array.isArray(account.balances) ? account.balances : []).filter(function (b) {
      return isObj(b) && parseNum(b.value) != null;
    }).slice().sort(byDateAsc);
    if (!list.length) return { value: null, date: null };
    var last = list[list.length - 1];
    return { value: parseNum(last.value), date: last.date || null };
  }

  function lastValuation(asset) {
    var list = (isObj(asset) && Array.isArray(asset.valuations) ? asset.valuations : []).filter(function (v) {
      return isObj(v) && parseNum(v.value) != null;
    }).slice().sort(byDateAsc);
    if (!list.length) return null;
    var v = list[list.length - 1];
    return { value: parseNum(v.value), date: v.date || null, source: v.source || '', url: v.url || '' };
  }

  /* предыдущая оценка, чтобы показать дельту к ней */
  function prevValuation(asset) {
    var list = (isObj(asset) && Array.isArray(asset.valuations) ? asset.valuations : []).filter(function (v) {
      return isObj(v) && parseNum(v.value) != null;
    }).slice().sort(byDateAsc);
    if (list.length < 2) return null;
    var v = list[list.length - 2];
    return { value: parseNum(v.value), date: v.date || null, source: v.source || '', url: v.url || '' };
  }

  /* ===================== биржи ===================== */

  function exchangeTotals(ex, opts) {
    var o = isObj(opts) ? opts : {};
    var last = normLast(isObj(ex) ? ex.last : null);
    var staleHours = num(o.staleHours) > 0 ? num(o.staleHours) : 2;
    var nowMs = o.now == null ? Date.now() : new Date(o.now).getTime();
    var atMs = last.at ? new Date(last.at).getTime() : NaN;
    var stale = isNaN(atMs) ? true : (nowMs - atMs) > staleHours * 3600000;
    return {
      equity: last.equity,
      free: last.free,
      inPositions: last.inPositions,
      unrealizedPnl: last.unrealizedPnl,
      at: last.at,
      stale: stale,
      error: last.error,
      errorAt: last.errorAt,
    };
  }

  /* ===================== капитал ===================== */

  function ownerOf(v) { return OWNERS.indexOf(v) >= 0 ? v : 'общий'; }

  /* Собирает плоский список позиций капитала: счета, биржи, инвестиции, квартира.
     Одна точка правды для всех разрезов, чтобы итог и срезы не разъезжались. */
  function positionsOf(state) {
    var out = [];
    (state.accounts || []).forEach(function (a) {
      var b = accountBalance(a);
      if (b.value == null) return;
      out.push({ id: a.id, label: a.name, type: a.kind, owner: ownerOf(a.owner), native: b.value, currency: a.currency || 'USD', sign: 1, date: b.date });
    });
    (state.exchanges || []).forEach(function (e) {
      var t = exchangeTotals(e);
      if (t.equity == null) return;
      out.push({ id: e.id, label: e.label || e.id, type: 'exchange', owner: ownerOf(e.owner), native: t.equity, currency: (e.last && e.last.currency) || 'USD', sign: 1, date: t.at, pnl: t.unrealizedPnl });
    });
    (state.investments || []).forEach(function (i) {
      var v = lastValuation(i);
      if (!v) return;
      var type = ASSET_TYPES[i.type] ? i.type : 'other';
      out.push({ id: i.id, label: i.name, type: type, owner: ownerOf(i.owner), native: v.value, currency: i.currency || 'USD', sign: ASSET_TYPES[type].sign, date: v.date });
    });
    var ap = state.apartment;
    if (isObj(ap)) {
      var av = lastValuation(ap);
      /* пока оценки нет, квартира в капитал не входит: выдумывать цену нельзя */
      if (av) out.push({ id: 'apartment', label: 'Квартира', type: 'realty', owner: ownerOf(ap.owner), native: av.value, currency: ap.currency || 'RUB', sign: 1, date: av.date });
    }
    return out;
  }

  function capitalTotals(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var rates = s.rates || {};
    var all = positionsOf(s);
    var rows = o.owner ? all.filter(function (p) { return p.owner === o.owner; }) : all;

    var res = {
      totalUsd: 0, totalNoDrawdownUsd: 0, drawdownUsd: 0, cushionUsd: 0, exchangesUsd: 0,
      apartmentUsd: null, investmentsUsd: 0, debtsUsd: 0,
      byType: {}, byOwner: {}, byCurrency: {}, byAccount: [], unpriced: [],
    };
    OWNERS.forEach(function (ow) { res.byOwner[ow] = 0; });

    rows.forEach(function (p) {
      var usd = toUsd(p.native, p.currency, rates);
      var cur = p.currency || 'USD';
      if (!res.byCurrency[cur]) res.byCurrency[cur] = { native: 0, usd: usd == null ? null : 0 };
      res.byCurrency[cur].native += p.native * p.sign;
      if (usd == null) {
        res.byCurrency[cur].usd = null;
        res.unpriced.push({ id: p.id, label: p.label, type: p.type, owner: p.owner, currency: cur, native: p.native });
        res.byAccount.push({ id: p.id, label: p.label, type: p.type, owner: p.owner, usd: null, native: p.native, currency: cur });
        return;
      }
      var signed = usd * p.sign;
      if (res.byCurrency[cur].usd != null) res.byCurrency[cur].usd += signed;
      res.byType[p.type] = (res.byType[p.type] || 0) + signed;
      res.byOwner[p.owner] = (res.byOwner[p.owner] || 0) + signed;
      res.totalUsd += signed;
      if (CUSHION_KINDS.indexOf(p.type) >= 0) res.cushionUsd += usd;
      if (p.type === 'exchange') {
        res.exchangesUsd += usd;
        var pnlUsd = toUsd(p.pnl, cur, rates);
        if (pnlUsd != null && pnlUsd < 0) res.drawdownUsd += -pnlUsd;
      } else if (p.id === 'apartment') {
        res.apartmentUsd = (res.apartmentUsd || 0) + usd;
      } else if (p.type === 'debt') {
        res.debtsUsd += usd;
      } else if (CUSHION_KINDS.indexOf(p.type) < 0) {
        res.investmentsUsd += usd;
      }
      res.byAccount.push({ id: p.id, label: p.label, type: p.type, owner: p.owner, usd: signed, native: p.native, currency: cur });
    });

    res.totalNoDrawdownUsd = res.totalUsd + res.drawdownUsd;
    res.byAccount.sort(function (a, b) { return (b.usd == null ? -Infinity : b.usd) - (a.usd == null ? -Infinity : a.usd); });
    return res;
  }

  /* ===================== месяц ===================== */

  function sumItems(map, skip) {
    var total = 0;
    if (!isObj(map)) return 0;
    Object.keys(map).forEach(function (k) {
      if (skip && skip.indexOf(k) >= 0) return;
      total += num(map[k]);
    });
    return total;
  }

  function monthTotals(state, ym) {
    var s = isObj(state) ? state : defaultState();
    var m = isObj(s.months) && isObj(s.months[ym]) ? s.months[ym] : { income: {}, expense: {} };
    var tpl = isObj(s.settings) && isObj(s.settings.monthTemplate) ? s.settings.monthTemplate : {};
    var skip = Array.isArray(tpl.excludeFromTotal) ? tpl.excludeFromTotal : [];
    var income = sumItems(m.income, null);
    var expense = sumItems(m.expense, skip);
    return {
      income: income,
      expense: expense,
      saldo: income - expense,
      byItem: { income: isObj(m.income) ? m.income : {}, expense: isObj(m.expense) ? m.expense : {} },
    };
  }

  /* ===================== прирост на бирже ===================== */

  /* Как в таблице: «прирост за вычетом десятины, снятий и добавлений».
     Добавления уменьшают прирост, снятия и десятина его возвращают. */
  function exchangeGrowth(ex, ym, prevSnapshot, snapshot) {
    if (!isObj(ex) || !isObj(snapshot) || !isObj(prevSnapshot)) return null;
    var nowMap = isObj(snapshot.byAccount) ? snapshot.byAccount : {};
    var prevMap = isObj(prevSnapshot.byAccount) ? prevSnapshot.byAccount : {};
    var now = parseNum(nowMap[ex.id]);
    var prev = parseNum(prevMap[ex.id]);
    if (now == null || prev == null) return null;
    var m = isObj(ex.monthly) && isObj(ex.monthly[ym]) ? ex.monthly[ym] : {};
    var usd = now - prev - num(m.deposits) + num(m.withdrawals) + num(m.tithe);
    return { pct: prev ? usd / prev * 100 : null, usd: usd };
  }

  /* ===================== план и факт ===================== */

  function scenarioSeries(scenario, fromYm, toYm) {
    var sc = normScenario(scenario);
    if (!sc || !/^\d{4}-\d{2}$/.test(String(fromYm || '')) || !/^\d{4}-\d{2}$/.test(String(toYm || ''))) return [];
    if (ymDiff(sc.startYm, toYm) < 0) return [];
    var out = [];
    var value = sc.start;
    var ym = sc.startYm;
    var steps = ymDiff(sc.startYm, toYm);
    for (var i = 0; i <= steps; i++) {
      if (i > 0) {
        value = value * (1 + sc.ratePct / 100) + sc.monthlyAdd;
        ym = ymAdd(ym, 1);
      }
      if (ymDiff(fromYm, ym) >= 0) out.push({ ym: ym, value: value });
    }
    return out;
  }

  function factSeries(state) {
    var s = isObj(state) ? state : defaultState();
    var snaps = isObj(s.snapshots) ? s.snapshots : {};
    return Object.keys(snaps).sort().map(function (ym) {
      var sn = snaps[ym] || {};
      return { ym: ym, totalUsd: parseNum(sn.totalUsd), totalNoDrawdownUsd: parseNum(sn.totalNoDrawdownUsd) };
    });
  }

  function planDelta(state, scenarioId, ym) {
    var s = isObj(state) ? state : defaultState();
    var snap = isObj(s.snapshots) ? s.snapshots[ym] : null;
    if (!isObj(snap) || parseNum(snap.totalUsd) == null) return null;
    var list = isObj(s.settings) && Array.isArray(s.settings.scenarios) ? s.settings.scenarios : [];
    var sc = list.filter(function (x) { return isObj(x) && x.id === scenarioId; })[0];
    if (!sc) return null;
    var point = scenarioSeries(sc, ym, ym)[0];
    if (!point) return null;
    var fact = parseNum(snap.totalUsd);
    return { factUsd: fact, planUsd: point.value, deltaUsd: fact - point.value };
  }

  function makeSnapshot(state, ym, at) {
    var t = capitalTotals(state);
    var byAccount = {};
    t.byAccount.forEach(function (r) { byAccount[r.id] = r.usd; });
    return {
      at: at || new Date().toISOString(),
      ym: ym,
      totalUsd: t.totalUsd,
      totalNoDrawdownUsd: t.totalNoDrawdownUsd,
      drawdownUsd: t.drawdownUsd,
      cushionUsd: t.cushionUsd,
      exchangesUsd: t.exchangesUsd,
      apartmentUsd: t.apartmentUsd,
      investmentsUsd: t.investmentsUsd,
      debtsUsd: t.debtsUsd,
      byType: t.byType,
      byOwner: t.byOwner,
      byAccount: byAccount,
    };
  }

  /* ===================== слияние с патчем агента ===================== */

  /* Патч агента: { at, exchanges:{[id]:last}, snapshots:{[ym]:snapshot}, apartmentValuation, agent }.
     Агент владеет только своими аккаунтами бирж, снимками и полем agent: остальное из приложения. */
  function mergeAgent(appState, agentPatch) {
    var out = JSON.parse(JSON.stringify(isObj(appState) ? appState : defaultState()));
    if (!isObj(agentPatch)) return out;
    var patchAt = agentPatch.at || null;

    if (isObj(agentPatch.exchanges)) {
      if (!Array.isArray(out.exchanges)) out.exchanges = [];
      Object.keys(agentPatch.exchanges).forEach(function (id) {
        var last = normLast(agentPatch.exchanges[id]);
        var found = null;
        out.exchanges.forEach(function (e) { if (e && e.id === id) found = e; });
        if (!found) {
          out.exchanges.push(normExchange({
            id: id,
            exchange: last.exchange || String(id).split('-')[0],
            label: id,
            owner: 'Костя',
            veles: false,
            source: 'agent',
            last: last,
          }));
          return;
        }
        if (found.source === 'manual') return;
        var prevAt = found.last && found.last.at ? found.last.at : null;
        var prevPoll = found.last ? (found.last.errorAt || found.last.at || null) : null;
        var poll = last.errorAt || last.at || null;
        /* обычный патч применяется по более новым цифрам (at).
           Патч с ошибкой несёт старые цифры и новое время опроса (errorAt):
           его тоже применяем, иначе ошибка никогда не доедет до приложения. */
        if (!prevAt || (last.at && last.at > prevAt)) found.last = last;
        else if (last.errorAt && (!prevPoll || poll > prevPoll)) found.last = last;
      });
    }

    if (isObj(agentPatch.snapshots)) {
      if (!isObj(out.snapshots)) out.snapshots = {};
      Object.keys(agentPatch.snapshots).forEach(function (ym) {
        var sn = agentPatch.snapshots[ym];
        if (!isObj(sn)) return;
        var cur = out.snapshots[ym];
        if (!isObj(cur) || !cur.at || (patchAt && patchAt > cur.at)) out.snapshots[ym] = sn;
      });
    }

    var av = agentPatch.apartmentValuation;
    if (isObj(av) && parseNum(av.value) != null) {
      if (!isObj(out.apartment)) out.apartment = defaultState().apartment;
      if (!Array.isArray(out.apartment.valuations)) out.apartment.valuations = [];
      var dup = out.apartment.valuations.some(function (v) {
        return isObj(v) && v.date === av.date && (v.source || '') === (av.source || '');
      });
      if (!dup) out.apartment.valuations.push(normValuation(av));
    }

    if (isObj(agentPatch.agent)) out.agent = agentPatch.agent;
    return out;
  }

  /* ===================== демо ===================== */

  /* Выдуманные круглые цифры: ни одна не похожа на настоящие суммы семьи.
     Флаг demo=true: при первом своём вводе приложение заменяет демо на пустой state. */
  function demoState() {
    var s = defaultState();
    s.demo = true;
    s.rates = {
      USD: { value: 80, date: '2026-01-10', nominal: 1 },
      KZT: { value: 18, date: '2026-01-10', nominal: 100 },
      AMD: { value: 20, date: '2026-01-10', nominal: 100 },
    };
    s.accounts = [
      { id: 'demo-cash', name: 'Наличка', kind: 'cash', bank: '', country: '', currency: 'USD', owner: 'общий', balances: [{ date: '2025-11-01', value: 2000 }, { date: '2026-01-05', value: 2500 }] },
      { id: 'demo-card-kz', name: 'Карта KZ', kind: 'card', bank: 'Банк KZ', country: 'Казахстан', currency: 'KZT', owner: 'Костя', balances: [{ date: '2026-01-05', value: 900000 }] },
      { id: 'demo-card-am', name: 'Карта AM', kind: 'card', bank: 'Банк AM', country: 'Армения', currency: 'AMD', owner: 'Люба', balances: [{ date: '2026-01-05', value: 400000 }] },
      { id: 'demo-bank', name: 'Банк', kind: 'bank', bank: 'Банк', country: '', currency: 'RUB', owner: 'общий', balances: [{ date: '2026-01-05', value: 400000 }] },
    ];
    s.exchanges = [
      { id: 'demo-okx', exchange: 'okx', label: 'OKX', owner: 'Костя', veles: false, source: 'agent',
        last: { at: '2026-01-10T09:00:00+03:00', equity: 9000, free: 6000, inPositions: 3000, unrealizedPnl: -800, currency: 'USD', error: null,
          positions: [{ symbol: 'BTC-USDT', side: 'long', size: 0.1, entry: 50000, mark: 48000, pnl: -200 }] } },
      { id: 'demo-bybit-veles', exchange: 'bybit', label: 'Bybit Veles', owner: 'Костя', veles: true, source: 'agent',
        last: { at: '2026-01-10T09:00:00+03:00', equity: 4000, free: 1500, inPositions: 2500, unrealizedPnl: -400, currency: 'USD', error: null, positions: [] } },
      { id: 'demo-binance-veles', exchange: 'binance', label: 'Binance Veles', owner: 'Люба', veles: true, source: 'manual',
        last: { at: '2026-01-08T09:00:00+03:00', equity: 3000, free: 3000, inPositions: 0, unrealizedPnl: 0, currency: 'USD', error: null, positions: [] } },
    ];
    s.exchanges[0].monthly = { '2026-01': { deposits: 500, withdrawals: 0, tithe: 100 } };
    s.apartment = { address: '[впиши адрес]', area: 50, buyPrice: 8000000, buyDate: '2021-05-01', currency: 'RUB', owner: 'общий',
      valuations: [{ date: '2025-06-01', value: 11000000, source: 'пример', url: '' }, { date: '2026-01-01', value: 12000000, source: 'пример', url: '' }] };
    s.investments = [
      { id: 'demo-wallet', type: 'cryptoWallet', name: 'Кошелёк', owner: 'Костя', currency: 'USDT', valuations: [{ date: '2026-01-05', value: 1500, source: 'пример' }], expectedYield: null, maturity: '', note: '' },
      { id: 'demo-deposit', type: 'deposit', name: 'Вклад', owner: 'Люба', currency: 'RUB', valuations: [{ date: '2026-01-05', value: 500000, source: 'пример' }], expectedYield: 15, maturity: '2026-12-01', note: '' },
      { id: 'demo-stocks', type: 'stocks', name: 'Фонд', owner: 'Костя', currency: 'USD', valuations: [{ date: '2026-01-05', value: 2500, source: 'пример' }], expectedYield: 8, maturity: '', note: '' },
      { id: 'demo-realty', type: 'realty', name: 'Дача', owner: 'общий', currency: 'RUB', valuations: [{ date: '2026-01-05', value: 2000000, source: 'пример' }], expectedYield: null, maturity: '', note: '' },
      { id: 'demo-loan', type: 'loanGiven', name: 'Займ другу', owner: 'Костя', currency: 'USD', valuations: [{ date: '2026-01-05', value: 1000, source: 'пример' }], expectedYield: 10, maturity: '2026-06-01', note: '' },
      { id: 'demo-business', type: 'business', name: 'Доля в студии', owner: 'общий', currency: 'USD', valuations: [{ date: '2026-01-05', value: 5000, source: 'пример' }], expectedYield: null, maturity: '', note: '' },
      { id: 'demo-other', type: 'other', name: 'Прочее', owner: 'общий', currency: 'USD', valuations: [{ date: '2026-01-05', value: 300, source: 'пример' }], expectedYield: null, maturity: '', note: '' },
      { id: 'demo-debt', type: 'debt', name: 'Рассрочка', owner: 'общий', currency: 'RUB', valuations: [{ date: '2026-01-05', value: 300000, source: 'пример' }], expectedYield: null, maturity: '2026-09-01', note: '' },
    ];
    s.months['2025-12'] = {
      income: { 'Костина зарплата': 2000, 'Любина зарплата': 3000, 'Доход на биржах': 1000 },
      expense: { 'Десятина Кости': 200, 'Десятина Любы': 300, 'Десятина с бирж': 100, 'Потратили на жизнь': 2500, 'Иррегулярные траты': 400 },
      filledAt: '2025-12-31',
    };
    /* шесть месячных снимков: ряд факта, по которому рисуется график */
    var base = 40000;
    var ym = '2025-08';
    for (var i = 0; i < 6; i++) {
      var total = base + i * 2500;
      s.snapshots[ym] = {
        at: ym + '-01T09:00:00+03:00',
        ym: ym,
        totalUsd: total,
        totalNoDrawdownUsd: total + 1200,
        drawdownUsd: 1200,
        cushionUsd: Math.round(total * 0.3),
        exchangesUsd: Math.round(total * 0.4),
        apartmentUsd: Math.round(total * 0.3),
        investmentsUsd: Math.round(total * 0.1),
        debtsUsd: 0,
        byType: { exchange: Math.round(total * 0.4) },
        byOwner: { 'Костя': Math.round(total * 0.5), 'Люба': Math.round(total * 0.2), 'общий': Math.round(total * 0.3) },
        byAccount: { 'demo-okx': Math.round(total * 0.25), 'demo-bybit-veles': Math.round(total * 0.1), 'demo-binance-veles': Math.round(total * 0.05) },
      };
      ym = ymAdd(ym, 1);
    }
    return migrate(s);
  }

  return {
    VERSION: VERSION,
    OWNERS: OWNERS,
    ASSET_TYPES: ASSET_TYPES,
    CUSHION_KINDS: CUSHION_KINDS,
    CURRENCIES: CURRENCIES,
    MONTH_TEMPLATE: MONTH_TEMPLATE,
    defaultState: defaultState,
    migrate: migrate,
    toUsd: toUsd,
    toRub: toRub,
    accountBalance: accountBalance,
    lastValuation: lastValuation,
    prevValuation: prevValuation,
    exchangeTotals: exchangeTotals,
    capitalTotals: capitalTotals,
    monthTotals: monthTotals,
    exchangeGrowth: exchangeGrowth,
    scenarioSeries: scenarioSeries,
    factSeries: factSeries,
    planDelta: planDelta,
    makeSnapshot: makeSnapshot,
    mergeAgent: mergeAgent,
    demoState: demoState,
    fmt: fmt,
    fmtS: fmtS,
    fmtMoney: fmtMoney,
    parseNum: parseNum,
    esc: esc,
    uid: uid,
    todayStr: todayStr,
    todayYm: todayYm,
    ymAdd: ymAdd,
    ymDiff: ymDiff,
    ddmm: ddmm,
    plural: plural,
    ageDays: ageDays,
  };
})();

if (typeof module !== 'undefined') module.exports = Capital;
