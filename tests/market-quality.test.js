const test = require('node:test');
const assert = require('node:assert/strict');
const { MarketQualityEngine } = require('../src/market-quality.js');

function createHarness(overrides = {}) {
    let now = 1_000_000;
    const events = [];
    const settings = {
        enabled: true,
        requireDepth: true,
        maxTradeAgeMs: 3000,
        maxDepthAgeMs: 2000,
        maxTransportLagMs: 2000,
        maxSpreadBps: 8,
        minDepthUsd: 50_000,
        criticalSpreadMultiplier: 2,
        criticalDepthRatio: 0.5,
        shockMoveBps: 40,
        shockWindowMs: 3000,
        shockPauseMs: 120_000,
        ...(overrides.settings || {})
    };
    const bot = {
        currentSymbol: 'BTCUSDT',
        isRunning: true,
        settings: { marketQuality: settings }
    };
    const engine = new MarketQualityEngine(bot, {
        now: () => now,
        emitIntervalMs: 100,
        eventBus: {
            on() { return () => {}; },
            emit(event, payload) { events.push({ event, payload }); }
        }
    });
    engine.running = true;

    return {
        bot,
        engine,
        events,
        now: () => now,
        advance(ms) { now += ms; },
        trade(price, timestamp = now) {
            return engine.observeTrade({ price, timestamp }, now);
        },
        depth({ bid = 100, ask = 100.02, bidQty = 1000, askQty = 1000, timestamp = now } = {}) {
            return engine.observeDepth({
                bids: [[bid, bidQty]],
                asks: [[ask, askQty]]
            }, timestamp, now);
        }
    };
}

test('taze trade ve geçerli derinlik piyasa kalite geçidini açar', () => {
    const h = createHarness();
    h.trade(100);
    const snapshot = h.depth();

    assert.equal(snapshot.status, 'healthy');
    assert.equal(snapshot.blockNewSignals, false);
    assert.equal(snapshot.thresholdPenalty, 0);
    assert.ok(snapshot.spreadBps < 8);
    assert.ok(snapshot.minDepthUsd > 50_000);
});

test('bayat trade veya depth yeni sinyali hard-block eder', () => {
    const h = createHarness();
    h.trade(100);
    h.depth();
    h.advance(3500);

    const snapshot = h.engine.getSnapshot();
    assert.equal(snapshot.status, 'stale');
    assert.equal(snapshot.blockNewSignals, true);
    assert.equal(snapshot.reasons.some(reason => reason.code === 'stale-trade'), true);
    assert.equal(snapshot.reasons.some(reason => reason.code === 'stale-depth'), true);
});

test('uyarı bandındaki spread ve derinlik efektif eşiği yükseltir', () => {
    const h = createHarness();
    h.trade(100);
    const snapshot = h.depth({ bid: 100, ask: 100.1, bidQty: 400, askQty: 400 });

    assert.equal(snapshot.status, 'degraded');
    assert.equal(snapshot.blockNewSignals, false);
    assert.equal(snapshot.thresholdPenalty, 2);
    assert.equal(snapshot.reasons.some(reason => reason.code === 'wide-spread'), true);
    assert.equal(snapshot.reasons.some(reason => reason.code === 'low-depth'), true);
});

test('kritik spread, kritik derinlik ve crossed book sinyal geçidini kapatır', () => {
    const h = createHarness();
    h.trade(100);
    const critical = h.depth({ bid: 100, ask: 100.3, bidQty: 100, askQty: 100 });
    assert.equal(critical.blockNewSignals, true);
    assert.equal(critical.reasons.some(reason => reason.code === 'critical-spread'), true);
    assert.equal(critical.reasons.some(reason => reason.code === 'critical-depth'), true);

    h.advance(10);
    const invalid = h.depth({ bid: 101, ask: 100, bidQty: 1000, askQty: 1000 });
    assert.equal(invalid.status, 'invalid');
    assert.equal(invalid.reasons.some(reason => reason.code === 'invalid-orderbook'), true);
});

test('kısa dönem fiyat şoku kilit üretir ve süre sonunda sağlıklı duruma döner', () => {
    const h = createHarness({ settings: { shockMoveBps: 30, shockPauseMs: 5000 } });
    h.depth();
    h.trade(100);
    h.advance(100);
    h.trade(100.1);
    h.advance(100);
    const shock = h.trade(100.5);

    assert.equal(shock.status, 'shock');
    assert.equal(shock.blockNewSignals, true);
    assert.equal(shock.reasons.some(reason => reason.code === 'price-shock'), true);
    assert.equal(h.events.filter(item => item.event === 'market.quality.shock').length, 1);

    h.advance(5100);
    h.trade(100.5);
    h.depth({ bid: 100.49, ask: 100.51 });
    const recovered = h.engine.getSnapshot();
    assert.equal(recovered.status, 'healthy');
    assert.equal(recovered.blockNewSignals, false);
});

test('transport gecikmesi cihaz saat farkından arındırılarak ayrı engellenir', () => {
    const h = createHarness();
    h.trade(100, h.now());
    h.depth({ timestamp: h.now() });
    h.advance(100);
    h.trade(100, h.now() - 2500);
    h.depth({ timestamp: h.now() - 2500 });

    const snapshot = h.engine.getSnapshot();
    assert.equal(snapshot.status, 'stale');
    assert.equal(snapshot.reasons.some(reason => reason.code === 'trade-transport-lag'), true);
    assert.equal(snapshot.reasons.some(reason => reason.code === 'depth-transport-lag'), true);
});
