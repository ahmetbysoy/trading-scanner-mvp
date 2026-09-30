const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfluenceEngine } = require('../src/confluence-engine.js');

function harness(signalSafety = {}) {
    let now = 1_000_000;
    let timer = null;
    const bot = {
        currentSymbol: 'BTCUSDT',
        currentTimeframe: '15m',
        marketData: { price: 100 },
        indicators: { atr: 2 },
        signals: [],
        strategies: {
            momentumA: { displayName: 'Momentum A' },
            momentumB: { displayName: 'Momentum B' },
            orderFlow: { displayName: 'Order Flow' },
            opposing: { displayName: 'Opposing' }
        },
        settings: {
            confluenceThreshold: 3,
            cooldowns: { signalMs: 0, sameDirectionMs: 0, proposalTimeoutMs: 3000 },
            signalSafety: {
                evaluationDelayMs: 1000,
                minScoreLead: 2,
                minConfirmations: 2,
                minIndependentFamilies: 1,
                maxFamilyContributionRatio: 1,
                preventSignalsWhileActive: true,
                oppositeSignalLockMs: 0,
                minReversalConfirmations: 2,
                reversalScoreMultiplier: 1,
                reverseHysteresisPoints: 0,
                minConvictionWindows: 1,
                minReversalConvictionWindows: 1,
                minConvictionMs: 0,
                minReversalConvictionMs: 0,
                convictionWindowMs: 0,
                convictionAlpha: 0.35,
                reversalAtrInvalidation: 0,
                ...signalSafety
            }
        },
        calculateDynamicTpSl(signal) {
            signal.tp = signal.direction === 'buy' ? signal.price + 2 : signal.price - 2;
            signal.sl = signal.direction === 'buy' ? signal.price - 1 : signal.price + 1;
        },
        addFinalSignal(signal) { this.signals.unshift(signal); },
        logToJournal() {},
        getClosedCandles: () => [{ close: bot.marketData.price }]
    };
    const engine = new ConfluenceEngine(bot, {
        now: () => now,
        setTimeout(callback, delay) { timer = { callback, delay }; return 1; },
        clearTimeout() { timer = null; }
    });
    return {
        bot,
        engine,
        advance(ms) { now += ms; },
        runTimer() {
            const pending = timer;
            timer = null;
            if (!pending) return;
            now += pending.delay;
            pending.callback();
        },
        propose(strategy, direction, score, evidenceFamily) {
            engine.propose(strategy, direction, `${strategy} reason`, score, {
                baseScore: score,
                adaptiveWeight: 1,
                regimeFactor: 1,
                evidenceFamily,
                family: 'micro',
                context: 'BTCUSDT|15m|range:normal'
            });
        }
    };
}

test('aynı aileden iki strateji bağımsız aile teyidi sayılmaz', () => {
    const h = harness({ minIndependentFamilies: 2 });
    h.propose('momentumA', 'buy', 4, 'momentum');
    h.propose('momentumB', 'buy', 3, 'momentum');

    const result = h.engine.evaluateNow();
    assert.equal(result.status, 'awaiting-family-diversity');
    assert.equal(result.families, 1);
    assert.equal(h.bot.signals.length, 0);
});

test('iki farklı strateji ailesi sinyal üretebilir ve aile katkısı sınırlanır', () => {
    const h = harness({ minIndependentFamilies: 2, maxFamilyContributionRatio: 0.6 });
    h.propose('momentumA', 'buy', 8, 'momentum');
    h.propose('momentumB', 'buy', 2, 'momentum');
    h.propose('orderFlow', 'buy', 2, 'microstructure');

    const result = h.engine.evaluateNow();
    assert.equal(result.status, 'generated');
    // Ham skor 12; momentum ailesi 7.2 ile sınırlanır, mikro yapı 2 ekler.
    assert.equal(result.signal.rawScore, 12);
    assert.equal(result.signal.score, 9.2);
    assert.equal(result.signal.diagnostics.independentFamilies, 2);
    assert.equal(result.signal.diagnostics.contributionTotal, 9.2);
    assert.deepEqual(
        result.signal.details.map(detail => detail.contributionScore),
        [5.76, 1.44, 2]
    );
    assert.deepEqual(
        result.signal.details.map(detail => detail.contributionPercent),
        [62.6, 15.7, 21.7]
    );
    assert.equal(result.signal.details[0].familyCapFactor, 0.72);
});

