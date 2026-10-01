const test = require('node:test');
const assert = require('node:assert/strict');
const {
    EventBus,
    AdaptiveLearningEngine
} = require('../src/adaptive-learning.js');

test('olay omurgası sıralı zarf, wildcard dinleyici ve sınırlı geçmiş sağlar', () => {
    const bus = new EventBus({ historyLimit: 2 });
    const named = [];
    const all = [];
    bus.on('market.trade', payload => named.push(payload.price));
    bus.onAny(envelope => all.push(`${envelope.id}:${envelope.event}`));

    bus.emit('market.trade', { price: 100 });
    bus.emit('market.orderbook', { spread: 0.1 });
    bus.emit('market.trade', { price: 101 });

    assert.deepEqual(named, [100, 101]);
    assert.deepEqual(all, ['1:market.trade', '2:market.orderbook', '3:market.trade']);
    assert.equal(bus.recent().length, 2);
    assert.equal(bus.recent('market.trade', 5).length, 1);
    assert.equal(bus.recent().at(-1).payload.price, 101);
});

test('iç içe yayınlanan olaylar bütün dinleyicilere sıra numarasıyla teslim edilir', () => {
    const bus = new EventBus({ historyLimit: 10 });
    const deliveries = [];
    bus.on('market.trade', () => bus.emit('proposal.created', { strategy: 'velocity' }));
    bus.onAny(envelope => deliveries.push(`${envelope.id}:${envelope.event}`));

    bus.emit('market.trade', { price: 100 });

    assert.deepEqual(deliveries, ['1:market.trade', '2:proposal.created']);
    assert.deepEqual(bus.recent().map(envelope => envelope.id), [1, 2]);
});

class MemoryStore {
    constructor(saved = null) { this.value = saved; }
    async init() { return true; }
    async load() { return this.value; }
    async save(value) { this.value = structuredClone(value); }
    async clear() { this.value = null; }
}

function createHarness(overrides = {}) {
    let now = 1_000_000;
    const candles = Array.from({ length: 60 }, (_, index) => ({
        time: index * 60_000,
        close: 100 + index * 0.2,
        high: 100.5 + index * 0.2,
        low: 99.5 + index * 0.2,
        volume: 1000,
        closed: true
    }));
    const bot = {
        currentSymbol: 'BTCUSDT',
        currentTimeframe: '15m',
        marketData: { price: 112 },
        indicators: { atr: 1, sma20: 110, sma50: 106 },
        signals: [],
        strategies: {
            winner: { displayName: 'Winner', family: 'micro' },
            loser: { displayName: 'Loser', family: 'micro' }
        },
        activeStrategies: { winner: {} },
        settings: {
            params: { rrRatio: 1.5 },
            cooldowns: { strategyProposalMs: 10_000 },
            learning: {
                minSamples: 5,
                optimizeEvery: 5,
                minWeight: 0.65,
                maxWeight: 1.35,
                shadowEnabled: true,
                shadowInfluence: 0.35,
                maxShadowTrades: 120
            }
        },
        getClosedCandles: () => candles
    };
    Object.assign(bot, overrides.bot || {});
    const store = new MemoryStore();
    const eventBus = new EventBus();
    const engine = new AdaptiveLearningEngine(bot, {
        store,
        eventBus,
        now: () => now,
        saveDelayMs: 0
    });
    bot.adaptiveLearning = engine;
    return {
        bot,
        engine,
        eventBus,
        store,
        advance(ms) { now += ms; }
    };
}

test('yeterli örnek oluşmadan strateji ağırlığı nötr kalır', async () => {
    const h = createHarness();
    await h.engine.initialize();
    const context = h.engine.getContext();

    for (let i = 0; i < 4; i += 1) {
        h.engine.recordStrategyResult('winner', context, 1.2, 'live', 'tp', { family: 'micro' });
    }
    h.engine.optimize();

    assert.equal(h.engine.getWeight('winner', context), 1);
});

