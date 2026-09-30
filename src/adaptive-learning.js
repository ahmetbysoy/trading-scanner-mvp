/*
 * Adaptif strateji öğrenme katmanı.
 *
 * - IndexedDB üzerinde kalıcı istatistik
 * - Live + shadow sonuçları için Bayesian/EWMA güvenilirlik
 * - Rejim bağlamlı, sınırlandırılmış strateji ağırlıkları
 * - Mikro-yapı stratejileri için sınırlandırılmış cooldown optimizasyonu
 *
 * Tarayıcıda window.UTCAdaptive, Node testlerinde require(...) olarak çalışır.
 */
(function registerAdaptiveLearning(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.UTCAdaptive = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAdaptiveLearning() {
    'use strict';

    const STATE_KEY = 'adaptive-state-v1';
    const DB_NAME = 'utc-adaptive-learning';
    const DB_VERSION = 1;
    const EPSILON = 1e-8;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const round = (value, digits = 4) => {
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
    };

    class EventBus {
        constructor() {
            this.listeners = new Map();
        }

        on(eventName, handler) {
            if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
            this.listeners.get(eventName).add(handler);
            return () => this.off(eventName, handler);
        }

        off(eventName, handler) {
            const handlers = this.listeners.get(eventName);
            if (!handlers) return;
            handlers.delete(handler);
            if (!handlers.size) this.listeners.delete(eventName);
        }

        emit(eventName, payload) {
            const handlers = this.listeners.get(eventName);
            if (!handlers) return;
            handlers.forEach(handler => {
                try { handler(payload); }
                catch (error) { console.error(`[EventBus:${eventName}]`, error); }
            });
        }
    }

    class LearningStore {
        constructor(options = {}) {
            this.indexedDB = options.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
            this.localStorage = options.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
            this.db = null;
        }

        async init() {
            if (!this.indexedDB) return false;
            this.db = await new Promise((resolve, reject) => {
                const request = this.indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = () => {
                    const database = request.result;
                    if (!database.objectStoreNames.contains('state')) database.createObjectStore('state', { keyPath: 'key' });
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            return true;
        }

        async load() {
            if (this.db) {
                const record = await new Promise((resolve, reject) => {
                    const transaction = this.db.transaction('state', 'readonly');
                    const request = transaction.objectStore('state').get(STATE_KEY);
                    request.onsuccess = () => resolve(request.result || null);
                    request.onerror = () => reject(request.error);
                });
                return record ? record.value : null;
            }
            if (!this.localStorage) return null;
            try {
                const raw = this.localStorage.getItem(STATE_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (error) {
                console.warn('Adaptif öğrenme kaydı okunamadı:', error);
                return null;
            }
        }

        async save(value) {
            if (this.db) {
                await new Promise((resolve, reject) => {
                    const transaction = this.db.transaction('state', 'readwrite');
                    transaction.objectStore('state').put({ key: STATE_KEY, value });
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);
                });
                return;
            }
            if (this.localStorage) this.localStorage.setItem(STATE_KEY, JSON.stringify(value));
        }

        async clear() {
            if (this.db) {
                await new Promise((resolve, reject) => {
                    const transaction = this.db.transaction('state', 'readwrite');
                    transaction.objectStore('state').delete(STATE_KEY);
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);
                });
            }
            if (this.localStorage) this.localStorage.removeItem(STATE_KEY);
        }
    }

    class MarketRegimeDetector {
        constructor(bot) {
            this.bot = bot;
            this.current = 'unknown:normal';
        }

        detect() {
            const candles = typeof this.bot.getClosedCandles === 'function' ? this.bot.getClosedCandles() : [];
            if (candles.length < 50) return this.current;

            const closes = candles.map(candle => Number(candle.close));
            const last20 = closes.slice(-20);
            const previous20 = closes.slice(-40, -20);
            const sma20 = mean(last20);
            const sma50 = mean(closes.slice(-50));
            const previousSma20 = mean(previous20);
            const atr = Number(this.bot.indicators && this.bot.indicators.atr) || 0;
            const price = closes.at(-1) || 1;
            const normalizedSpread = Math.abs(sma20 - sma50) / Math.max(atr, price * 0.0001);
            const slope = (sma20 - previousSma20) / Math.max(atr, price * 0.0001);

            let trend = 'range';
            if (sma20 > sma50 && slope > 0.2 && normalizedSpread > 0.45) trend = 'trend-up';
            else if (sma20 < sma50 && slope < -0.2 && normalizedSpread > 0.45) trend = 'trend-down';

            const atrPercent = atr / Math.max(price, EPSILON);
            let volatility = 'normal';
            if (atrPercent < 0.0025) volatility = 'low-vol';
            else if (atrPercent > 0.012) volatility = 'high-vol';

            this.current = `${trend}:${volatility}`;
            return this.current;
        }
    }

    class AdaptiveLearningEngine {
        constructor(bot, options = {}) {
            this.bot = bot;
            this.eventBus = options.eventBus || new EventBus();
            this.store = options.store || new LearningStore();
            this.now = options.now || (() => Date.now());
            this.saveDelayMs = options.saveDelayMs ?? 500;
            this.saveTimer = null;
            this.regimeDetector = options.regimeDetector || new MarketRegimeDetector(bot);
            this.state = this.createEmptyState();
            this.initialized = false;
            this.currentRegime = 'unknown:normal';
            this.bindEvents();
        }

        createEmptyState() {
            return {
                version: 1,
                mode: 'auto',
                stats: {},
                pairStats: {},
                weights: {},
                cooldowns: {},
                cooldownBases: {},
                strategyFamilies: {},
                shadowTrades: [],
                recentSystemR: [],
                blocked: {},
                globalCooldownMultiplier: 1,
                completedSinceOptimization: 0,
                optimizationCount: 0,
                lastOptimizationAt: null,
                auditLog: []
            };
        }

        async initialize() {
            try {
                await this.store.init();
                const saved = await this.store.load();
                if (saved && saved.version === 1) this.state = this.normalizeState(saved);
            } catch (error) {
                console.warn('IndexedDB açılamadı; öğrenme bellekte devam ediyor:', error);
            }
            this.currentRegime = this.regimeDetector.detect();
            this.initialized = true;
            this.eventBus.emit('learning.ready', this.getSummary());
            return this;
        }

        normalizeState(saved) {
            const empty = this.createEmptyState();
            return {
                ...empty,
                ...saved,
                stats: saved.stats || {},
                pairStats: saved.pairStats || {},
                weights: saved.weights || {},
                cooldowns: saved.cooldowns || {},
                cooldownBases: saved.cooldownBases || {},
                strategyFamilies: saved.strategyFamilies || {},
                shadowTrades: Array.isArray(saved.shadowTrades) ? saved.shadowTrades : [],
                recentSystemR: Array.isArray(saved.recentSystemR) ? saved.recentSystemR.slice(-30) : [],
                blocked: saved.blocked || {},
                auditLog: Array.isArray(saved.auditLog) ? saved.auditLog.slice(-100) : []
            };
        }

        bindEvents() {
            this.eventBus.on('signal.closed', payload => this.recordLiveSignal(payload.signal, payload.price));
            this.eventBus.on('signal.blocked', payload => this.recordBlocked(payload));
            this.eventBus.on('market.regime.check', () => this.refreshRegime());
        }

        getConfig() {
            const configured = (this.bot.settings && this.bot.settings.learning) || {};
            return {
                minSamples: clamp(Number(configured.minSamples) || 20, 5, 500),
                optimizeEvery: clamp(Number(configured.optimizeEvery) || 5, 1, 100),
                minWeight: clamp(Number(configured.minWeight) || 0.65, 0.2, 1),
                maxWeight: clamp(Number(configured.maxWeight) || 1.35, 1, 3),
                shadowEnabled: configured.shadowEnabled !== false,
                shadowInfluence: clamp(Number(configured.shadowInfluence) || 0.35, 0, 1),
                maxShadowTrades: clamp(Number(configured.maxShadowTrades) || 120, 10, 500),
                auditLimit: 100
            };
        }

        setMode(mode) {
            if (!['auto', 'shadow', 'paused'].includes(mode)) return;
            this.state.mode = mode;
            this.addAudit('mode', `Öğrenme modu ${mode} olarak değiştirildi.`);
            this.scheduleSave();
            this.emitUpdate();
        }

        refreshRegime() {
            const previous = this.currentRegime;
            this.currentRegime = this.regimeDetector.detect();
            if (previous !== this.currentRegime) {
                this.eventBus.emit('market.regime.changed', { previous, current: this.currentRegime });
                this.addAudit('regime', `${previous} → ${this.currentRegime}`);
                this.scheduleSave();
                this.emitUpdate();
            }
            return this.currentRegime;
        }

        getContext(symbol = this.bot.currentSymbol, timeframe = this.bot.currentTimeframe) {
            return `${symbol || 'UNKNOWN'}|${timeframe || 'unknown'}|${this.currentRegime}`;
        }

        observeProposal(proposal) {
            this.eventBus.emit('proposal.created', proposal);
            if (this.state.mode === 'paused' || !this.getConfig().shadowEnabled) return null;
            const price = Number(proposal.price);
            if (!Number.isFinite(price) || price <= 0) return null;

            const duplicate = this.state.shadowTrades.find(trade =>
                trade.strategy === proposal.strategy
                && trade.symbol === proposal.symbol
                && trade.direction === proposal.direction
                && trade.status === 'active'
            );
            if (duplicate) return duplicate;

            const risk = this.calculateRisk(price, proposal.score);
            const rr = clamp(Number(this.bot.settings?.params?.rrRatio) || 1.5, 0.1, 20);
            const duration = this.shadowDurationMs(proposal.family);
            const directionFactor = proposal.direction === 'buy' ? 1 : -1;
            const trade = {
                id: `shadow_${this.now()}_${Math.random().toString(36).slice(2, 8)}`,
                strategy: proposal.strategy,
                family: proposal.family,
                symbol: proposal.symbol,
                timeframe: proposal.timeframe,
                context: proposal.context,
                regime: proposal.regime,
                direction: proposal.direction,
                reason: proposal.reason,
                baseScore: proposal.score,
                entry: price,
                risk,
                tp: price + directionFactor * risk * rr,
                sl: price - directionFactor * risk,
                openedAt: this.now(),
                expiresAt: this.now() + duration,
                mfeR: 0,
                maeR: 0,
                status: 'active'
            };
            this.state.shadowTrades.push(trade);
            this.trimShadowTrades();
            this.scheduleSave();
            return trade;
        }

        calculateRisk(price, score) {
            const atr = Number(this.bot.indicators && this.bot.indicators.atr);
            const multiplier = clamp(1.5 - Math.min(Number(score) || 0, 10) * 0.05, 0.75, 1.5);
            return atr > 0 ? atr * multiplier : price * 0.005;
        }

        shadowDurationMs(family) {
            if (family === 'micro') return 15 * 60 * 1000;
            const timeframeMs = this.timeframeToMs(this.bot.currentTimeframe);
            return clamp(timeframeMs * 4, 15 * 60 * 1000, 24 * 60 * 60 * 1000);
        }

        timeframeToMs(timeframe) {
            const match = String(timeframe || '').match(/^(\d+)([mhd])$/);
            if (!match) return 15 * 60 * 1000;
            const value = Number(match[1]);
            const units = { m: 60000, h: 3600000, d: 86400000 };
            return value * units[match[2]];
        }

        onPrice(symbol, price) {
            const numericPrice = Number(price);
            if (!Number.isFinite(numericPrice) || numericPrice <= 0) return;
            const now = this.now();
            let changed = false;

            this.state.shadowTrades.forEach(trade => {
                if (trade.status !== 'active' || trade.symbol !== symbol) return;
                const directionFactor = trade.direction === 'buy' ? 1 : -1;
                const currentR = directionFactor * (numericPrice - trade.entry) / Math.max(trade.risk, EPSILON);
                trade.mfeR = Math.max(trade.mfeR || 0, currentR);
                trade.maeR = Math.min(trade.maeR || 0, currentR);

                const hitTp = trade.direction === 'buy' ? numericPrice >= trade.tp : numericPrice <= trade.tp;
                const hitSl = trade.direction === 'buy' ? numericPrice <= trade.sl : numericPrice >= trade.sl;
                if (hitTp || hitSl || now >= trade.expiresAt) {
                    trade.status = hitTp ? 'tp' : hitSl ? 'sl' : 'expired';
                    trade.closedAt = now;
                    trade.closedPrice = numericPrice;
                    trade.resultR = clamp(currentR, -2, 5);
                    this.recordStrategyResult(trade.strategy, trade.context, trade.resultR, 'shadow', trade.status, {
                        mfeR: trade.mfeR,
                        maeR: trade.maeR,
                        family: trade.family
                    });
                    changed = true;
                }
            });

            if (changed) {
                this.trimShadowTrades();
                this.afterCompletedResult(false);
            }
        }

        recordLiveSignal(signal, closePrice) {
            if (!signal || !Array.isArray(signal.details) || !signal.details.length) return;
            const entry = Number(signal.price);
            const risk = Math.abs(entry - Number(signal.sl));
            const price = Number(closePrice || signal.closedPrice);
            if (!Number.isFinite(entry) || !Number.isFinite(price) || !risk) return;
            const directionFactor = signal.direction === 'buy' ? 1 : -1;
            const resultR = clamp(directionFactor * (price - entry) / risk, -2, 5);
            const uniqueDetails = [...new Map(signal.details.map(detail => [detail.strategy, detail])).values()];

            uniqueDetails.forEach(detail => {
                const context = detail.context || signal.context || this.getContext(signal.symbol, signal.timeframe || this.bot.currentTimeframe);
                this.recordStrategyResult(detail.strategy, context, resultR, 'live', signal.status, {
                    family: detail.family,
                    weightAtEntry: detail.adaptiveWeight,
                    baseScore: detail.baseScore
                });
            });
            this.recordPairResults(uniqueDetails, signal, resultR);
            this.state.recentSystemR.push(resultR);
            this.state.recentSystemR = this.state.recentSystemR.slice(-30);
            this.afterCompletedResult(true);
        }

        recordPairResults(details, signal, resultR) {
            if (details.length < 2) return;
            const strategies = details.map(detail => detail.strategy).filter(Boolean).sort();
            for (let i = 0; i < strategies.length; i += 1) {
                for (let j = i + 1; j < strategies.length; j += 1) {
                    const key = `${strategies[i]}+${strategies[j]}`;
                    if (!this.state.pairStats[key]) this.state.pairStats[key] = this.createMetric();
                    this.updateMetric(this.state.pairStats[key], resultR, 'live', signal.status);
                }
            }
        }

        recordStrategyResult(strategy, context, resultR, source, status, metadata = {}) {
            if (!strategy) return;
            if (!this.state.stats[strategy]) this.state.stats[strategy] = { global: this.createMetric(), contexts: {} };
            const bucket = this.state.stats[strategy];
            if (!bucket.contexts[context]) bucket.contexts[context] = this.createMetric();
            this.updateMetric(bucket.global, resultR, source, status, metadata);
            this.updateMetric(bucket.contexts[context], resultR, source, status, metadata);
            if (metadata.family) this.state.strategyFamilies[strategy] = metadata.family;
            this.eventBus.emit('strategy.result', { strategy, context, resultR, source, status });
        }

        createMetric() {
            return {
                liveCount: 0,
                liveWins: 0,
                liveLosses: 0,
                liveSumR: 0,
                shadowCount: 0,
                shadowWins: 0,
                shadowLosses: 0,
                shadowSumR: 0,
                ewmaR: 0,
                recentR: [],
                lossStreak: 0,
                mfeSum: 0,
                maeSum: 0,
                lastUpdated: null
            };
        }

        updateMetric(metric, resultR, source, status, metadata = {}) {
            const r = Number(resultR);
            if (!Number.isFinite(r)) return;
            const isWin = r > 0;
            const isLoss = r < 0;
            if (source === 'live') {
                metric.liveCount += 1;
                metric.liveWins += isWin ? 1 : 0;
                metric.liveLosses += isLoss ? 1 : 0;
                metric.liveSumR += r;
            } else {
                metric.shadowCount += 1;
                metric.shadowWins += isWin ? 1 : 0;
                metric.shadowLosses += isLoss ? 1 : 0;
                metric.shadowSumR += r;
            }
            const alpha = source === 'live' ? 0.22 : 0.10;
            metric.ewmaR = metric.liveCount + metric.shadowCount === 1 ? r : alpha * r + (1 - alpha) * metric.ewmaR;
            metric.recentR.push({ r: round(r), source, status, at: this.now() });
            metric.recentR = metric.recentR.slice(-30);
            metric.lossStreak = isLoss ? metric.lossStreak + 1 : 0;
            metric.mfeSum += Number(metadata.mfeR) || 0;
            metric.maeSum += Number(metadata.maeR) || 0;
            metric.lastUpdated = this.now();
        }

        afterCompletedResult(isLive) {
            this.state.completedSinceOptimization += 1;
            const config = this.getConfig();
            if (this.state.mode === 'auto' && this.state.completedSinceOptimization >= config.optimizeEvery) {
                this.optimize();
                this.state.completedSinceOptimization = 0;
            }
            if (isLive) this.optimizeGlobalCooldown();
            this.scheduleSave();
            this.emitUpdate();
        }

        optimize() {
            const changes = [];
            Object.entries(this.state.stats).forEach(([strategy, bucket]) => {
                // Global politika yeni sembol/rejim bağlamlarında hiyerarşik geri
                // dönüş olarak kullanılır; yerel veri geldikçe bağlam politikası ağır basar.
                const globalContext = '__global__';
                const globalKey = this.policyKey(strategy, globalContext);
                const oldGlobalWeight = Number(this.state.weights[globalKey]) || 1;
                const globalTarget = this.calculateTargetWeight(bucket.global, bucket.global);
                const newGlobalWeight = round(oldGlobalWeight + (globalTarget - oldGlobalWeight) * 0.15, 3);
                this.state.weights[globalKey] = newGlobalWeight;
                this.optimizeStrategyCooldown(strategy, globalContext, bucket.global, bucket.global, newGlobalWeight);

                Object.entries(bucket.contexts || {}).forEach(([context, localMetric]) => {
                    const key = this.policyKey(strategy, context);
                    const oldWeight = Number(this.state.weights[key]) || newGlobalWeight;
                    const targetWeight = this.calculateTargetWeight(bucket.global, localMetric);
                    const newWeight = round(oldWeight + (targetWeight - oldWeight) * 0.15, 3);
                    this.state.weights[key] = newWeight;
                    if (Math.abs(newWeight - oldWeight) >= 0.005) {
                        changes.push(`${strategy}: ${oldWeight.toFixed(2)}→${newWeight.toFixed(2)}`);
                    }
                    this.optimizeStrategyCooldown(strategy, context, bucket.global, localMetric, newWeight);
                });
            });
            this.state.optimizationCount += 1;
            this.state.lastOptimizationAt = this.now();
            this.addAudit('optimize', changes.length ? changes.slice(0, 8).join(', ') : 'Yeterli örnek yok; ağırlıklar korundu.');
            this.eventBus.emit('optimizer.updated', { changes, summary: this.getSummary() });
        }

        calculateTargetWeight(globalMetric, localMetric) {
            const config = this.getConfig();
            const global = this.metricSummary(globalMetric);
            const local = this.metricSummary(localMetric);
            if (global.effectiveCount < config.minSamples) return 1;

            const localConfidence = local.effectiveCount / (local.effectiveCount + 30);
            const averageR = global.averageR * (1 - localConfidence) + local.averageR * localConfidence;
            const ewmaR = global.ewmaR * (1 - localConfidence) + local.ewmaR * localConfidence;
            const posteriorWin = global.posteriorWin * (1 - localConfidence) + local.posteriorWin * localConfidence;
            const rr = clamp(Number(this.bot.settings?.params?.rrRatio) || 1.5, 0.1, 20);
            const breakEven = 1 / (1 + rr);
            const sampleConfidence = global.effectiveCount / (global.effectiveCount + 30);
            const quality = 0.55 * Math.tanh(averageR)
                + 0.25 * Math.tanh(ewmaR)
                + 0.20 * clamp((posteriorWin - breakEven) * 2, -1, 1);
            return round(clamp(1 + sampleConfidence * quality * 0.65, config.minWeight, config.maxWeight), 3);
        }

        optimizeStrategyCooldown(strategy, context, globalMetric, localMetric, weight) {
            if (this.state.strategyFamilies[strategy] === 'candle') return;
            const key = this.policyKey(strategy, context);
            const base = Number(this.state.cooldownBases[strategy]);
            if (!base && base !== 0) return;
            const metric = this.metricSummary(localMetric.effectiveCount >= 5 ? localMetric : globalMetric);
            let target = Math.max(base, 250);
            target *= 1 + Math.min(metric.lossStreak, 4) * 0.15;
            if (metric.averageR < 0) target *= 1 + Math.min(0.75, Math.abs(metric.averageR) * 0.5);
            if (weight > 1) target *= 1 - Math.min(0.25, (weight - 1) * 0.5);
            else if (weight < 1) target *= 1 + Math.min(0.5, (1 - weight) * 0.8);
            target = clamp(target, Math.max(250, base * 0.75), Math.max(1000, base * 3));
            const current = Number(this.state.cooldowns[key]) || base;
            this.state.cooldowns[key] = Math.round(current + (target - current) * 0.15);
        }

        optimizeGlobalCooldown() {
            const recent = this.state.recentSystemR;
            if (recent.length < 5) return;
            const recentAverage = mean(recent.slice(-10));
            const churn = Number(this.state.blocked['opposite-signal-lock'] || 0)
                + Number(this.state.blocked['active-signal-lock'] || 0);
            let target = 1;
            if (recentAverage < 0) target += Math.min(0.75, Math.abs(recentAverage) * 0.35);
            if (churn > 10) target += Math.min(0.5, churn / 100);
            if (recentAverage > 0.25 && churn < 5) target -= 0.1;
            target = clamp(target, 0.9, 2.5);
            this.state.globalCooldownMultiplier = round(
                this.state.globalCooldownMultiplier + (target - this.state.globalCooldownMultiplier) * 0.1,
                3
            );
        }

        recordBlocked(payload) {
            if (!payload || !payload.reason) return;
            this.state.blocked[payload.reason] = (this.state.blocked[payload.reason] || 0) + 1;
            // Sayaçların sonsuza büyüyüp eski rejimi domine etmesini engelle.
            const total = Object.values(this.state.blocked).reduce((sum, value) => sum + value, 0);
            if (total > 500) {
                Object.keys(this.state.blocked).forEach(key => {
                    this.state.blocked[key] = Math.round(this.state.blocked[key] * 0.5);
                });
            }
            this.scheduleSave();
        }

        metricSummary(metric = this.createMetric()) {
            const influence = this.getConfig().shadowInfluence;
            const effectiveCount = metric.liveCount + metric.shadowCount * influence;
            const effectiveWins = metric.liveWins + metric.shadowWins * influence;
            const sumR = metric.liveSumR + metric.shadowSumR * influence;
            return {
                effectiveCount,
                liveCount: metric.liveCount,
                shadowCount: metric.shadowCount,
                wins: effectiveWins,
                posteriorWin: (5 + effectiveWins) / (10 + effectiveCount),
                averageR: effectiveCount ? sumR / effectiveCount : 0,
                ewmaR: Number(metric.ewmaR) || 0,
                lossStreak: Number(metric.lossStreak) || 0,
                recentAverageR: mean((metric.recentR || []).slice(-10).map(item => item.r))
            };
        }

        getWeight(strategy, context = this.getContext()) {
            if (this.state.mode !== 'auto') return 1;
            const localValue = Number(this.state.weights[this.policyKey(strategy, context)]);
            const globalValue = Number(this.state.weights[this.policyKey(strategy, '__global__')]);
            const value = Number.isFinite(localValue) ? localValue : globalValue;
            if (!Number.isFinite(value)) return 1;
            const config = this.getConfig();
            return clamp(value, config.minWeight, config.maxWeight);
        }

        getStrategyCooldown(strategy, context, baseCooldown, family = 'micro') {
            this.state.strategyFamilies[strategy] = family;
            this.state.cooldownBases[strategy] = Number(baseCooldown) || 0;
            if (family === 'candle' || this.state.mode !== 'auto') return Number(baseCooldown) || 0;
            const localValue = Number(this.state.cooldowns[this.policyKey(strategy, context)]);
            const globalValue = Number(this.state.cooldowns[this.policyKey(strategy, '__global__')]);
            if (Number.isFinite(localValue)) return localValue;
            if (Number.isFinite(globalValue)) return globalValue;
            return Number(baseCooldown) || 0;
        }

        getGlobalCooldown(key, baseCooldown) {
            const base = Number(baseCooldown) || 0;
            if (this.state.mode !== 'auto' || !['signalMs', 'sameDirectionMs'].includes(key)) return base;
            const hardFloor = key === 'signalMs' ? 5000 : 10000;
            return Math.max(hardFloor, Math.round(base * this.state.globalCooldownMultiplier));
        }

        getOppositeLock(baseLock) {
            const base = Number(baseLock) || 0;
            if (this.state.mode !== 'auto') return base;
            // Ters yön koruması optimizer tarafından yalnızca artırılabilir.
            return Math.round(Math.max(base, base * this.state.globalCooldownMultiplier));
        }

        getStrategyRows(activeStrategies = {}) {
            const context = this.getContext();
            return Object.keys(this.bot.strategies || {}).map(strategy => {
                const bucket = this.state.stats[strategy] || { global: this.createMetric(), contexts: {} };
                const local = bucket.contexts[context] || bucket.global;
                const summary = this.metricSummary(local);
                const family = this.state.strategyFamilies[strategy]
                    || this.bot.strategies[strategy]?.family
                    || 'candle';
                const baseCooldown = Number(this.bot.settings?.cooldowns?.strategyProposalMs) || 0;
                return {
                    strategy,
                    displayName: this.bot.strategies[strategy]?.displayName || strategy,
                    active: Boolean(activeStrategies[strategy]),
                    family,
                    liveCount: summary.liveCount,
                    shadowCount: summary.shadowCount,
                    effectiveCount: summary.effectiveCount,
                    winRate: summary.effectiveCount ? summary.posteriorWin : null,
                    averageR: summary.averageR,
                    ewmaR: summary.ewmaR,
                    weight: this.getWeight(strategy, context),
                    cooldown: family === 'candle' ? null : this.getStrategyCooldown(strategy, context, baseCooldown, family),
                    lossStreak: summary.lossStreak
                };
            }).sort((a, b) => b.weight - a.weight || b.effectiveCount - a.effectiveCount);
        }

        getSummary() {
            const rows = this.getStrategyRows(this.bot.activeStrategies || {});
            const totalLive = rows.reduce((sum, row) => sum + row.liveCount, 0);
            const totalShadow = rows.reduce((sum, row) => sum + row.shadowCount, 0);
            const config = this.getConfig();
            return {
                mode: this.state.mode,
                regime: this.currentRegime,
                totalLive,
                totalShadow,
                activeShadowTrades: this.state.shadowTrades.filter(trade => trade.status === 'active').length,
                optimizationCount: this.state.optimizationCount,
                lastOptimizationAt: this.state.lastOptimizationAt,
                globalCooldownMultiplier: this.state.globalCooldownMultiplier,
                warmupRemaining: Math.max(0, config.minSamples - Math.max(0, ...rows.map(row => row.effectiveCount))),
                rows
            };
        }

        exportState() {
            return JSON.stringify({
                exportedAt: new Date(this.now()).toISOString(),
                symbol: this.bot.currentSymbol,
                timeframe: this.bot.currentTimeframe,
                state: this.state
            }, null, 2);
        }

        async reset() {
            this.state = this.createEmptyState();
            this.currentRegime = this.regimeDetector.detect();
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = null;
            await this.store.clear();
            this.eventBus.emit('learning.reset', this.getSummary());
            this.emitUpdate();
        }

        trimShadowTrades() {
            const max = this.getConfig().maxShadowTrades;
            const active = this.state.shadowTrades.filter(trade => trade.status === 'active');
            const closed = this.state.shadowTrades
                .filter(trade => trade.status !== 'active')
                .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
                .slice(0, Math.max(0, max - active.length));
            this.state.shadowTrades = [...active, ...closed].slice(0, max);
        }

        policyKey(strategy, context) {
            return `${strategy}::${context}`;
        }

        addAudit(type, message) {
            this.state.auditLog.unshift({ type, message, timestamp: this.now() });
            this.state.auditLog = this.state.auditLog.slice(0, this.getConfig().auditLimit);
        }

        scheduleSave() {
            if (!this.initialized) return;
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(async () => {
                this.saveTimer = null;
                try { await this.store.save(this.state); }
                catch (error) { console.warn('Öğrenme durumu kaydedilemedi:', error); }
            }, this.saveDelayMs);
        }

        emitUpdate() {
            this.eventBus.emit('learning.updated', this.getSummary());
        }
    }

    return { EventBus, LearningStore, MarketRegimeDetector, AdaptiveLearningEngine };
}));
