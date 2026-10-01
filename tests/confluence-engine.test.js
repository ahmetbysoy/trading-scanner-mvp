const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfluenceEngine } = require('../src/confluence-engine.js');

function createHarness(overrides = {}) {
    let now = 1_000_000;
    let pendingTimer = null;
    let nextTimerId = 1;
    const logs = [];

    const bot = {
        currentSymbol: 'BTCUSDT',
        marketData: { price: 60_000 },
        signals: [],
        eventBus: overrides.eventBus || null,
        strategies: {
            momentum: { displayName: 'Momentum' },
            orderFlow: { displayName: 'Order Flow' },
            divergence: { displayName: 'Divergence' }
        },
        settings: {
            confluenceThreshold: 3,
            cooldowns: {
                signalMs: 15_000,
                sameDirectionMs: 30_000,
                proposalTimeoutMs: 3_000
            },
            signalSafety: {
                evaluationDelayMs: 1_000,
                minScoreLead: 2,
                minConfirmations: 2,
                preventSignalsWhileActive: true,
                oppositeSignalLockMs: 120_000,
                minReversalConfirmations: 2,
                reversalScoreMultiplier: 1.25,
                blockedNoticeThrottleMs: 0
            }
        },
        calculateDynamicTpSl(signal) {
            signal.tp = signal.direction === 'buy' ? signal.price + 100 : signal.price - 100;
            signal.sl = signal.direction === 'buy' ? signal.price - 50 : signal.price + 50;
        },
        addFinalSignal(signal) {
            this.signals.unshift(signal);
        },
        logToJournal(message) {
            logs.push(message);
        }
    };

    if (overrides.settings) {
        bot.settings = {
            ...bot.settings,
            ...overrides.settings,
            cooldowns: { ...bot.settings.cooldowns, ...(overrides.settings.cooldowns || {}) },
            signalSafety: { ...bot.settings.signalSafety, ...(overrides.settings.signalSafety || {}) }
        };
    }

    const engine = new ConfluenceEngine(bot, {
        now: () => now,
        setTimeout(callback) {
            const id = nextTimerId++;
            pendingTimer = { id, callback };
            return id;
        },
        clearTimeout(id) {
            if (pendingTimer && pendingTimer.id === id) pendingTimer = null;
        }
    });

    return {
        bot,
        engine,
        logs,
        advance(ms) { now += ms; },
        runTimer() {
            const timer = pendingTimer;
            pendingTimer = null;
            if (timer) return timer.callback();
            return undefined;
        }
    };
}

test('ilk teklif hemen sinyal olmaz; değerlendirme penceresi karşıt oyları birlikte görür', () => {
    const h = createHarness();

    h.engine.propose('momentum', 'buy', 'hız yukarı', 5);
    assert.equal(h.bot.signals.length, 0, 'ilk gelen teklif anında yayınlanmamalı');

    h.engine.propose('orderFlow', 'sell', 'satıcı akışı', 5);
    const result = h.engine.evaluateNow();

    assert.equal(result.status, 'conflict');
    assert.equal(h.bot.signals.length, 0);
});

test('teklif kabulü ve zamanlanmış değerlendirme olay veri yoluna yayınlanır', () => {
    const events = [];
    const h = createHarness({
        eventBus: {
            emit(event, payload) {
                events.push({ event, payload });
            }
        }
    });

    h.engine.propose('momentum', 'buy', 'olay zinciri', 2);
    assert.equal(events[0].event, 'confluence.proposal.received');
    assert.equal(events[0].payload.strategy, 'momentum');

    h.runTimer();
    assert.equal(events[1].event, 'confluence.evaluated');
    assert.equal(events[1].payload.trigger, 'scheduled');
    assert.equal(events[1].payload.status, 'below-threshold');
});

test('tek stratejiden gelen skor 5, bağımsız teyit olmadan sinyal sayılmaz', () => {
    const h = createHarness();

    h.engine.propose('momentum', 'buy', 'tek strateji oyu', 5);
    const result = h.engine.evaluateNow();

    assert.equal(result.status, 'awaiting-confirmation');
    assert.equal(result.confirmations, 1);
    assert.equal(result.requiredConfirmations, 2);
    assert.equal(h.bot.signals.length, 0);
});