test('başarılı strateji kontrollü yükselir, başarısız strateji kontrollü düşer', async () => {
    const h = createHarness();
    await h.engine.initialize();
    const context = h.engine.getContext();

    for (let i = 0; i < 30; i += 1) {
        h.engine.recordStrategyResult('winner', context, i % 5 === 0 ? -1 : 1.5, 'live', i % 5 === 0 ? 'sl' : 'tp', { family: 'micro' });
        h.engine.recordStrategyResult('loser', context, i % 5 === 0 ? 1.2 : -1, 'live', i % 5 === 0 ? 'tp' : 'sl', { family: 'micro' });
    }
    for (let i = 0; i < 6; i += 1) h.engine.optimize();

    const winnerWeight = h.engine.getWeight('winner', context);
    const loserWeight = h.engine.getWeight('loser', context);
    assert.ok(winnerWeight > 1, `winner weight was ${winnerWeight}`);
    assert.ok(loserWeight < 1, `loser weight was ${loserWeight}`);
    assert.ok(winnerWeight <= 1.35);
    assert.ok(loserWeight >= 0.65);
});

test('shadow modunda öğrenilmiş ağırlık sinyale uygulanmaz', async () => {
    const h = createHarness();
    await h.engine.initialize();
    const context = h.engine.getContext();
    h.engine.state.weights[`winner::${context}`] = 1.3;

    assert.equal(h.engine.getWeight('winner', context), 1.3);
    h.engine.setMode('shadow');
    assert.equal(h.engine.getWeight('winner', context), 1);
});

test('shadow teklif TP olduğunda strateji istatistiğine kaydedilir', async () => {
    const h = createHarness();
    await h.engine.initialize();
    const context = h.engine.getContext();

    const trade = h.engine.observeProposal({
        strategy: 'winner',
        family: 'micro',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        context,
        regime: h.engine.currentRegime,
        direction: 'buy',
        reason: 'test',
        score: 4,
        price: 100
    });
    assert.ok(trade);
    h.engine.onPrice('BTCUSDT', trade.tp + 0.01);

    const summary = h.engine.metricSummary(h.engine.state.stats.winner.contexts[context]);
    assert.equal(summary.shadowCount, 1);
    assert.ok(summary.averageR > 1);
    assert.equal(h.engine.state.shadowTrades[0].status, 'tp');
});

test('kötü performans mikro strateji cooldown değerini artırır', async () => {
    const h = createHarness();
    await h.engine.initialize();
    const context = h.engine.getContext();
    h.engine.getStrategyCooldown('loser', context, 10_000, 'micro');

    for (let i = 0; i < 25; i += 1) {
        h.engine.recordStrategyResult('loser', context, -1, 'live', 'sl', { family: 'micro' });
    }
    for (let i = 0; i < 5; i += 1) h.engine.optimize();

    assert.ok(h.engine.getStrategyCooldown('loser', context, 10_000, 'micro') > 10_000);
});

test('ters yön kilidi optimizer tarafından temel değerin altına indirilemez', async () => {
    const h = createHarness();
    await h.engine.initialize();
    h.engine.state.globalCooldownMultiplier = 0.9;
    assert.equal(h.engine.getOppositeLock(120_000), 120_000);
    h.engine.state.globalCooldownMultiplier = 1.5;
    assert.equal(h.engine.getOppositeLock(120_000), 180_000);
});

test('ADX rejim güveni momentum ve mean-reversion ailelerini farklı yönlendirir', async () => {
    const h = createHarness();
    await h.engine.initialize();

    assert.ok(h.engine.regimeDetector.adx > 20);
    assert.match(h.engine.currentRegime, /^trend-up:/);
    assert.ok(h.engine.getRegimeFactor('momentum') > 1);
    assert.ok(h.engine.getRegimeFactor('mean-reversion') < 1);

    h.engine.setMode('shadow');
    assert.equal(h.engine.getRegimeFactor('momentum'), 1);
});

test('live sinyal sonucu katkıda bulunan stratejileri ve ikili ortaklığı günceller', async () => {
    const h = createHarness();
    await h.engine.initialize();
    const context = h.engine.getContext();
    const signal = {
        symbol: 'BTCUSDT',
        timeframe: '15m',
        direction: 'buy',
        price: 100,
        sl: 99,
        status: 'tp',
        details: [
            { strategy: 'winner', context, family: 'micro' },
            { strategy: 'loser', context, family: 'micro' }
        ]
    };

    h.engine.recordLiveSignal(signal, 101.5);

    assert.equal(h.engine.state.stats.winner.global.liveCount, 1);
    assert.equal(h.engine.state.stats.loser.global.liveCount, 1);
    assert.equal(h.engine.state.pairStats['loser+winner'].liveCount, 1);
    assert.equal(h.engine.state.recentSystemR[0], 1.5);
});
