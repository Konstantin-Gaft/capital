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
    coins:        { id: 'coins',        label: 'Монеты',         color: '#4DE1A8', icon: '₿', sign: 1 },
    other:        { id: 'other',        label: 'Прочее',         color: '#9FB4BC', icon: '📦', sign: 1 },
    debt:         { id: 'debt',         label: 'Долг',           color: '#FF5C7A', icon: '📉', sign: -1 },
  };

  /* Биржи, для которых есть адаптер агента. Белый список: аккаунт с другим префиксом id
     в состояние не попадает, иначе опечатка в keys.json плодит мусорные карточки. */
  var EXCHANGES = ['okx', 'bybit', 'binance'];

  /* Сколько дневных точек держим и сколько живёт отметка об удалении. */
  var DAILY_MAX = 730;
  var TOMBSTONE_DAYS = 90;

  var CUSHION_KINDS = ['cash', 'card', 'bank'];
  /* Корзины целевой аллокации: долги в сумму корзин не входят, квартира с этой сборки тоже. */
  var REBALANCE_KEYS = ['cushion', 'exchanges', 'coins', 'investments'];
  var REBALANCE_LABELS = { cushion: 'Подушка', exchanges: 'Биржи', coins: 'Монеты', investments: 'Инвестиции' };
  var CURRENCIES = ['USD', 'USDT', 'EUR', 'RUB', 'KZT', 'AMD'];
  /* где лежат монеты: подсказки к полю, вписать можно любое своё место */
  var COIN_PLACES = ['Binance', 'Bybit', 'OKX', 'Bitget', 'BingX', 'MEXC', 'Gate', 'KuCoin', 'HTX', 'кошелёк', 'холодный кошелёк'];

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
  var SYMBOLS = { USD: '$', USDT: '$', EUR: '€', RUB: '₽', KZT: '₸', AMD: '֏' };
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
  /* Отметка времени правки сущности: строка ISO или null. Нужна слиянию по сущностям. */
  function stampOf(v) { return v == null || v === '' ? null : String(v); }
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
        /* расход семьи в месяц: по нему считается подушка в месяцах жизни */
        monthlyExpenseUsd: 3300,
        /* пороги риск-панели: просадка в % капитала и расстояние до ликвидации в % */
        drawdownAlertPct: 20,
        liqAlertPct: 15,
        /* по какому курсу считать рубли: ЦБ или рыночный USDT/RUB от агента */
        rubRate: 'cbr',
        goals: [],
        /* цели по умолчанию не заданы: null это «впиши», а не ноль процентов */
        targets: normTargets(null),
        updatedAt: null,
      },
      accounts: [],
      exchanges: [],
      apartment: { address: '', area: null, buyPrice: null, buyDate: '', currency: 'RUB', owner: 'общий', valuations: [] },
      investments: [],
      coins: [],
      coinPrices: {},
      flows: [],
      yields: [],
      months: {},
      snapshots: {},
      daily: {},
      deleted: {},
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
      updatedAt: stampOf(a.updatedAt),
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
      /* спот биржи: монеты вне стейблов, которых агент не умеет оценивать сам.
         Цену даёт приложение по символу, поэтому здесь только symbol и amount. */
      spot: (Array.isArray(o.spot) ? o.spot : []).filter(isObj).map(function (b) {
        return { symbol: String(b.symbol || '').toUpperCase(), amount: parseNum(b.amount) };
      }).filter(function (b) { return b.symbol && b.amount != null; }),
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
        monthly[ym] = { deposits: num(m.deposits), withdrawals: num(m.withdrawals), tithe: num(m.tithe), updatedAt: stampOf(m.updatedAt) };
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
      updatedAt: stampOf(e.updatedAt),
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
      updatedAt: stampOf(i.updatedAt),
    };
  }

  /* Монета в портфеле: coinId это id CoinGecko (bitcoin, solana), по нему тянется цена.
     Цена не хранится в позиции: она общая для всех мест, где лежит монета, и живёт в coinPrices. */
  function normCoin(c) {
    if (!isObj(c)) return null;
    var coinId = String(c.coinId || '').trim();
    if (!coinId) return null;
    return {
      id: c.id || uid(),
      coinId: coinId,
      symbol: String(c.symbol || '').toUpperCase(),
      name: c.name == null ? '' : String(c.name),
      amount: parseNum(c.amount),
      place: c.place == null ? '' : String(c.place),
      /* точка входа: средняя цена покупки в долларах за монету; пусто значит результат не считаем */
      entry: parseNum(c.entry),
      /* сколько долларов вложено в позицию целиком: важнее точки входа, нужно стейблам под ботом */
      invested: parseNum(c.invested),
      note: c.note == null ? '' : String(c.note),
      owner: OWNERS.indexOf(c.owner) >= 0 ? c.owner : 'Костя',
      image: /^https:\/\//.test(String(c.image || '')) ? String(c.image) : '',
      updatedAt: stampOf(c.updatedAt),
    };
  }
  function normCoinPrice(p) {
    if (!isObj(p)) return null;
    var usd = parseNum(p.usd);
    if (usd == null) return null;
    /* symbol нужен споту бирж: по нему цена сопоставляется с балансом, у которого нет coinId */
    return { usd: usd, ch24: parseNum(p.ch24), at: p.at || null, src: p.src || '', symbol: String(p.symbol || '').toUpperCase() };
  }

  /* Регулярное пополнение: сумма в валюте цели, раз в месяц (числа day), неделю или день, с даты start.
     Цель это счёт или инвестиция по id. Пополнения не пишутся в остатки: стоимость досчитывается
     от последней сверки (projectValue), поэтому синк двух устройств не начислит дважды. */
  var FLOW_EVERY = ['month', 'week', 'day'];
  function normFlow(f) {
    if (!isObj(f) || !f.targetId) return null;
    var day = Math.round(num(f.day));
    return {
      id: f.id || uid(),
      name: f.name == null ? '' : String(f.name),
      targetId: String(f.targetId),
      amount: parseNum(f.amount),
      every: FLOW_EVERY.indexOf(f.every) >= 0 ? f.every : 'month',
      day: day >= 1 && day <= 31 ? day : 1,
      start: /^\d{4}-\d{2}-\d{2}$/.test(String(f.start || '')) ? f.start : todayStr(),
      end: /^\d{4}-\d{2}-\d{2}$/.test(String(f.end || '')) ? f.end : '',
      updatedAt: stampOf(f.updatedAt),
    };
  }
  /* Доходность цели: ставка в процентах за день, месяц или год; compound это сложный процент. */
  var YIELD_PER = ['day', 'month', 'year'];
  function normYield(y) {
    if (!isObj(y) || !y.targetId) return null;
    return {
      id: y.id || uid(),
      targetId: String(y.targetId),
      rate: parseNum(y.rate),
      per: YIELD_PER.indexOf(y.per) >= 0 ? y.per : 'year',
      compound: y.compound !== false,
      updatedAt: stampOf(y.updatedAt),
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
      updatedAt: stampOf(s.updatedAt),
    };
  }

  /* Цель капитала: сумма к месяцу. Сумма может быть ещё не вписана: строка ввода в интерфейсе
     живёт между правками полей, а migrate зовётся после каждой. Прогресс без суммы просто null. */
  function normGoal(g) {
    if (!isObj(g)) return null;
    var target = parseNum(g.targetUsd);
    var name = g.name == null ? '' : String(g.name);
    if (target == null && !name && !g.id) return null;
    return {
      id: g.id || uid(),
      name: name,
      targetUsd: target,
      ym: /^\d{4}-\d{2}$/.test(String(g.ym || '')) ? g.ym : '',
      updatedAt: stampOf(g.updatedAt),
    };
  }

  /* Целевые доли: процент или null («не задано»). Сумма не обязана давать 100: это подсказка, не правило. */
  function normTargets(t) {
    var o = isObj(t) ? t : {};
    var byType = {}, byOwner = {};
    var src = isObj(o.byType) ? o.byType : {};
    REBALANCE_KEYS.forEach(function (k) { byType[k] = parseNum(src[k]); });
    var own = isObj(o.byOwner) ? o.byOwner : {};
    OWNERS.forEach(function (ow) { byOwner[ow] = parseNum(own[ow]); });
    return { byType: byType, byOwner: byOwner };
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
    if (!(num(s.monthlyExpenseUsd) > 0)) s.monthlyExpenseUsd = def.settings.monthlyExpenseUsd;
    if (!(num(s.drawdownAlertPct) > 0)) s.drawdownAlertPct = def.settings.drawdownAlertPct;
    if (!(num(s.liqAlertPct) > 0)) s.liqAlertPct = def.settings.liqAlertPct;
    if (s.rubRate !== 'market') s.rubRate = 'cbr';
    s.goals = (Array.isArray(s.goals) ? s.goals : []).map(normGoal).filter(Boolean);
    s.targets = normTargets(s.targets);
    s.updatedAt = stampOf(s.updatedAt);
    if (!isObj(s.monthTemplate)) s.monthTemplate = {};
    var mt = s.monthTemplate;
    if (!Array.isArray(mt.income) || !mt.income.length) mt.income = def.settings.monthTemplate.income;
    if (!Array.isArray(mt.expense) || !mt.expense.length) mt.expense = def.settings.monthTemplate.expense;
    if (!Array.isArray(mt.excludeFromTotal)) mt.excludeFromTotal = def.settings.monthTemplate.excludeFromTotal;

    state.accounts = (Array.isArray(state.accounts) ? state.accounts : []).map(normAccount).filter(Boolean);
    state.exchanges = (Array.isArray(state.exchanges) ? state.exchanges : []).map(normExchange).filter(Boolean);
    state.investments = (Array.isArray(state.investments) ? state.investments : []).map(normInvestment).filter(Boolean);
    state.coins = (Array.isArray(state.coins) ? state.coins : []).map(normCoin).filter(Boolean);
    state.flows = (Array.isArray(state.flows) ? state.flows : []).map(normFlow).filter(Boolean);
    var seenY = {};
    state.yields = (Array.isArray(state.yields) ? state.yields : []).map(normYield).filter(function (y) {
      if (!y || seenY[y.targetId]) return false; /* одна ставка на цель */
      seenY[y.targetId] = true; return true;
    });
    var prices = {};
    if (isObj(state.coinPrices)) {
      Object.keys(state.coinPrices).forEach(function (k) { var p = normCoinPrice(state.coinPrices[k]); if (p) prices[k] = p; });
    }
    state.coinPrices = prices;
    if (s.assetTypes.indexOf('coins') < 0) s.assetTypes.push('coins');

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
        /* рыночный курс приносит агент: источник и момент получения нужны слиянию и чипу в шапке */
        if (r.source) rates[cur].source = String(r.source);
        if (r.at) rates[cur].at = String(r.at);
      });
    }
    state.rates = rates;

    /* Дневная история: только ключи YYYY-MM-DD, не больше DAILY_MAX самых свежих.
       Иначе шифрованный blob синка растёт без предела: он переписывается целиком на каждый push. */
    var daily = {};
    if (isObj(state.daily)) {
      Object.keys(state.daily).forEach(function (d) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && isObj(state.daily[d])) daily[d] = state.daily[d];
      });
    }
    var dkeys = Object.keys(daily).sort();
    if (dkeys.length > DAILY_MAX) {
      dkeys.slice(0, dkeys.length - DAILY_MAX).forEach(function (d) { delete daily[d]; });
    }
    state.daily = daily;

    /* Отметки об удалении: нужны, чтобы удалённое на одном устройстве не воскресало с другого.
       Через TOMBSTONE_DAYS отметка уже не нужна: такой правки ни у кого не осталось. */
    var deleted = {};
    if (isObj(state.deleted)) {
      var edge = dayStr(dayNum(todayStr()) - TOMBSTONE_DAYS);
      Object.keys(state.deleted).forEach(function (id) {
        var at = state.deleted[id];
        if (typeof at !== 'string' || !at) return;
        if (at.slice(0, 10) < edge) return;
        deleted[id] = at;
      });
    }
    state.deleted = deleted;

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

  /* Курсы, по которым считается всё остальное. Три режима:
     ЦБ (по умолчанию), рынок (USDT/RUB от агента вместо курса ЦБ) и запасной
     (курса ЦБ нет совсем: берётся settings.planRate с пометкой fallback).
     Пометка важна: по запасному курсу нельзя фиксировать месяц и писать дневную точку. */
  function effectiveRates(state) {
    var st = isObj(state) ? state : defaultState();
    var src = isObj(st.rates) ? st.rates : {};
    var set = isObj(st.settings) ? st.settings : {};
    var out = {};
    Object.keys(src).forEach(function (cur) {
      var r = src[cur];
      if (!isObj(r)) return;
      var copy = {};
      Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
      out[cur] = copy;
    });
    if (set.rubRate === 'market' && isObj(out.USDT) && parseNum(out.USDT.value) != null) {
      out.USD = { value: parseNum(out.USDT.value), nominal: 1, date: out.USDT.date || null, source: 'market' };
    }
    if (!isObj(out.USD) || parseNum(out.USD.value) == null) {
      var plan = num(set.planRate) > 0 ? num(set.planRate) : defaultState().settings.planRate;
      out.USD = { value: plan, nominal: 1, date: null, fallback: true };
    }
    return out;
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

  /* Спот биржи с ценой приложения в долларах; символы без цены не входят (они идут в «без курса»). */
  function exchangeSpotUsd(e, symPrices) {
    var spot = normLast(isObj(e) ? e.last : null).spot;
    var usd = 0;
    spot.forEach(function (b) { if (symPrices[b.symbol] != null) usd += b.amount * symPrices[b.symbol]; });
    return usd;
  }

  /* Спот биржи построчно для карточки: символ, количество, цена и сумма в $ (null без цены).
     Сумма та же, что входит в капитал (exchangeSpotUsd), чтобы карточка и плитка не разъезжались. */
  function exchangeSpot(state, e) {
    var symPrices = symbolPrices(state);
    var rows = normLast(isObj(e) ? e.last : null).spot.map(function (b) {
      var price = symPrices[b.symbol];
      return { symbol: b.symbol, amount: b.amount, priceUsd: price == null ? null : price, usd: price == null ? null : b.amount * price };
    });
    return { rows: rows, usd: exchangeSpotUsd(e, symPrices) };
  }

  /* Собирает плоский список позиций капитала: счета, биржи, инвестиции, квартира.
     Одна точка правды для всех разрезов, чтобы итог и срезы не разъезжались. */
  function positionsOf(state, today) {
    var out = [];
    /* у цели с пополнениями или ставкой в капитал идёт досчитанная стоимость на сегодня */
    function grown(id, fallback) {
      if (!hasGrowth(state, id)) return fallback;
      var p = projectValue(state, id, today || todayStr());
      return p ? { value: p.value, date: p.to } : fallback;
    }
    (state.accounts || []).forEach(function (a) {
      var b = grown(a.id, accountBalance(a));
      if (b.value == null) return;
      out.push({ id: a.id, label: a.name, type: a.kind, owner: ownerOf(a.owner), native: b.value, currency: a.currency || 'USD', sign: 1, date: b.date });
    });
    var symPrices = symbolPrices(state);
    (state.exchanges || []).forEach(function (e) {
      var t = exchangeTotals(e);
      /* Спот биржи вне стейблов: агент знает только количество, цену даёт приложение по символу.
         Без цены символ уходит в «без курса» отдельной строкой, а не считается нулём. */
      var spot = (e.last && Array.isArray(e.last.spot)) ? e.last.spot : [];
      var spotUsd = 0;
      spot.forEach(function (b) {
        var price = symPrices[b.symbol];
        if (price == null) {
          out.push({ id: e.id + ':' + b.symbol, label: (e.label || e.id) + ': ' + b.symbol, type: 'exchange',
            owner: ownerOf(e.owner), native: b.amount, currency: b.symbol, sign: 1, date: t.at });
          return;
        }
        spotUsd += b.amount * price;
      });
      if (t.equity == null && !spotUsd) return;
      out.push({ id: e.id, label: e.label || e.id, type: 'exchange', owner: ownerOf(e.owner), native: (t.equity || 0) + spotUsd, currency: (e.last && e.last.currency) || 'USD', sign: 1, date: t.at, pnl: t.unrealizedPnl });
    });
    (state.investments || []).forEach(function (i) {
      var lv = lastValuation(i);
      var v = grown(i.id, lv || { value: null, date: null });
      if (v.value == null) return;
      var type = ASSET_TYPES[i.type] ? i.type : 'other';
      out.push({ id: i.id, label: i.name, type: type, owner: ownerOf(i.owner), native: v.value, currency: i.currency || 'USD', sign: ASSET_TYPES[type].sign, date: v.date });
    });
    (state.coins || []).forEach(function (c) {
      var amount = parseNum(c.amount);
      if (amount == null) return;
      var pr = (state.coinPrices || {})[c.coinId];
      var label = (c.symbol || c.coinId) + (c.place ? ' на ' + c.place : '');
      /* без цены монета идёт в «без курса» в своих единицах, в сумму не входит */
      if (!pr || parseNum(pr.usd) == null) {
        out.push({ id: c.id, label: label, type: 'coins', owner: ownerOf(c.owner), native: amount, currency: c.symbol || c.coinId, sign: 1, date: null });
        return;
      }
      out.push({ id: c.id, label: label, type: 'coins', owner: ownerOf(c.owner), native: amount * pr.usd, currency: 'USDT', sign: 1, date: pr.at });
    });
    /* Квартира в капитал не входит с этой сборки: продавать её не собираются (G01).
       Данные и раздел остаются в коде, вернуть можно одной строкой здесь. */
    return out;
  }

  /* Цена по символу монеты: нужна споту бирж, у которого нет coinId CoinGecko. */
  function symbolPrices(state) {
    var prices = isObj(state) && isObj(state.coinPrices) ? state.coinPrices : {};
    var out = {};
    Object.keys(prices).forEach(function (coinId) {
      var p = prices[coinId];
      if (!isObj(p) || parseNum(p.usd) == null) return;
      var sym = String(p.symbol || '').toUpperCase();
      if (sym) out[sym] = parseNum(p.usd);
    });
    /* символ может быть известен только по позиции монеты в портфеле */
    (isObj(state) && Array.isArray(state.coins) ? state.coins : []).forEach(function (c) {
      var p = prices[c.coinId];
      var sym = String(c.symbol || '').toUpperCase();
      if (sym && out[sym] == null && isObj(p) && parseNum(p.usd) != null) out[sym] = parseNum(p.usd);
    });
    return out;
  }

  function capitalTotals(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var rates = effectiveRates(s);
    var all = positionsOf(s, o.today);
    var rows = o.owner ? all.filter(function (p) { return p.owner === o.owner; }) : all;

    var res = {
      totalUsd: 0, totalNoDrawdownUsd: 0, drawdownUsd: 0, cushionUsd: 0, exchangesUsd: 0,
      /* apartmentUsd остаётся в форме результата и всегда null: квартира вне капитала (G01) */
      apartmentUsd: null, investmentsUsd: 0, debtsUsd: 0, coinsUsd: 0,
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
      } else if (p.type === 'debt') {
        res.debtsUsd += usd;
      } else if (p.type === 'coins') {
        res.coinsUsd += usd;
      } else if (CUSHION_KINDS.indexOf(p.type) < 0) {
        res.investmentsUsd += usd;
      }
      res.byAccount.push({ id: p.id, label: p.label, type: p.type, owner: p.owner, usd: signed, native: p.native, currency: cur });
    });

    res.totalNoDrawdownUsd = res.totalUsd + res.drawdownUsd;
    res.byAccount.sort(function (a, b) { return (b.usd == null ? -Infinity : b.usd) - (a.usd == null ? -Infinity : a.usd); });
    return res;
  }

  /* Портфель монет: стоимость каждой позиции, итоги по монетам и по местам.
     Позиции без цены попадают в unpriced и в суммы не входят. */
  var STABLE_COINS = { tether: 1, 'usd-coin': 1 };
  /* База позиции в долларах: явное «вложено», иначе количество на точку входа,
     иначе стейбл по номиналу. Нет ничего из этого: позиция в результат не идёт. */
  function coinCost(c) {
    var amount = parseNum(c.amount), entry = parseNum(c.entry), invested = parseNum(c.invested);
    if (invested != null && invested > 0) return invested;
    if (amount == null) return null;
    if (entry != null && entry > 0) return amount * entry;
    return STABLE_COINS[c.coinId] ? amount : null;
  }
  function coinTotals(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var prices = isObj(s.coinPrices) ? s.coinPrices : {};
    var rows = (s.coins || []).filter(function (c) { return !o.owner || ownerOf(c.owner) === o.owner; });
    /* costUsd, pnlUsd, entryUsd: только по позициям с точкой входа и ценой, иначе процент врёт */
    var res = { totalUsd: 0, change24Usd: 0, costUsd: 0, pnlUsd: 0, entryUsd: 0, pnlPct: null, pnlByPlace: {}, rows: [], byPlace: {}, byCoin: {}, unpriced: [] };
    rows.forEach(function (c) {
      var amount = parseNum(c.amount);
      var pr = prices[c.coinId] || null;
      var usd = amount != null && pr ? amount * pr.usd : null;
      var ch = usd != null && pr.ch24 != null ? usd - usd / (1 + pr.ch24 / 100) : null;
      var entry = parseNum(c.entry);
      var cost = coinCost(c);
      var pnl = usd != null && cost != null ? usd - cost : null;
      res.rows.push({ id: c.id, coinId: c.coinId, symbol: c.symbol, name: c.name, amount: amount, place: c.place, owner: c.owner,
        price: pr ? pr.usd : null, ch24: pr ? pr.ch24 : null, usd: usd, at: pr ? pr.at : null,
        entry: entry, invested: parseNum(c.invested), stable: !!STABLE_COINS[c.coinId], note: c.note || '', costUsd: cost, pnlUsd: pnl, pnlPct: pnl != null && cost ? pnl / cost * 100 : null });
      if (usd == null) { if (amount != null) res.unpriced.push(c.symbol || c.coinId); return; }
      res.totalUsd += usd;
      if (ch != null) res.change24Usd += ch;
      var place = c.place || 'без места';
      res.byPlace[place] = (res.byPlace[place] || 0) + usd;
      if (pnl != null) {
        res.costUsd += cost; res.pnlUsd += pnl; res.entryUsd += usd;
        res.pnlByPlace[place] = (res.pnlByPlace[place] || 0) + pnl;
      }
      var b = res.byCoin[c.coinId] || (res.byCoin[c.coinId] = { symbol: c.symbol, amount: 0, usd: 0 });
      b.amount += amount; b.usd += usd;
    });
    res.pnlPct = res.costUsd ? res.pnlUsd / res.costUsd * 100 : null;
    res.rows.sort(function (a, b) { return (b.usd == null ? -1 : b.usd) - (a.usd == null ? -1 : a.usd); });
    return res;
  }


  /* ===================== рост: пополнения и доходность ===================== */

  var DAY_MS = 86400000;
  var DAYS_IN_MONTH = 30.4375;
  function dayNum(dateStr) {
    var p = String(dateStr || '').split('-').map(Number);
    if (p.length < 3 || p.some(isNaN)) return null;
    return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / DAY_MS);
  }
  function dayStr(n) {
    var d = new Date(n * DAY_MS);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function addDays(dateStr, n) { var d = dayNum(dateStr); return d == null ? null : dayStr(d + n); }

  /* дневная ставка в долях: сложная берётся корнем, простая делением */
  function dailyRate(y) {
    var r = parseNum(y && y.rate);
    if (r == null) return 0;
    r = r / 100;
    var days = y.per === 'day' ? 1 : y.per === 'month' ? DAYS_IN_MONTH : 365;
    if (days === 1) return r;
    return y.compound === false ? r / days : Math.pow(1 + r, 1 / days) - 1;
  }
  /* ставка в процентах за месяц, чтобы сравнивать бота в день и стейкинг в год */
  function monthlyPct(y) {
    var d = dailyRate(y);
    if (!d) return 0;
    return (y.compound === false ? d * DAYS_IN_MONTH : Math.pow(1 + d, DAYS_IN_MONTH) - 1) * 100;
  }

  function flowHits(f, n) {
    var amount = parseNum(f.amount);
    if (amount == null) return 0;
    var start = dayNum(f.start), end = f.end ? dayNum(f.end) : null;
    if (start == null || n < start || (end != null && n > end)) return 0;
    if (f.every === 'day') return amount;
    if (f.every === 'week') return (n - start) % 7 === 0 ? amount : 0;
    var d = new Date(n * DAY_MS);
    var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return d.getUTCDate() === Math.min(f.day, last) ? amount : 0;
  }
  /* сколько пополнение даёт в среднем за месяц */
  function flowMonthly(f) {
    var a = parseNum(f.amount);
    if (a == null) return 0;
    return f.every === 'day' ? a * DAYS_IN_MONTH : f.every === 'week' ? a * DAYS_IN_MONTH / 7 : a;
  }

  /* цель роста: счёт или инвестиция, её последняя сверка и валюта */
  function growthTarget(state, id) {
    var a = (state.accounts || []).filter(function (x) { return x.id === id; })[0];
    if (a) { var b = accountBalance(a); return { id: id, ent: 'account', label: a.name, currency: a.currency || 'USD', owner: a.owner, value: b.value, date: b.date }; }
    var i = (state.investments || []).filter(function (x) { return x.id === id; })[0];
    if (i) { var v = lastValuation(i); return { id: id, ent: 'investment', label: i.name, currency: i.currency || 'USD', owner: i.owner, value: v ? v.value : null, date: v ? v.date : null }; }
    return null;
  }
  function hasGrowth(state, id) {
    return (state.flows || []).some(function (f) { return f.targetId === id; }) ||
      (state.yields || []).some(function (y) { return y.targetId === id && parseNum(y.rate); });
  }

  /* Стоимость цели на дату to: от последней сверки день за днём начисляется доходность,
     в дни пополнений добавляется сумма. Простой процент считается от вложенного, без процентов на проценты.
     Без сверки отсчёт идёт с первого пополнения от нуля. */
  function projectValue(state, id, to) {
    var t = growthTarget(state, id);
    if (!t) return null;
    var flows = (state.flows || []).filter(function (f) { return f.targetId === id; });
    var y = (state.yields || []).filter(function (x) { return x.targetId === id; })[0] || null;
    var baseDate = t.date, base = t.value;
    if (base == null || !baseDate) {
      var starts = flows.map(function (f) { return f.start; }).sort();
      if (!starts.length) return null;
      base = 0; baseDate = addDays(starts[0], -1);
    }
    var from = dayNum(baseDate), end = dayNum(to || todayStr());
    if (from == null || end == null) return null;
    var dr = dailyRate(y), simple = y && y.compound === false;
    var principal = base, value = base, contributed = 0, earned = 0;
    for (var n = from + 1; n <= end; n++) {
      var inc = simple ? principal * dr : value * dr;
      value += inc; earned += inc;
      var add = 0;
      for (var k = 0; k < flows.length; k++) add += flowHits(flows[k], n);
      if (add) { value += add; principal += add; contributed += add; }
    }
    return { id: id, label: t.label, currency: t.currency, owner: t.owner, base: base, baseDate: baseDate, to: dayStr(Math.max(end, from)),
      value: value, contributed: contributed, earned: earned, monthlyPct: monthlyPct(y), yieldRule: y };
  }

  /* Фактическая доходность по сверкам: от первой до последней оценки за вычетом пополнений по правилам,
     в процентах за месяц. Нужна ботам с гибкой прибылью: ставку не угадать, а сверки покажут. */
  function realizedMonthlyPct(state, id) {
    var a = (state.accounts || []).filter(function (x) { return x.id === id; })[0];
    var i = (state.investments || []).filter(function (x) { return x.id === id; })[0];
    var list = a ? a.balances : i ? i.valuations : [];
    list = (list || []).filter(function (v) { return parseNum(v.value) != null && dayNum(v.date) != null; }).slice().sort(byDateAsc);
    if (list.length < 2) return null;
    var first = list[0], last = list[list.length - 1];
    var f0 = parseNum(first.value), f1 = parseNum(last.value);
    var d0 = dayNum(first.date), d1 = dayNum(last.date);
    if (!(f0 > 0) || d1 <= d0) return null;
    var flows = (state.flows || []).filter(function (f) { return f.targetId === id; });
    var added = 0;
    for (var n = d0 + 1; n <= d1; n++) for (var k = 0; k < flows.length; k++) added += flowHits(flows[k], n);
    var g = (f1 - added) / f0;
    if (!(g > 0)) return null;
    return (Math.pow(g, DAYS_IN_MONTH / (d1 - d0)) - 1) * 100;
  }

  /* Живой прирост капитала за сутки в долларах: монеты по суточному изменению цены
     плюс суточное начисление по ставкам доходности. Пополнения сюда не входят: это не прирост. */
  function liveChange(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var today = o.today || todayStr();
    var coins = coinTotals(s, { owner: o.owner });
    var yieldUsd = 0;
    (s.yields || []).forEach(function (y) {
      var p = projectValue(s, y.targetId, today);
      if (!p || (o.owner && ownerOf(p.owner) !== o.owner)) return;
      var v = toUsd(p.value * dailyRate(y), p.currency, effectiveRates(s));
      if (v != null) yieldUsd += v;
    });
    var total = capitalTotals(s, { owner: o.owner, today: today }).totalUsd;
    var usd = coins.change24Usd + yieldUsd;
    var before = total - usd;
    return { usd: usd, pct: before ? usd / before * 100 : null, coinsUsd: coins.change24Usd, yieldUsd: yieldUsd, totalUsd: total };
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

  /* Подробности точки истории: курс рубля, монеты как [количество, цена], счета и биржи.
     Одна форма для снимка месяца и для дневной точки: атрибуция читает обе одинаково. */
  function pointDetails(state, totals) {
    var s = isObj(state) ? state : defaultState();
    var usdRub = rubPerUnit('USD', effectiveRates(s));
    var prices = isObj(s.coinPrices) ? s.coinPrices : {};
    var coins = {};
    (s.coins || []).forEach(function (c) {
      var amount = parseNum(c.amount);
      if (amount == null) return;
      var pr = prices[c.coinId];
      var price = isObj(pr) && parseNum(pr.usd) != null ? parseNum(pr.usd) : 0;
      var prev = coins[c.coinId];
      coins[c.coinId] = [(prev ? prev[0] : 0) + amount, price || (prev ? prev[1] : 0)];
    });
    var acc = {};
    totals.byAccount.forEach(function (r) {
      if (r.type === 'coins') return;
      acc[r.id] = { u: r.usd, n: r.native, c: r.currency };
    });
    /* equity точки вместе со спотом по цене приложения, как в totalUsd: иначе рост цены спота
       не попал бы ни в один слой водопада и ушёл в «не разложено» */
    var ex = {};
    var symPrices = symbolPrices(s);
    (s.exchanges || []).forEach(function (e) {
      var t = exchangeTotals(e);
      var spotUsd = exchangeSpotUsd(e, symPrices);
      if (t.equity == null && !spotUsd) return;
      ex[e.id] = { equity: (t.equity || 0) + spotUsd, pnl: t.unrealizedPnl };
    });
    return { usdRub: usdRub == null ? null : usdRub, coins: coins, acc: acc, ex: ex };
  }

  function makeSnapshot(state, ym, at) {
    var t = capitalTotals(state, { today: at ? todayStr(new Date(at)) : undefined });
    var byAccount = {};
    t.byAccount.forEach(function (r) { byAccount[r.id] = r.usd; });
    var d = pointDetails(state, t);
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
      coinsUsd: t.coinsUsd,
      debtsUsd: t.debtsUsd,
      byType: t.byType,
      byOwner: t.byOwner,
      byAccount: byAccount,
      usdRub: d.usdRub,
      coins: d.coins,
      acc: d.acc,
      ex: d.ex,
    };
  }

  /* ===================== дневная история ===================== */

  /* Точка дня: тот же состав, что у снимка месяца, плюс дата без месяца.
     Без настоящего курса ЦБ точка не строится: по запасному курсу рублёвые активы врут,
     а история копится годами и потом не чинится. */
  function makePoint(state, at) {
    var s = isObj(state) ? state : defaultState();
    var rates = effectiveRates(s);
    if (rates.USD && rates.USD.fallback) return null;
    var when = at || new Date().toISOString();
    var date = todayStr(new Date(when));
    var t = capitalTotals(s, { today: date });
    var d = pointDetails(s, t);
    return {
      at: when,
      date: date,
      totalUsd: t.totalUsd,
      totalNoDrawdownUsd: t.totalNoDrawdownUsd,
      drawdownUsd: t.drawdownUsd,
      cushionUsd: t.cushionUsd,
      exchangesUsd: t.exchangesUsd,
      coinsUsd: t.coinsUsd,
      investmentsUsd: t.investmentsUsd,
      debtsUsd: t.debtsUsd,
      usdRub: d.usdRub,
      coins: d.coins,
      acc: d.acc,
      ex: d.ex,
    };
  }

  /* Точку дня пишут и агент, и приложение. Побеждает более новый at: так два писателя не дублируют. */
  function addDaily(state, point) {
    var s = isObj(state) ? state : defaultState();
    if (!isObj(s.daily)) s.daily = {};
    if (!isObj(point) || !/^\d{4}-\d{2}-\d{2}$/.test(String(point.date || ''))) return s;
    var cur = s.daily[point.date];
    if (!isObj(cur) || !cur.at || (point.at && String(point.at) > String(cur.at))) s.daily[point.date] = point;
    return s;
  }

  function dailyKeys(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var daily = isObj(s.daily) ? s.daily : {};
    return Object.keys(daily).filter(function (d) {
      if (o.from && d < o.from) return false;
      if (o.to && d > o.to) return false;
      return isObj(daily[d]);
    }).sort();
  }

  function historySeries(state, opts) {
    var daily = isObj(state) && isObj(state.daily) ? state.daily : {};
    return dailyKeys(state, opts).map(function (d) {
      var p = daily[d];
      return { date: d, totalUsd: parseNum(p.totalUsd), totalNoDrawdownUsd: parseNum(p.totalNoDrawdownUsd) };
    });
  }

  /* Точка по ключу: 'YYYY-MM-DD' это дневная точно или ближайшая раньше, 'YYYY-MM' это снимок месяца. */
  function pointAt(state, key) {
    var s = isObj(state) ? state : defaultState();
    var k = String(key || '');
    if (/^\d{4}-\d{2}$/.test(k)) {
      var sn = isObj(s.snapshots) ? s.snapshots[k] : null;
      return isObj(sn) ? sn : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return null;
    var daily = isObj(s.daily) ? s.daily : {};
    if (isObj(daily[k])) return daily[k];
    var keys = Object.keys(daily).filter(function (d) { return d <= k && isObj(daily[d]); }).sort();
    return keys.length ? daily[keys[keys.length - 1]] : null;
  }

  /* Статистика периода: максимальная просадка по дневному ряду, лучший и худший день, год к году. */
  function historyStats(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var ser = historySeries(s, opts).filter(function (p) { return p.totalUsd != null; });
    var res = {
      maxDrawdownPct: 0, maxDrawdownUsd: 0, maxDrawdownFrom: null, maxDrawdownTo: null,
      bestDay: null, worstDay: null, yoyUsd: null, yoyPct: null, days: ser.length,
    };
    if (!ser.length) return res;
    var peak = ser[0].totalUsd, peakDate = ser[0].date;
    for (var i = 0; i < ser.length; i++) {
      var v = ser[i].totalUsd;
      if (v > peak) { peak = v; peakDate = ser[i].date; }
      var down = peak - v;
      if (down > res.maxDrawdownUsd) {
        res.maxDrawdownUsd = down;
        res.maxDrawdownPct = peak ? down / peak * 100 : 0;
        res.maxDrawdownFrom = peakDate;
        res.maxDrawdownTo = ser[i].date;
      }
      if (i > 0) {
        var prev = ser[i - 1].totalUsd;
        var day = { date: ser[i].date, usd: v - prev, pct: prev ? (v - prev) / prev * 100 : null };
        if (!res.bestDay || day.usd > res.bestDay.usd) res.bestDay = day;
        if (!res.worstDay || day.usd < res.worstDay.usd) res.worstDay = day;
      }
    }
    var last = ser[ser.length - 1];
    var yearAgo = addDays(last.date, -365);
    var ago = yearAgo ? pointAt(s, yearAgo) : null;
    if (ago && parseNum(ago.totalUsd) != null && String(ago.date || '') !== last.date) {
      var was = parseNum(ago.totalUsd);
      res.yoyUsd = last.totalUsd - was;
      res.yoyPct = was ? res.yoyUsd / was * 100 : null;
    }
    return res;
  }

  /* ===================== водопад «почему изменилось» ===================== */

  var ATTRIBUTION_KEYS = ['coinPrice', 'coinAmount', 'exchangeTrade', 'exchangeFlow', 'yieldEarned',
    'accountFlow', 'accountReval', 'investReval', 'rubRate', 'other'];
  var ATTRIBUTION_LABELS = {
    coinPrice: 'Цена монет',
    coinAmount: 'Куплено и продано монет',
    exchangeTrade: 'Биржи: торговля',
    exchangeFlow: 'Биржи: пополнения и выводы',
    yieldEarned: 'Ставки',
    accountFlow: 'Пополнения счетов',
    accountReval: 'Сверки счетов',
    investReval: 'Переоценка инвестиций',
    rubRate: 'Курс рубля',
    other: 'Прочее',
  };

  function pointDate(point) {
    if (!isObj(point)) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(point.date || ''))) return point.date;
    return String(point.at || '').slice(0, 10);
  }

  /* Месяцы, чьи пополнения бирж относятся к периоду. Дат отдельных вводов нет, месячная сумма
     ставится на 15-е число: месяц входит, если его 15-е в периоде (fromDate, toDate].
     Правило то же, что у exchangeCashflows для XIRR, чтобы водопад и доходность не расходились. */
  function flowMonthsInside(fromDate, toDate) {
    var out = [];
    if (!fromDate || !toDate) return out;
    var ym = String(fromDate).slice(0, 7), endYm = String(toDate).slice(0, 7);
    for (var guard = 0; guard < 600 && ymDiff(ym, endYm) >= 0; guard++) {
      var mid = ym + '-15';
      if (mid > fromDate && mid <= toDate) out.push(ym);
      ym = ymAdd(ym, 1);
    }
    return out;
  }

  /* Атрибуция по двум точкам истории, не по событиям: событий в state нет, а точки несут всё нужное.
     Что не разложилось, идёт в residualUsd и показывается как «не разложено», без подгонки. */
  function attribution(state, fromKey, toKey) {
    var s = isObj(state) ? state : defaultState();
    var from = pointAt(s, fromKey), to = pointAt(s, toKey);
    if (!isObj(from) || !isObj(to)) return null;
    var startUsd = parseNum(from.totalUsd), endUsd = parseNum(to.totalUsd);
    if (startUsd == null || endUsd == null) return null;

    var sum = {};
    ATTRIBUTION_KEYS.forEach(function (k) { sum[k] = 0; });
    var months = [];
    var pack = function (residual) {
      return {
        from: from, to: to, startUsd: startUsd, endUsd: endUsd, flowMonths: months,
        parts: ATTRIBUTION_KEYS.map(function (k) { return { key: k, label: ATTRIBUTION_LABELS[k], usd: sum[k] }; }),
        residualUsd: residual,
      };
    };

    /* старый снимок без coins/acc/ex разложить нечем: всё честно уходит в «прочее» */
    if (!isObj(from.acc) || !isObj(to.acc)) {
      sum.other = endUsd - startUsd;
      return pack(0);
    }

    var rates = effectiveRates(s);
    var fromDate = pointDate(from), toDate = pointDate(to);
    var d0 = dayNum(fromDate), d1 = dayNum(toDate);
    if (d0 == null || d1 == null || d1 < d0) return null;

    /* монеты: цена отдельно от количества (a0*(p1-p0) и (a1-a0)*p1) */
    var cf = isObj(from.coins) ? from.coins : {}, ct = isObj(to.coins) ? to.coins : {};
    var coinIds = {};
    Object.keys(cf).forEach(function (k) { coinIds[k] = true; });
    Object.keys(ct).forEach(function (k) { coinIds[k] = true; });
    Object.keys(coinIds).forEach(function (id) {
      var a = Array.isArray(cf[id]) ? cf[id] : null;
      var b = Array.isArray(ct[id]) ? ct[id] : null;
      var a0 = a ? num(a[0]) : 0, p0 = a ? num(a[1]) : 0;
      var a1 = b ? num(b[0]) : 0, p1 = b ? num(b[1]) : p0;
      sum.coinPrice += a0 * (p1 - p0);
      sum.coinAmount += (a1 - a0) * p1;
    });

    /* биржи: пополнения по месяцам периода, торговля это остаток изменения equity */
    months = flowMonthsInside(fromDate, toDate);
    var exFlow = {};
    (s.exchanges || []).forEach(function (e) {
      var f = 0;
      months.forEach(function (ym) {
        var m = isObj(e.monthly) ? e.monthly[ym] : null;
        if (isObj(m)) f += num(m.deposits) - num(m.withdrawals) - num(m.tithe);
      });
      exFlow[e.id] = f;
    });
    var exF = isObj(from.ex) ? from.ex : {}, exT = isObj(to.ex) ? to.ex : {};
    var exIds = {};
    Object.keys(exF).forEach(function (k) { exIds[k] = true; });
    Object.keys(exT).forEach(function (k) { exIds[k] = true; });
    Object.keys(exIds).forEach(function (id) {
      var eq0 = isObj(exF[id]) ? num(exF[id].equity) : 0;
      var eq1 = isObj(exT[id]) ? num(exT[id].equity) : 0;
      var fl = exFlow[id] || 0;
      sum.exchangeFlow += fl;
      sum.exchangeTrade += (eq1 - eq0) - fl;
    });

    /* счета и инвестиции: курс рубля, пополнения, начисленные ставки, остальное это переоценка */
    var kind = {};
    (s.accounts || []).forEach(function (a) { kind[a.id] = 'account'; });
    (s.investments || []).forEach(function (i) { kind[i.id] = 'invest'; });
    var accIds = {};
    Object.keys(from.acc).forEach(function (k) { accIds[k] = true; });
    Object.keys(to.acc).forEach(function (k) { accIds[k] = true; });
    var r0 = parseNum(from.usdRub), r1 = parseNum(to.usdRub);
    Object.keys(accIds).forEach(function (id) {
      if (exIds[id]) return;  /* биржи уже разобраны через ex */
      var a = isObj(from.acc[id]) ? from.acc[id] : null;
      var b = isObj(to.acc[id]) ? to.acc[id] : null;
      var u0 = a ? parseNum(a.u) : 0, u1 = b ? parseNum(b.u) : 0;
      if (u0 == null || u1 == null) return;  /* актив без курса в сумму не входил */
      if (!kind[id]) { sum.other += u1 - u0; return; }
      var cur = (b && b.c) || (a && a.c) || 'USD';
      var rub = 0;
      if (cur === 'RUB' && a && r0 && r1) {
        var sgn = u0 < 0 ? -1 : 1;
        rub = sgn * num(a.n) * (1 / r1 - 1 / r0);
        sum.rubRate += rub;
      }
      var added = 0;
      (s.flows || []).forEach(function (f) {
        if (f.targetId !== id) return;
        for (var n = d0 + 1; n <= d1; n++) added += flowHits(f, n);
      });
      var addedUsd = added ? (toUsd(added, cur, rates) || 0) : 0;
      sum.accountFlow += addedUsd;
      var y = (s.yields || []).filter(function (x) { return x.targetId === id; })[0] || null;
      var earnedUsd = 0;
      if (y && a) {
        var dr = dailyRate(y), base = num(a.n), days = d1 - d0;
        var earned = y.compound === false ? base * dr * days : base * (Math.pow(1 + dr, days) - 1);
        earnedUsd = earned ? (toUsd(earned, cur, rates) || 0) : 0;
        sum.yieldEarned += earnedUsd;
      }
      var rest = (u1 - u0) - rub - addedUsd - earnedUsd;
      if (kind[id] === 'account') sum.accountReval += rest;
      else sum.investReval += rest;
    });

    var explained = 0;
    ATTRIBUTION_KEYS.forEach(function (k) { explained += sum[k]; });
    return pack(endUsd - startUsd - explained);
  }

  /* ===================== доходность: XIRR ===================== */

  /* Внутренняя годовая доходность неравномерных потоков. Ньютон с откатом на бисекцию:
     на потоках с большим пополнением в середине Ньютон уходит в расходимость.
     Ответ в долях (0.1 это 10 % годовых), null если решения нет. */
  function xirr(flows, guess) {
    var list = (Array.isArray(flows) ? flows : []).map(function (f) {
      return { d: dayNum(f && f.date), a: parseNum(f && f.amount) };
    }).filter(function (f) { return f.d != null && f.a != null; });
    if (list.length < 2) return null;
    var hasPos = false, hasNeg = false, scale = 0;
    list.forEach(function (f) { if (f.a > 0) hasPos = true; if (f.a < 0) hasNeg = true; scale += Math.abs(f.a); });
    if (!hasPos || !hasNeg) return null;
    var d0 = list[0].d;
    list.forEach(function (f) { if (f.d < d0) d0 = f.d; });
    var tol = 1e-7 * Math.max(1, scale);
    function npv(r) {
      var total = 0;
      for (var i = 0; i < list.length; i++) total += list[i].a / Math.pow(1 + r, (list[i].d - d0) / 365);
      return total;
    }
    var r = parseNum(guess);
    if (r == null) r = 0.1;
    for (var i = 0; i < 80; i++) {
      var f0 = npv(r);
      if (!isFinite(f0)) break;
      if (Math.abs(f0) < tol) return r;
      var h = 1e-7, der = (npv(r + h) - f0) / h;
      if (!isFinite(der) || der === 0) break;
      var next = r - f0 / der;
      if (!isFinite(next)) break;
      if (next <= -0.9999) next = (r - 0.9999) / 2;
      if (Math.abs(next - r) < 1e-12) { r = next; break; }
      r = next;
    }
    if (isFinite(r) && Math.abs(npv(r)) < tol) return r;
    var lo = -0.9999, hi = 1000, flo = npv(lo), fhi = npv(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
    for (var k = 0; k < 300; k++) {
      var mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < tol) return mid;
      if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  /* Ряд equity биржи по истории: снимки месяцев и дневные точки в одном ряду, по дате.
     opts.today добавляет текущую оценку из last.equity, если она позже последней точки. */
  function exchangePoints(state, id, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var map = {};
    function pick(p) {
      if (!isObj(p)) return null;
      if (isObj(p.ex) && isObj(p.ex[id]) && parseNum(p.ex[id].equity) != null) return parseNum(p.ex[id].equity);
      if (isObj(p.acc) && isObj(p.acc[id]) && parseNum(p.acc[id].u) != null) return parseNum(p.acc[id].u);
      if (isObj(p.byAccount) && parseNum(p.byAccount[id]) != null) return parseNum(p.byAccount[id]);
      return null;
    }
    function add(date, eq) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || eq == null) return;
      if (o.from && date < o.from) return;
      if (o.to && date > o.to) return;
      map[date] = eq;
    }
    var snaps = isObj(s.snapshots) ? s.snapshots : {};
    Object.keys(snaps).sort().forEach(function (ym) { add(pointDate(snaps[ym]), pick(snaps[ym])); });
    var daily = isObj(s.daily) ? s.daily : {};
    Object.keys(daily).sort().forEach(function (d) { add(d, pick(daily[d])); });
    var dates = Object.keys(map).sort();
    if (o.today && dates.length && o.today > dates[dates.length - 1]) {
      var e = (s.exchanges || []).filter(function (x) { return x && x.id === id; })[0];
      var eq = e ? exchangeTotals(e).equity : null;
      if (eq != null) { map[o.today] = eq; dates.push(o.today); }
    }
    return dates.map(function (d) { return { date: d, equity: map[d] }; });
  }

  /* Пополнения, выводы и десятина биржи за период. Дат отдельных вводов в state нет,
     поэтому месячная сумма ставится на 15-е число: дискретизация честно огрублена. */
  function exchangeCashflows(state, id, firstDate, lastDate) {
    var e = ((isObj(state) ? state.exchanges : null) || []).filter(function (x) { return x && x.id === id; })[0];
    var out = { deposits: 0, withdrawals: 0, tithe: 0, flows: [] };
    if (!e || !isObj(e.monthly)) return out;
    Object.keys(e.monthly).sort().forEach(function (ym) {
      var mid = ym + '-15';
      if (mid <= firstDate || mid > lastDate) return;
      var m = e.monthly[ym];
      if (!isObj(m)) return;
      out.deposits += num(m.deposits);
      out.withdrawals += num(m.withdrawals);
      out.tithe += num(m.tithe);
      var amount = -num(m.deposits) + num(m.withdrawals) + num(m.tithe);
      if (amount) out.flows.push({ date: mid, amount: amount });
    });
    return out;
  }

  function buildReturn(state, ids, opts) {
    var s = isObj(state) ? state : defaultState();
    var flows = [], deposits = 0, withdrawals = 0, tithe = 0, startUsd = 0, endUsd = 0, points = 0;
    var from = null, to = null;
    ids.forEach(function (id) {
      var pts = exchangePoints(s, id, opts);
      if (pts.length < 2) return;
      points += pts.length;
      var first = pts[0], last = pts[pts.length - 1];
      startUsd += first.equity;
      endUsd += last.equity;
      if (!from || first.date < from) from = first.date;
      if (!to || last.date > to) to = last.date;
      flows.push({ date: first.date, amount: -first.equity });
      var cf = exchangeCashflows(s, id, first.date, last.date);
      deposits += cf.deposits;
      withdrawals += cf.withdrawals;
      tithe += cf.tithe;
      cf.flows.forEach(function (f) { flows.push(f); });
      flows.push({ date: last.date, amount: last.equity });
    });
    if (!points) return null;
    var profit = endUsd - startUsd - deposits + withdrawals + tithe;
    var r = xirr(flows);
    return {
      xirrPct: r == null ? null : r * 100,
      startUsd: startUsd, endUsd: endUsd,
      depositsUsd: deposits, withdrawalsUsd: withdrawals, titheUsd: tithe,
      profitUsd: profit, profitAfterTitheUsd: profit - tithe,
      from: from, to: to, points: points,
    };
  }

  function accountReturn(state, exchangeId, opts) {
    return buildReturn(state, [String(exchangeId || '')], opts);
  }

  /* Свод по группе: боты Veles против ручной торговли. Один XIRR на все потоки группы
     и текущая просадка группы, чтобы «заработали ли боты» было видно в цифре. */
  function groupReturn(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var want = !!o.veles;
    var list = (s.exchanges || []).filter(function (e) { return e && !!e.veles === want; });
    var ids = list.map(function (e) { return e.id; });
    if (!ids.length) return null;
    var res = buildReturn(s, ids, o);
    if (!res) return null;
    var drawdown = 0;
    list.forEach(function (e) {
      var pnl = exchangeTotals(e).unrealizedPnl;
      if (pnl != null && pnl < 0) drawdown += -pnl;
    });
    res.ids = ids;
    res.drawdownUsd = drawdown;
    return res;
  }

  /* ===================== риск ===================== */

  var QUOTES = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'DAI', 'USD', 'RUB', 'EUR', 'BTC', 'ETH'];

  /* Базовая монета из символа инструмента: биржи пишут его по-разному. */
  function baseSymbol(symbol) {
    var sym = String(symbol == null ? '' : symbol).toUpperCase().trim();
    if (!sym) return '';
    var cut = sym.split(/[-/_:]/)[0];
    if (cut !== sym) return cut;
    for (var i = 0; i < QUOTES.length; i++) {
      var q = QUOTES[i];
      if (sym.length > q.length && sym.slice(-q.length) === q) return sym.slice(0, sym.length - q.length);
    }
    return sym;
  }

  /* Риск-панель: по позициям расстояние до ликвидации, по аккаунтам доля equity под маржой,
     по семье концентрация и просадка. Пороги из настроек, тревоги списком для подсветки. */
  function riskReport(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var set = isObj(s.settings) ? s.settings : {};
    var liqAlertPct = num(set.liqAlertPct) > 0 ? num(set.liqAlertPct) : defaultState().settings.liqAlertPct;
    var drawdownAlertPct = num(set.drawdownAlertPct) > 0 ? num(set.drawdownAlertPct) : defaultState().settings.drawdownAlertPct;
    var list = (s.exchanges || []).filter(function (e) { return e && (!o.owner || ownerOf(e.owner) === o.owner); });

    var positions = [], accounts = [];
    var bySymbol = {};
    list.forEach(function (e) {
      var t = exchangeTotals(e);
      var rows = (e.last && Array.isArray(e.last.positions)) ? e.last.positions : [];
      var notionalSum = 0;
      rows.forEach(function (p) {
        var mark = parseNum(p.mark), liq = parseNum(p.liqPrice);
        /* номинал по модулю: Binance шлёт шорт со знаком минус, OKX и Bybit без знака */
        var notional = parseNum(p.notional) == null ? null : Math.abs(parseNum(p.notional));
        var dist = (mark != null && mark !== 0 && liq != null) ? Math.abs(mark - liq) / mark * 100 : null;
        var base = baseSymbol(p.symbol);
        if (notional != null) {
          notionalSum += notional;
          if (base) bySymbol[base] = (bySymbol[base] || 0) + notional;
        }
        positions.push({
          exchangeId: e.id, label: e.label || e.id, symbol: String(p.symbol || ''), base: base,
          side: p.side || '', size: parseNum(p.size), leverage: parseNum(p.leverage), liqPrice: liq,
          mark: mark, notional: notional, margin: parseNum(p.margin), pnl: parseNum(p.pnl),
          liqDistPct: dist, alert: dist != null && dist < liqAlertPct,
        });
      });
      accounts.push({
        exchangeId: e.id, label: e.label || e.id, equity: t.equity, inPositions: t.inPositions,
        marginUsePct: (t.equity && t.inPositions != null) ? t.inPositions / t.equity * 100 : null,
        notionalSum: notionalSum,
        leverageX: t.equity ? notionalSum / t.equity : null,
      });
    });
    /* ближе всех к ликвидации сверху, позиции без цены ликвидации в конец */
    positions.sort(function (a, b) {
      if (a.liqDistPct == null && b.liqDistPct == null) return 0;
      if (a.liqDistPct == null) return 1;
      if (b.liqDistPct == null) return -1;
      return a.liqDistPct - b.liqDistPct;
    });

    var totals = capitalTotals(s, { owner: o.owner });
    var coins = coinTotals(s, { owner: o.owner });
    Object.keys(coins.byCoin).forEach(function (coinId) {
      var b = coins.byCoin[coinId];
      var sym = baseSymbol(b.symbol || coinId);
      if (sym) bySymbol[sym] = (bySymbol[sym] || 0) + b.usd;
    });
    /* спот бирж с ценой: монеты на бирже это та же концентрация, что и в кошельке */
    var symPrices = symbolPrices(s);
    list.forEach(function (e) {
      normLast(e.last).spot.forEach(function (b) {
        if (symPrices[b.symbol] != null) bySymbol[b.symbol] = (bySymbol[b.symbol] || 0) + b.amount * symPrices[b.symbol];
      });
    });
    var total = totals.totalUsd;
    var top = Object.keys(bySymbol).map(function (sym) {
      return { symbol: sym, usd: bySymbol[sym], pct: total ? bySymbol[sym] / total * 100 : null };
    }).sort(function (a, b) { return b.usd - a.usd; });
    var btcEth = (bySymbol.BTC || 0) + (bySymbol.ETH || 0);

    var drawdownPct = totals.totalNoDrawdownUsd ? totals.drawdownUsd / totals.totalNoDrawdownUsd * 100 : 0;
    var alerts = [];
    if (drawdownPct > drawdownAlertPct) {
      alerts.push({ kind: 'drawdown', text: 'просадка ' + fmt(drawdownPct) + ' % капитала, порог ' + fmt(drawdownAlertPct) + ' %' });
    }
    positions.filter(function (p) { return p.alert; }).forEach(function (p) {
      alerts.push({ kind: 'liq', text: p.base + ' на ' + p.label + ': до ликвидации ' + fmt(p.liqDistPct) + ' %' });
    });

    return {
      positions: positions,
      accounts: accounts,
      drawdownPct: drawdownPct,
      drawdownUsd: totals.drawdownUsd,
      totalUsd: total,
      concentration: { btcEthPct: total ? btcEth / total * 100 : null, top: top },
      alerts: alerts,
    };
  }

  /* ===================== цели, подушка, «что если», аллокация ===================== */

  /* Подушка в месяцах жизни: расход семьи задан числом в настройках,
     потому что раздел «Месяц» скрыт и расходы ведутся в бюджете. */
  function cushionMonths(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var expense = num(isObj(s.settings) ? s.settings.monthlyExpenseUsd : 0);
    if (!(expense > 0)) return null;
    return capitalTotals(s, { owner: isObj(opts) ? opts.owner : undefined }).cushionUsd / expense;
  }

  /* Фактический темп: средний прирост в месяц по дневной истории за окно days.
     Дневных точек меньше двух: считаем по снимкам месяцев. Меньше 30 дней истории: null,
     на такой базе месячный темп это шум, а не факт. */
  function factMonthlyPct(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var days = num(o.days) > 0 ? num(o.days) : 90;
    var today = o.today || todayStr();
    function rate(v0, v1, span) {
      if (span < 30 || !(v0 > 0) || !(v1 > 0)) return null;
      return (Math.pow(v1 / v0, DAYS_IN_MONTH / span) - 1) * 100;
    }
    var ser = historySeries(s, { from: addDays(today, -days), to: today }).filter(function (p) { return p.totalUsd != null; });
    if (ser.length >= 2) {
      var d0 = dayNum(ser[0].date), d1 = dayNum(ser[ser.length - 1].date);
      return rate(ser[0].totalUsd, ser[ser.length - 1].totalUsd, d1 - d0);
    }
    var snaps = isObj(s.snapshots) ? s.snapshots : {};
    var keys = Object.keys(snaps).sort().filter(function (ym) { return isObj(snaps[ym]) && parseNum(snaps[ym].totalUsd) != null; });
    if (keys.length < 2) return null;
    var a = snaps[keys[0]], b = snaps[keys[keys.length - 1]];
    var da = dayNum(pointDate(a)), db = dayNum(pointDate(b));
    if (da == null || db == null) return null;
    return rate(parseNum(a.totalUsd), parseNum(b.totalUsd), db - da);
  }

  /* Траектория от текущей суммы: месяц за месяцем ставка и пополнение.
     reachYm это первый месяц, в котором сумма достигает цели, valueAtYm значение в месяце цели. */
  function projectToGoal(start, ratePct, monthlyAdd, ym0, goalYm, targetUsd) {
    var value = start, reachYm = null, valueAtYm = null;
    var steps = goalYm ? ymDiff(ym0, goalYm) : 0;
    if (value >= targetUsd) reachYm = ym0;
    if (goalYm && steps <= 0) valueAtYm = start;
    for (var i = 1; i <= 600; i++) {
      value = value * (1 + num(ratePct) / 100) + num(monthlyAdd);
      var ym = ymAdd(ym0, i);
      if (!reachYm && value >= targetUsd) reachYm = ym;
      if (goalYm && i === steps) valueAtYm = value;
      if (reachYm && (!goalYm || i >= steps)) break;
      if (!isFinite(value)) break;
    }
    return { reachYm: reachYm, valueAtYm: valueAtYm };
  }

  function goalProgress(state, goalId, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var goals = (isObj(s.settings) && Array.isArray(s.settings.goals)) ? s.settings.goals : [];
    var goal = goals.filter(function (g) { return isObj(g) && g.id === goalId; })[0];
    if (!goal || !(goal.targetUsd > 0)) return null;
    var today = o.today || todayStr();
    var ym0 = today.slice(0, 7);
    var haveUsd = capitalTotals(s, { today: today }).totalUsd;
    var scenarios = (isObj(s.settings) && Array.isArray(s.settings.scenarios)) ? s.settings.scenarios : [];
    var scen = (o.scenarioId ? scenarios.filter(function (x) { return x.id === o.scenarioId; })[0] : null) || scenarios[0] || null;
    var byScenario = projectToGoal(haveUsd, scen ? scen.ratePct : 0, scen ? scen.monthlyAdd : 0, ym0, goal.ym, goal.targetUsd);
    byScenario.scenarioId = scen ? scen.id : null;
    var fact = factMonthlyPct(s, { today: today });
    var byFact = fact == null ? { reachYm: null, valueAtYm: null } : projectToGoal(haveUsd, fact, 0, ym0, goal.ym, goal.targetUsd);
    byFact.monthlyPct = fact;
    var monthsLeft = goal.ym ? ymDiff(ym0, goal.ym) : null;
    /* сколько добирать в месяц, если расти будет только фактическим темпом (или вовсе не будет) */
    var needMonthlyAddUsd = null;
    if (monthsLeft != null && monthsLeft > 0) {
      var r = fact == null ? 0 : fact / 100;
      var grown = haveUsd * Math.pow(1 + r, monthsLeft);
      var factor = r ? (Math.pow(1 + r, monthsLeft) - 1) / r : monthsLeft;
      needMonthlyAddUsd = factor ? Math.max(0, (goal.targetUsd - grown) / factor) : null;
    }
    return {
      goal: goal, haveUsd: haveUsd, leftUsd: goal.targetUsd - haveUsd,
      pct: goal.targetUsd ? haveUsd / goal.targetUsd * 100 : null,
      monthsLeft: monthsLeft, byScenario: byScenario, byFact: byFact, needMonthlyAddUsd: needMonthlyAddUsd,
    };
  }

  function whatIfSeries(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var today = o.today || todayStr();
    var months = num(o.months) > 0 ? Math.round(num(o.months)) : 36;
    var value = capitalTotals(s, { today: today }).totalUsd * (1 - num(o.drawdownPct) / 100);
    var ym = today.slice(0, 7);
    var out = [{ ym: ym, value: value }];
    for (var i = 1; i <= months; i++) {
      value = value * (1 + num(o.ratePct) / 100) + num(o.monthlyAdd);
      out.push({ ym: ymAdd(ym, i), value: value });
    }
    return out;
  }

  /* В какую корзину аллокации попадает актив. Долг ни в одну: он не доля портфеля. */
  function basketOf(type) {
    if (CUSHION_KINDS.indexOf(type) >= 0) return 'cushion';
    if (type === 'exchange') return 'exchanges';
    if (type === 'coins') return 'coins';
    if (type === 'debt') return null;
    return 'investments';
  }

  /* Целевая аллокация: факт против цели по типам и по владельцам плюс одна подсказка перевода.
     Отклонение меньше двух процентов это шум: подсказку не даём. */
  function rebalance(state, opts) {
    var s = isObj(state) ? state : defaultState();
    var o = isObj(opts) ? opts : {};
    var t = capitalTotals(s, { owner: o.owner });
    var targets = (isObj(s.settings) && isObj(s.settings.targets)) ? s.settings.targets : { byType: {}, byOwner: {} };
    var tType = isObj(targets.byType) ? targets.byType : {};
    var tOwner = isObj(targets.byOwner) ? targets.byOwner : {};
    var actual = { cushion: t.cushionUsd, exchanges: t.exchangesUsd, coins: t.coinsUsd, investments: t.investmentsUsd };
    var base = 0;
    REBALANCE_KEYS.forEach(function (k) { base += actual[k]; });
    function row(key, label, usd, whole, targetPct) {
      var actualPct = whole ? usd / whole * 100 : null;
      return {
        key: key, label: label, targetPct: targetPct, actualPct: actualPct, actualUsd: usd,
        deltaUsd: targetPct == null ? null : usd - whole * targetPct / 100,
        deltaPct: (targetPct == null || actualPct == null) ? null : actualPct - targetPct,
      };
    }
    var byType = REBALANCE_KEYS.map(function (k) { return row(k, REBALANCE_LABELS[k], actual[k], base, parseNum(tType[k])); });
    var byOwner = OWNERS.map(function (ow) { return row(ow, ow, num(t.byOwner[ow]), t.totalUsd, parseNum(tOwner[ow])); });

    var known = byType.filter(function (r) { return r.deltaPct != null; });
    var ok = known.every(function (r) { return Math.abs(r.deltaPct) < 2; });
    var moves = [];
    if (!ok) {
      var over = known.slice().sort(function (a, b) { return b.deltaUsd - a.deltaUsd; })[0];
      var under = known.slice().sort(function (a, b) { return a.deltaUsd - b.deltaUsd; })[0];
      if (over && under && over.key !== under.key && over.deltaUsd > 0 && under.deltaUsd < 0) {
        var usd = Math.round(Math.min(over.deltaUsd, -under.deltaUsd) / 100) * 100;
        if (usd > 0) {
          var src = t.byAccount.filter(function (r) { return r.usd != null && basketOf(r.type) === over.key; })[0] || null;
          moves.push({ fromKey: over.key, toKey: under.key, usd: usd, fromAccount: src ? { id: src.id, label: src.label } : null });
        }
      }
    }
    return { byType: byType, byOwner: byOwner, moves: moves, ok: ok };
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
        /* белый список бирж: опечатка в keys.json не должна плодить карточки неизвестных бирж */
        if (EXCHANGES.indexOf(String(id).split('-')[0]) < 0) return;
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

    /* рыночный курс USDT/RUB приносит только агент: берём более свежий по at */
    if (isObj(agentPatch.rates)) {
      if (!isObj(out.rates)) out.rates = {};
      Object.keys(agentPatch.rates).forEach(function (cur) {
        var r = agentPatch.rates[cur];
        if (!isObj(r) || parseNum(r.value) == null) return;
        var prev = out.rates[cur];
        if (!isObj(prev) || String(r.at || '') > String(prev.at || '')) out.rates[cur] = r;
      });
    }

    if (isObj(agentPatch.daily)) {
      Object.keys(agentPatch.daily).forEach(function (d) { addDaily(out, agentPatch.daily[d]); });
    }

    if (isObj(agentPatch.agent)) out.agent = agentPatch.agent;
    return out;
  }

  /* ===================== слияние двух состояний ===================== */

  function maxStr(a, b) {
    var x = a == null ? '' : String(a), y = b == null ? '' : String(b);
    return (y > x ? y : x) || null;
  }

  /* Список сущностей с id: объединение по id, при совпадении побеждает больший updatedAt
     (без updatedAt сущность проигрывает), при равенстве local. Порядок local, новое в конец.
     Сущность с отметкой об удалении новее её правки в результат не попадает. */
  function mergeList(a, b, deleted) {
    var out = [], at = {};
    (Array.isArray(a) ? a : []).forEach(function (x) {
      if (!isObj(x) || !x.id) return;
      at[x.id] = out.length;
      out.push(x);
    });
    (Array.isArray(b) ? b : []).forEach(function (y) {
      if (!isObj(y) || !y.id) return;
      if (at[y.id] == null) { at[y.id] = out.length; out.push(y); return; }
      var cur = out[at[y.id]];
      if (String(y.updatedAt || '') > String(cur.updatedAt || '')) out[at[y.id]] = y;
    });
    return out.filter(function (x) {
      var tomb = deleted ? deleted[x.id] : null;
      return !(tomb && String(tomb) > String(x.updatedAt || ''));
    });
  }

  /* Карты с полем at (snapshots, daily, coinPrices): по ключу побеждает больший at. */
  function mergeMapByAt(a, b) {
    var out = {};
    Object.keys(isObj(a) ? a : {}).forEach(function (k) { out[k] = a[k]; });
    Object.keys(isObj(b) ? b : {}).forEach(function (k) {
      var cur = out[k];
      if (!isObj(cur)) { out[k] = b[k]; return; }
      if (!isObj(b[k])) return;
      if (String(b[k].at || '') > String(cur.at || '')) out[k] = b[k];
    });
    return out;
  }

  /* Курсы: рыночный приходит с at, курс ЦБ только с датой. */
  function mergeRates(a, b) {
    var out = {};
    Object.keys(isObj(a) ? a : {}).forEach(function (k) { out[k] = a[k]; });
    Object.keys(isObj(b) ? b : {}).forEach(function (k) {
      var cur = out[k], next = b[k];
      if (!isObj(cur)) { out[k] = next; return; }
      if (!isObj(next)) return;
      var ca = String(cur.at || ''), na = String(next.at || '');
      if (ca || na) { if (na > ca) out[k] = next; return; }
      if (String(next.date || '') > String(cur.date || '')) out[k] = next;
    });
    return out;
  }

  function pickLast(a, b) {
    var aa = String((isObj(a) && a.at) || ''), bb = String((isObj(b) && b.at) || '');
    if (bb > aa) return b;
    if (aa > bb) return a;
    var ae = String((isObj(a) && a.errorAt) || ''), be = String((isObj(b) && b.errorAt) || '');
    return be > ae ? b : a;
  }

  function mergeMonthly(a, b) {
    var out = {};
    Object.keys(isObj(a) ? a : {}).forEach(function (ym) { out[ym] = a[ym]; });
    Object.keys(isObj(b) ? b : {}).forEach(function (ym) {
      var cur = out[ym];
      if (!isObj(cur)) { out[ym] = b[ym]; return; }
      if (isObj(b[ym]) && String(b[ym].updatedAt || '') > String(cur.updatedAt || '')) out[ym] = b[ym];
    });
    return out;
  }

  /* Слияние двух состояний по сущностям: одна чистая функция для синка и для агента.
     «Кто позже сохранил, тот и прав» теряло правки второго устройства, поэтому решает
     updatedAt каждой сущности, а не savedAt всего файла. */
  function mergeStates(local, remote) {
    var out = migrate(JSON.parse(JSON.stringify(isObj(local) ? local : defaultState())));
    if (!isObj(remote)) return out;
    var rem = migrate(JSON.parse(JSON.stringify(remote)));

    var deleted = {};
    [out.deleted, rem.deleted].forEach(function (src) {
      Object.keys(isObj(src) ? src : {}).forEach(function (id) {
        if (!deleted[id] || String(src[id]) > String(deleted[id])) deleted[id] = src[id];
      });
    });
    out.deleted = deleted;

    ['accounts', 'investments', 'coins', 'flows', 'yields'].forEach(function (key) {
      out[key] = mergeList(out[key], rem[key], deleted);
    });

    /* биржи: сама карточка по updatedAt, цифры last по правилам агента, месяцы по своему updatedAt */
    var locEx = {}, remEx = {};
    (out.exchanges || []).forEach(function (e) { locEx[e.id] = e; });
    (rem.exchanges || []).forEach(function (e) { remEx[e.id] = e; });
    out.exchanges = mergeList(out.exchanges, rem.exchanges, deleted).map(function (e) {
      var l = locEx[e.id], r = remEx[e.id];
      if (!l || !r) return e;
      e.last = pickLast(l.last, r.last);
      e.monthly = mergeMonthly(l.monthly, r.monthly);
      return e;
    });

    var scenarios = mergeList(out.settings.scenarios, rem.settings.scenarios, deleted);
    var goals = mergeList(out.settings.goals, rem.settings.goals, deleted);
    if (String(rem.settings.updatedAt || '') > String(out.settings.updatedAt || '')) out.settings = rem.settings;
    out.settings.scenarios = scenarios;
    out.settings.goals = goals;

    out.snapshots = mergeMapByAt(out.snapshots, rem.snapshots);
    out.daily = mergeMapByAt(out.daily, rem.daily);
    out.coinPrices = mergeMapByAt(out.coinPrices, rem.coinPrices);
    out.rates = mergeRates(out.rates, rem.rates);

    if (String((rem.agent && rem.agent.lastRunAt) || '') > String((out.agent && out.agent.lastRunAt) || '')) out.agent = rem.agent;

    /* квартира и месяцы без updatedAt: решает чей файл сохранён позже */
    if (String(rem.savedAt || '') > String(out.savedAt || '')) {
      out.apartment = rem.apartment;
      out.months = rem.months;
    }
    out.savedAt = maxStr(out.savedAt, rem.savedAt);
    delete out.demo;
    return migrate(out);
  }

  /* ===================== демо ===================== */

  /* Выдуманные круглые цифры: ни одна не похожа на настоящие суммы семьи.
     Флаг demo=true: при первом своём вводе приложение заменяет демо на пустой state. */
  function demoState() {
    var s = defaultState();
    s.demo = true;
    s.rates = {
      USD: { value: 80, date: '2026-01-10', nominal: 1 },
      USDT: { value: 85, date: '2026-01-10', nominal: 1, source: 'rapira', at: '2026-01-10T09:00:00+03:00' },
      KZT: { value: 18, date: '2026-01-10', nominal: 100 },
      AMD: { value: 20, date: '2026-01-10', nominal: 100 },
    };
    s.settings.goals = [{ id: 'demo-goal', name: 'Цель к 2028', targetUsd: 250000, ym: '2028-01', updatedAt: '2026-01-10T09:00:00+03:00' }];
    s.settings.targets = { byType: { cushion: 20, exchanges: 40, coins: 20, investments: 20 },
      byOwner: { 'Костя': 50, 'Люба': 25, 'общий': 25 } };
    s.accounts = [
      { id: 'demo-cash', name: 'Наличка', kind: 'cash', bank: '', country: '', currency: 'USD', owner: 'общий', balances: [{ date: '2025-11-01', value: 2000 }, { date: '2026-01-05', value: 2500 }] },
      { id: 'demo-card-kz', name: 'Карта KZ', kind: 'card', bank: 'Банк KZ', country: 'Казахстан', currency: 'KZT', owner: 'Костя', balances: [{ date: '2026-01-05', value: 900000 }] },
      { id: 'demo-card-am', name: 'Карта AM', kind: 'card', bank: 'Банк AM', country: 'Армения', currency: 'AMD', owner: 'Люба', balances: [{ date: '2026-01-05', value: 400000 }] },
      { id: 'demo-bank', name: 'Банк', kind: 'bank', bank: 'Банк', country: '', currency: 'RUB', owner: 'общий', balances: [{ date: '2026-01-05', value: 400000 }] },
    ];
    s.exchanges = [
      { id: 'demo-okx', exchange: 'okx', label: 'OKX', owner: 'Костя', veles: false, source: 'agent',
        last: { at: '2026-01-10T09:00:00+03:00', equity: 9000, free: 6000, inPositions: 3000, unrealizedPnl: -800, currency: 'USD', error: null,
          positions: [{ symbol: 'BTC-USDT-SWAP', side: 'long', size: 0.1, entry: 50000, mark: 48000, pnl: -200,
            leverage: 5, liqPrice: 44000, notional: 4800, margin: 960 }] } },
      { id: 'demo-bybit-veles', exchange: 'bybit', label: 'Bybit Veles', owner: 'Костя', veles: true, source: 'agent',
        last: { at: '2026-01-10T09:00:00+03:00', equity: 4000, free: 1500, inPositions: 2500, unrealizedPnl: -400, currency: 'USD', error: null, positions: [] } },
      { id: 'demo-binance-veles', exchange: 'binance', label: 'Binance Veles', owner: 'Люба', veles: true, source: 'manual',
        last: { at: '2026-01-08T09:00:00+03:00', equity: 3000, free: 3000, inPositions: 0, unrealizedPnl: 0, currency: 'USD', error: null, positions: [] } },
    ];
    s.exchanges[0].monthly = {
      '2025-12': { deposits: 300, withdrawals: 0, tithe: 50, updatedAt: '2026-01-01T09:00:00+03:00' },
      '2026-01': { deposits: 500, withdrawals: 0, tithe: 100, updatedAt: '2026-01-10T09:00:00+03:00' },
    };
    /* спот Binance: монеты вне стейблов, которые приложение оценивает своими ценами */
    s.exchanges[2].last.spot = [{ symbol: 'BTC', amount: 0.01 }];
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
    s.coins = [
      { id: 'demo-btc', coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', amount: 0.15, entry: 72000, place: 'Binance', owner: 'Костя' },
      { id: 'demo-sol', coinId: 'solana', symbol: 'SOL', name: 'Solana', amount: 12, entry: 165, place: 'Bybit', owner: 'Костя' },
      { id: 'demo-link', coinId: 'chainlink', symbol: 'LINK', name: 'Chainlink', amount: 150, entry: 9, place: 'OKX', owner: 'Костя' },
      { id: 'demo-pyth', coinId: 'pyth-network', symbol: 'PYTH', name: 'Pyth Network', amount: 3000, place: 'Bybit', owner: 'Люба' },
    ];
    s.investments.push({ id: 'demo-asterium', type: 'stocks', name: 'Астериум стейкинг', owner: 'общий', currency: 'USDT', valuations: [{ date: '2026-09-01', value: 20000, source: 'пример' }], expectedYield: null, maturity: '', note: '' });
    s.investments.push({ id: 'demo-bot', type: 'other', name: 'Бот BTC', owner: 'Костя', currency: 'USDT', valuations: [{ date: '2026-08-01', value: 3000, source: 'пример' }, { date: '2026-10-01', value: 3240, source: 'пример' }], expectedYield: null, maturity: '', note: '' });
    s.flows = [{ id: 'demo-flow', name: 'Зарплата Любы', targetId: 'demo-asterium', amount: 5000, every: 'month', day: 10, start: '2026-09-01' }];
    s.yields = [
      { id: 'demo-y1', targetId: 'demo-asterium', rate: 9, per: 'year', compound: true },
      { id: 'demo-y2', targetId: 'demo-bot', rate: 0.13, per: 'day', compound: true },
    ];
    s.coinPrices = {
      bitcoin: { usd: 100000, ch24: 1.2, at: '2026-01-10T12:00:00', src: 'demo', symbol: 'BTC' },
      solana: { usd: 180, ch24: -2.4, at: '2026-01-10T12:00:00', src: 'demo', symbol: 'SOL' },
      chainlink: { usd: 20, ch24: 0.6, at: '2026-01-10T12:00:00', src: 'demo', symbol: 'LINK' },
      'pyth-network': { usd: 0.3, ch24: -4.1, at: '2026-01-10T12:00:00', src: 'demo', symbol: 'PYTH' },
    };
    /* шестьдесят дневных точек: по ним рисуется график «Динамики» и считается фактический темп */
    var endDay = dayNum('2026-01-10');
    for (var k = 59; k >= 0; k--) {
      var day = dayStr(endDay - k);
      var total = 52000 + (59 - k) * 60 + (k % 7) * 120;
      s.daily[day] = {
        at: day + 'T09:00:00+03:00', date: day,
        totalUsd: total, totalNoDrawdownUsd: total + 1200, drawdownUsd: 1200,
        cushionUsd: Math.round(total * 0.2), exchangesUsd: Math.round(total * 0.4),
        coinsUsd: Math.round(total * 0.2), investmentsUsd: Math.round(total * 0.2), debtsUsd: 3750,
        usdRub: 80,
        coins: { bitcoin: [0.15, 100000 - k * 50], solana: [12, 180] },
        acc: { 'demo-cash': { u: 2500, n: 2500, c: 'USD' }, 'demo-bank': { u: 5000, n: 400000, c: 'RUB' } },
        ex: { 'demo-okx': { equity: 9000 - k * 10, pnl: -800 }, 'demo-bybit-veles': { equity: 4000, pnl: -400 } },
      };
    }
    return migrate(s);
  }

  return {
    VERSION: VERSION,
    OWNERS: OWNERS,
    ASSET_TYPES: ASSET_TYPES,
    CUSHION_KINDS: CUSHION_KINDS,
    EXCHANGES: EXCHANGES,
    CURRENCIES: CURRENCIES,
    COIN_PLACES: COIN_PLACES,
    MONTH_TEMPLATE: MONTH_TEMPLATE,
    defaultState: defaultState,
    migrate: migrate,
    toUsd: toUsd,
    toRub: toRub,
    accountBalance: accountBalance,
    lastValuation: lastValuation,
    prevValuation: prevValuation,
    exchangeTotals: exchangeTotals,
    exchangeSpot: exchangeSpot,
    capitalTotals: capitalTotals,
    coinTotals: coinTotals,
    projectValue: projectValue,
    liveChange: liveChange,
    realizedMonthlyPct: realizedMonthlyPct,
    flowMonthly: flowMonthly,
    monthlyPct: monthlyPct,
    hasGrowth: hasGrowth,
    growthTarget: growthTarget,
    addDays: addDays,
    monthTotals: monthTotals,
    exchangeGrowth: exchangeGrowth,
    scenarioSeries: scenarioSeries,
    factSeries: factSeries,
    planDelta: planDelta,
    makeSnapshot: makeSnapshot,
    effectiveRates: effectiveRates,
    makePoint: makePoint,
    addDaily: addDaily,
    historySeries: historySeries,
    historyStats: historyStats,
    pointAt: pointAt,
    attribution: attribution,
    ATTRIBUTION_LABELS: ATTRIBUTION_LABELS,
    xirr: xirr,
    accountReturn: accountReturn,
    groupReturn: groupReturn,
    riskReport: riskReport,
    baseSymbol: baseSymbol,
    cushionMonths: cushionMonths,
    factMonthlyPct: factMonthlyPct,
    goalProgress: goalProgress,
    whatIfSeries: whatIfSeries,
    rebalance: rebalance,
    mergeAgent: mergeAgent,
    mergeStates: mergeStates,
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