test('aktif BUY kapanmadan güçlü SELL gelse bile ters sinyal üretilmez', () => {
    const h = createHarness();

    h.engine.propose('momentum', 'buy', 'hız yukarı', 3);
    h.engine.propose('orderFlow', 'buy', 'alıcı akışı', 2);
    assert.equal(h.engine.evaluateNow().status, 'generated');
    assert.equal(h.bot.signals[0].direction, 'buy');

    h.advance(20_000);
    h.engine.propose('orderFlow', 'sell', 'satıcı akışı', 5);
    h.engine.propose('divergence', 'sell', 'ayı uyumsuzluğu', 5);
    const result = h.engine.evaluateNow();

    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'active-signal-lock');
    assert.equal(h.bot.signals.length, 1);
});

test('kapanmış sinyalden sonra da ters yön kilidi dolmadan dönüş yapılmaz', () => {
    const h = createHarness();

    h.engine.propose('momentum', 'buy', 'hız yukarı', 3);
    h.engine.propose('orderFlow', 'buy', 'alıcı akışı', 2);
    h.engine.evaluateNow();
    h.bot.signals[0].status = 'sl';

    h.advance(30_000);
    h.engine.propose('orderFlow', 'sell', 'satıcı akışı', 5);
    h.engine.propose('divergence', 'sell', 'ayı uyumsuzluğu', 5);
    const result = h.engine.evaluateNow();

    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'opposite-signal-lock');
    assert.equal(h.bot.signals.length, 1);
});

test('kilit sonrasında ters sinyal için iki bağımsız onay ve daha yüksek skor gerekir', () => {
    const h = createHarness();

    h.engine.propose('momentum', 'buy', 'hız yukarı', 3);
    h.engine.propose('orderFlow', 'buy', 'alıcı akışı', 2);
    h.engine.evaluateNow();
    h.bot.signals[0].status = 'sl';
    h.advance(121_000);

    h.engine.propose('orderFlow', 'sell', 'tek güçlü oy', 10);
    let result = h.engine.evaluateNow();
    assert.equal(result.status, 'awaiting-confirmation');
    assert.equal(result.requiredConfirmations, 2);

    h.engine.propose('orderFlow', 'sell', 'satıcı akışı', 4);
    h.engine.propose('divergence', 'sell', 'ayı uyumsuzluğu', 4);
    result = h.engine.evaluateNow();

    assert.equal(result.status, 'generated');
    assert.equal(result.signal.direction, 'sell');
    assert.equal(result.signal.score, 8);
    assert.equal(result.signal.confirmations, 2);
    assert.equal(result.signal.diagnostics.isReversal, true);
});

test('5-4 gibi çekişmeli skor farkı güçlü sinyal olarak yayınlanmaz', () => {
    const h = createHarness();

    h.engine.propose('momentum', 'buy', 'hız yukarı', 5);
    h.engine.propose('orderFlow', 'sell', 'satıcı akışı', 4);
    const result = h.engine.evaluateNow();

    assert.equal(result.status, 'conflict');
    assert.equal(result.reason, 'insufficient-score-lead');
    assert.equal(h.bot.signals.length, 0);
});

test('önceki sembolün teklifi yeni sembolde skor oluşturmaz', () => {
    const h = createHarness();

    h.engine.propose('momentum', 'buy', 'BTC oyu', 5);
    h.bot.currentSymbol = 'ETHUSDT';
    h.bot.marketData.price = 2_500;
    h.engine.propose('orderFlow', 'sell', 'ETH order flow oyu', 4);
    h.engine.propose('divergence', 'sell', 'ETH divergence oyu', 3);
    const result = h.engine.evaluateNow();

    assert.equal(result.status, 'generated');
    assert.equal(result.signal.symbol, 'ETHUSDT');
    assert.equal(result.signal.direction, 'sell');
    assert.equal(result.signal.score, 7);
});
