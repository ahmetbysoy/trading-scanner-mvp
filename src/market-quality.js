/*
 * Canlı piyasa kalite geçidi.
 *
 * Trade ve depth akışını bağımsız olarak izler; bayat veri, transport gecikmesi,
 * geçersiz order book, aşırı spread, yetersiz derinlik ve kısa dönem fiyat
 * şoklarını tek ve denetlenebilir bir snapshot içinde toplar.
 */
(function registerMarketQuality(root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.UTCMarketQuality = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMarketQuality() {
    'use strict';

    const finite = value => value !== null
        && value !== undefined
        && value !== ''
        && Number.isFinite(Number(value));
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const round = (value, digits = 2) => {
        const factor = 10 ** digits;
        return Math.round((Number(value) || 0) * factor) / factor;
    };

    class MarketQualityEngine {
        constructor(bot, options = {}) {
            if (!bot) throw new Error('MarketQualityEngine için bot zorunludur.');
            this.bot = bot;
            this.eventBus = options.eventBus || bot.eventBus || null;
            this.now = options.now || (() => Date.now());
            this.emitIntervalMs = Math.max(100, Number(options.emitIntervalMs) || 750);
            this.unsubscribers = [];
            this.reset();
            if (this.eventBus) this.bind(this.eventBus);
        }

        bind(eventBus) {
            this.disposeSubscriptions();
            this.eventBus = eventBus;
            this.unsubscribers = [
                eventBus.on('system.started', () => {
                    this.reset();
                    this.running = true;
                    this.publish(true);
                }),
                eventBus.on('system.stopped', () => {
                    this.running = false;
                    this.publish(true);
                }),
                eventBus.on('market.changed', () => {
                    this.reset();
                    this.running = Boolean(this.bot.isRunning);
                    this.publish(true);
                }),
                eventBus.on('market.trade', payload => {
                    if (!payload || payload.symbol !== this.bot.currentSymbol) return;
                    this.observeTrade(payload.trade, payload.receivedAt);
                }),
                eventBus.on('market.orderbook', payload => {
                    if (!payload || payload.symbol !== this.bot.currentSymbol) return;
                    this.observeDepth(payload.orderBook, payload.timestamp, payload.receivedAt);
                }),
                eventBus.on('settings.changed', () => this.publish(true)),
                eventBus.on('feed.connected', payload => {
                    if (payload?.channel === 'market' || payload?.channel === 'depth') {
                        this.disconnectedChannels.delete(payload.channel);
                        this.publish(true);
                    }
                }),
                eventBus.on('feed.disconnected', payload => {
                    if (payload?.channel === 'market' || payload?.channel === 'depth') {
                        this.disconnectedChannels.add(payload.channel);
                        this.publish(true);
                    }
                })
            ];
        }

        disposeSubscriptions() {
            this.unsubscribers.forEach(unsubscribe => {
                try { unsubscribe(); }
                catch (_) { /* no-op */ }
            });
            this.unsubscribers = [];
        }

        dispose() {
            this.disposeSubscriptions();
        }

        reset() {
            this.running = false;
            this.lastTradeAt = 0;
            this.lastDepthAt = 0;
            this.lastTradeEventAt = 0;
            this.lastDepthEventAt = 0;
            this.tradeTransportLagMs = null;
            this.depthTransportLagMs = null;
            this.tradeClockOffsetMs = null;
            this.depthClockOffsetMs = null;
            this.priceSamples = [];
            this.shockUntil = 0;
            this.lastShockAt = 0;
            this.lastShockMoveBps = 0;
            this.depthMetrics = {
                valid: false,
                spreadBps: null,
                bidDepthUsd: 0,
                askDepthUsd: 0,
                minDepthUsd: 0,
                bookImbalance: null,
                bestBid: null,
                bestAsk: null
            };
            this.disconnectedChannels = new Set();
            this.lastPublishedAt = 0;
            this.lastPublishedFingerprint = '';
            this.lastSnapshot = null;
        }

        getConfig() {
            const configured = this.bot.settings?.marketQuality || {};
            return {
                enabled: configured.enabled !== false,
                requireDepth: configured.requireDepth !== false,
                maxTradeAgeMs: clamp(Number(configured.maxTradeAgeMs) || 3000, 500, 60000),
                maxDepthAgeMs: clamp(Number(configured.maxDepthAgeMs) || 2000, 500, 60000),
                maxTransportLagMs: clamp(Number(configured.maxTransportLagMs) || 2000, 250, 30000),
                maxSpreadBps: clamp(Number(configured.maxSpreadBps) || 8, 0.01, 1000),
                minDepthUsd: clamp(Number(configured.minDepthUsd) || 50000, 0, 1e12),
                criticalSpreadMultiplier: clamp(Number(configured.criticalSpreadMultiplier) || 2, 1, 10),
                criticalDepthRatio: clamp(Number(configured.criticalDepthRatio) || 0.5, 0, 1),
                shockMoveBps: clamp(Number(configured.shockMoveBps) || 40, 1, 10000),
                shockWindowMs: clamp(Number(configured.shockWindowMs) || 3000, 250, 60000),
                shockPauseMs: clamp(Number(configured.shockPauseMs) || 120000, 1000, 900000)
            };
        }

        observeTrade(trade, receivedAt = this.now()) {
            const price = Number(trade?.price);
            if (!Number.isFinite(price) || price <= 0) return this.getSnapshot(receivedAt);
            const now = finite(receivedAt) ? Number(receivedAt) : this.now();
            const eventAt = finite(trade?.timestamp) ? Number(trade.timestamp) : now;
            this.running = true;
            this.lastTradeAt = now;
            this.lastTradeEventAt = eventAt;
            const rawTransportLag = now - eventAt;
            this.tradeClockOffsetMs = this.tradeClockOffsetMs === null
                ? rawTransportLag
                : Math.min(this.tradeClockOffsetMs, rawTransportLag);
            this.tradeTransportLagMs = Math.max(0, rawTransportLag - this.tradeClockOffsetMs);
            this.disconnectedChannels.delete('market');

            const config = this.getConfig();
            this.priceSamples.push({ at: now, price });
            const cutoff = now - config.shockWindowMs;
            this.priceSamples = this.priceSamples
                .filter(sample => sample.at >= cutoff)
                .slice(-500);

            if (this.priceSamples.length >= 3) {
                const prices = this.priceSamples.map(sample => sample.price);
                const low = Math.min(...prices);
                const high = Math.max(...prices);
                const middle = (high + low) / 2;
                const moveBps = middle > 0 ? (high - low) / middle * 10000 : 0;
                if (moveBps >= config.shockMoveBps) {
                    const newShock = now >= this.shockUntil;
                    this.lastShockAt = now;
                    this.lastShockMoveBps = moveBps;
                    this.shockUntil = Math.max(this.shockUntil, now + config.shockPauseMs);
                    if (newShock && this.eventBus) {
                        this.eventBus.emit('market.quality.shock', {
                            symbol: this.bot.currentSymbol,
                            moveBps: round(moveBps),
                            pauseUntil: this.shockUntil,
                            timestamp: now
                        });
                    }
                }
            }

            return this.publish();
        }

        observeDepth(orderBook, eventAt = this.now(), receivedAt = this.now()) {
            const now = finite(receivedAt) ? Number(receivedAt) : this.now();
            const exchangeTime = finite(eventAt) ? Number(eventAt) : now;
            const bids = this.validLevels(orderBook?.bids);
            const asks = this.validLevels(orderBook?.asks);
            const bestBid = bids[0]?.[0] ?? null;
            const bestAsk = asks[0]?.[0] ?? null;
            const validBook = bids.length > 0
                && asks.length > 0
                && Number.isFinite(bestBid)
                && Number.isFinite(bestAsk)
                && bestBid > 0
                && bestAsk > bestBid;

            const bidDepthUsd = bids.reduce((sum, [price, quantity]) => sum + price * quantity, 0);
            const askDepthUsd = asks.reduce((sum, [price, quantity]) => sum + price * quantity, 0);
            const totalDepth = bidDepthUsd + askDepthUsd;
            const middle = validBook ? (bestBid + bestAsk) / 2 : null;

            this.running = true;
            this.lastDepthAt = now;
            this.lastDepthEventAt = exchangeTime;
            const rawTransportLag = now - exchangeTime;
            this.depthClockOffsetMs = this.depthClockOffsetMs === null
                ? rawTransportLag
                : Math.min(this.depthClockOffsetMs, rawTransportLag);
            this.depthTransportLagMs = Math.max(0, rawTransportLag - this.depthClockOffsetMs);
            this.disconnectedChannels.delete('depth');
            this.depthMetrics = {
                valid: validBook,
                spreadBps: validBook ? (bestAsk - bestBid) / middle * 10000 : null,
                bidDepthUsd,
                askDepthUsd,
                minDepthUsd: Math.min(bidDepthUsd, askDepthUsd),
                bookImbalance: totalDepth > 0 ? (bidDepthUsd - askDepthUsd) / totalDepth : null,
                bestBid,
                bestAsk
            };

            return this.publish();
        }

        validLevels(levels) {
            if (!Array.isArray(levels)) return [];
            return levels
                .map(level => [Number(level?.[0]), Number(level?.[1])])
                .filter(([price, quantity]) => Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity >= 0);
        }

        tick(now = this.now()) {
            return this.publish(false, now);
        }

        getSnapshot(now = this.now()) {
            const timestamp = finite(now) ? Number(now) : this.now();
            const config = this.getConfig();
            const isRunning = this.running || this.bot.isRunning === true;
            const tradeAgeMs = this.lastTradeAt ? Math.max(0, timestamp - this.lastTradeAt) : null;
            const depthAgeMs = this.lastDepthAt ? Math.max(0, timestamp - this.lastDepthAt) : null;
            const reasons = [];
            let thresholdPenalty = 0;

            const addReason = (code, severity, message) => reasons.push({ code, severity, message });

            if (!config.enabled) {
                return this.buildSnapshot({
                    timestamp,
                    config,
                    status: 'disabled',
                    blockNewSignals: false,
                    thresholdPenalty: 0,
                    reasons,
                    tradeAgeMs,
                    depthAgeMs
                });
            }

            if (!isRunning) {
                return this.buildSnapshot({
                    timestamp,
                    config,
                    status: 'stopped',
                    blockNewSignals: true,
                    thresholdPenalty: 0,
                    reasons: [{ code: 'system-stopped', severity: 'block', message: 'Sistem durduruldu.' }],
                    tradeAgeMs,
                    depthAgeMs
                });
            }

            if (this.disconnectedChannels.has('market')) {
                addReason('market-disconnected', 'block', 'Piyasa WebSocket bağlantısı kapalı.');
            }
            if (config.requireDepth && this.disconnectedChannels.has('depth')) {
                addReason('depth-disconnected', 'block', 'Depth WebSocket bağlantısı kapalı.');
            }
            if (!this.lastTradeAt) {
                addReason('missing-trade', 'block', 'Henüz trade verisi alınmadı.');
            } else if (tradeAgeMs > config.maxTradeAgeMs) {
                addReason('stale-trade', 'block', `Trade verisi ${Math.round(tradeAgeMs)} ms bayat.`);
            }
            if (this.tradeTransportLagMs !== null && this.tradeTransportLagMs > config.maxTransportLagMs) {
                addReason('trade-transport-lag', 'block', `Trade transport gecikmesi ${Math.round(this.tradeTransportLagMs)} ms.`);
            }

            if (config.requireDepth) {
                if (!this.lastDepthAt) {
                    addReason('missing-depth', 'block', 'Henüz depth verisi alınmadı.');
                } else if (depthAgeMs > config.maxDepthAgeMs) {
                    addReason('stale-depth', 'block', `Depth verisi ${Math.round(depthAgeMs)} ms bayat.`);
                }
                if (this.depthTransportLagMs !== null && this.depthTransportLagMs > config.maxTransportLagMs) {
                    addReason('depth-transport-lag', 'block', `Depth transport gecikmesi ${Math.round(this.depthTransportLagMs)} ms.`);
                }
                if (this.lastDepthAt && !this.depthMetrics.valid) {
                    addReason('invalid-orderbook', 'block', 'Order book boş, crossed veya geçersiz.');
                }
            }

            if (timestamp < this.shockUntil) {
                addReason(
                    'price-shock',
                    'block',
                    `Kısa dönem fiyat şoku: ${round(this.lastShockMoveBps)} bp.`
                );
            }

            if (this.depthMetrics.valid) {
                const spread = this.depthMetrics.spreadBps;
                const depth = this.depthMetrics.minDepthUsd;
                if (spread > config.maxSpreadBps * config.criticalSpreadMultiplier) {
                    addReason('critical-spread', 'block', `Spread kritik seviyede: ${round(spread)} bp.`);
                } else if (spread > config.maxSpreadBps) {
                    thresholdPenalty += 1;
                    addReason('wide-spread', 'warning', `Spread yüksek: ${round(spread)} bp.`);
                }

                if (config.minDepthUsd > 0 && depth < config.minDepthUsd * config.criticalDepthRatio) {
                    addReason('critical-depth', 'block', `Minimum taraf derinliği yetersiz: ${Math.round(depth)} USD.`);
                } else if (config.minDepthUsd > 0 && depth < config.minDepthUsd) {
                    thresholdPenalty += 1;
                    addReason('low-depth', 'warning', `Minimum taraf derinliği düşük: ${Math.round(depth)} USD.`);
                }
            }

            thresholdPenalty = Math.min(2, thresholdPenalty);
            const blockingReasons = reasons.filter(reason => reason.severity === 'block');
            const blockNewSignals = blockingReasons.length > 0;
            let status = 'healthy';
            if (reasons.some(reason => reason.code === 'price-shock')) status = 'shock';
            else if (!this.lastTradeAt && (!config.requireDepth || !this.lastDepthAt)) status = 'waiting';
            else if (blockingReasons.length > 0) {
                status = blockingReasons.some(reason => reason.code.startsWith('stale-') || reason.code.includes('lag') || reason.code.includes('disconnected') || reason.code.startsWith('missing-'))
                    ? 'stale'
                    : 'invalid';
            } else if (reasons.length > 0) status = 'degraded';

            return this.buildSnapshot({
                timestamp,
                config,
                status,
                blockNewSignals,
                thresholdPenalty,
                reasons,
                tradeAgeMs,
                depthAgeMs
            });
        }

        buildSnapshot({ timestamp, config, status, blockNewSignals, thresholdPenalty, reasons, tradeAgeMs, depthAgeMs }) {
            const qualityScore = status === 'healthy' || status === 'disabled'
                ? 100
                : status === 'degraded'
                    ? Math.max(60, 90 - thresholdPenalty * 15)
                    : 0;
            return {
                symbol: this.bot.currentSymbol || null,
                enabled: config.enabled,
                status,
                tradable: !blockNewSignals,
                blockNewSignals,
                thresholdPenalty,
                qualityScore,
                reasons,
                primaryReason: reasons[0] || null,
                tradeAgeMs,
                depthAgeMs,
                tradeTransportLagMs: this.tradeTransportLagMs,
                depthTransportLagMs: this.depthTransportLagMs,
                shockUntil: this.shockUntil,
                shockMoveBps: round(this.lastShockMoveBps),
                spreadBps: finite(this.depthMetrics.spreadBps) ? round(this.depthMetrics.spreadBps, 3) : null,
                bidDepthUsd: round(this.depthMetrics.bidDepthUsd),
                askDepthUsd: round(this.depthMetrics.askDepthUsd),
                minDepthUsd: round(this.depthMetrics.minDepthUsd),
                bookImbalance: finite(this.depthMetrics.bookImbalance) ? round(this.depthMetrics.bookImbalance, 4) : null,
                bestBid: this.depthMetrics.bestBid,
                bestAsk: this.depthMetrics.bestAsk,
                timestamp
            };
        }

        publish(force = false, now = this.now()) {
            const snapshot = this.getSnapshot(now);
            this.lastSnapshot = snapshot;
            if (!this.eventBus) return snapshot;

            const fingerprint = JSON.stringify({
                status: snapshot.status,
                penalty: snapshot.thresholdPenalty,
                reasons: snapshot.reasons.map(reason => reason.code)
            });
            const changed = fingerprint !== this.lastPublishedFingerprint;
            if (force || changed || snapshot.timestamp - this.lastPublishedAt >= this.emitIntervalMs) {
                this.lastPublishedAt = snapshot.timestamp;
                this.lastPublishedFingerprint = fingerprint;
                this.eventBus.emit('market.quality.updated', snapshot);
            }
            return snapshot;
        }
    }

    return { MarketQualityEngine };
}));