test('conviction sinyalden önce farklı zaman pencerelerinde kalıcılık ister', () => {
    const h = harness({
        minConvictionWindows: 2,
        convictionWindowMs: 1000,
        minConvictionMs: 1000
    });
    h.propose('momentumA', 'buy', 3, 'momentum');
    h.propose('orderFlow', 'buy', 3, 'microstructure');

    let result = h.engine.evaluateNow();
    assert.equal(result.status, 'building-conviction');
    assert.equal(result.windows, 1);

    h.advance(500);
    result = h.engine.evaluateNow();
    assert.equal(result.status, 'building-conviction');
    assert.equal(result.windows, 1, 'aynı zaman penceresi ikinci kez sayılmamalı');

    h.advance(500);
    result = h.engine.evaluateNow();
    assert.equal(result.status, 'generated');
    assert.equal(result.signal.diagnostics.conviction.windows, 2);
});

test('üç pencereli ters conviction teklif zaman aşımından önce tamamlanır', () => {
    const h = harness({
        evaluationDelayMs: 1000,
        minReversalConvictionWindows: 3,
        convictionWindowMs: 700,
        minReversalConvictionMs: 1200
    });
    h.bot.signals.push({
        id: 'previous', timestamp: 100_000, symbol: 'BTCUSDT', direction: 'sell',
        price: 100, closedPrice: 100, score: 5, status: 'sl'
    });
    h.propose('momentumA', 'buy', 4, 'momentum');
    h.propose('orderFlow', 'buy', 4, 'microstructure');

    h.runTimer(); // 1000 ms, pencere 1
    assert.equal(h.bot.signals.length, 1);
    h.runTimer(); // 1700 ms, pencere 2
    assert.equal(h.bot.signals.length, 1);
    h.runTimer(); // 2400 ms, pencere 3 ve üretim
    assert.equal(h.bot.signals.length, 2);
    assert.equal(h.bot.signals[0].direction, 'buy');
});

test('TP sonrası ters sinyal için ATR fiyat geçersizliği aranır', () => {
    const h = harness({ reversalAtrInvalidation: 0.5 });
    h.bot.signals.push({
        id: 'previous', timestamp: 100_000, symbol: 'BTCUSDT', direction: 'buy',
        price: 95, closedPrice: 100, score: 5, status: 'tp'
    });
    h.bot.marketData.price = 100.5;
    h.propose('momentumA', 'sell', 4, 'momentum');
    h.propose('orderFlow', 'sell', 4, 'microstructure');
    let result = h.engine.evaluateNow();
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'reversal-price-not-invalidated');

    h.bot.marketData.price = 98.9; // Referans 100 - 0.5 ATR (ATR=2) altı.
    h.propose('momentumA', 'sell', 4, 'momentum');
    h.propose('orderFlow', 'sell', 4, 'microstructure');
    result = h.engine.evaluateNow();
    assert.equal(result.status, 'generated');
    assert.equal(result.signal.direction, 'sell');
});

test('ters yön ek histerezis puanı zayıf skor farkını engeller', () => {
    const h = harness({ reverseHysteresisPoints: 2 });
    h.bot.signals.push({
        id: 'previous', timestamp: 100_000, symbol: 'BTCUSDT', direction: 'buy',
        price: 100, closedPrice: 100, score: 5, status: 'sl'
    });
    h.propose('momentumA', 'sell', 4, 'momentum');
    h.propose('orderFlow', 'sell', 4, 'microstructure');
    h.propose('opposing', 'buy', 5, 'mean-reversion');

    const result = h.engine.evaluateNow();
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'insufficient-reversal-hysteresis');
});
