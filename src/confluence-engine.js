/*
 * Güvenli sinyal uzlaştırma motoru.
 *
 * Hem doğrudan tarayıcıda (window.ConfluenceEngine) hem de Node testlerinde
 * (require(...).ConfluenceEngine) kullanılabilir.
 */
(function registerConfluenceEngine(root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.ConfluenceEngine = api.ConfluenceEngine;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createConfluenceEngine() {
    'use strict';

    const VALID_DIRECTIONS = new Set(['buy', 'sell']);

    class ConfluenceEngine {
        constructor(bot, runtime = {}) {
            if (!bot) throw new Error('ConfluenceEngine için bot zorunludur.');

            this.bot = bot;
            this.proposals = [];
            this.lastSignalTime = 0;
            this.lastSignalTimeByDirection = { buy: 0, sell: 0 };

            this._now = runtime.now || (() => Date.now());
            this._setTimeout = runtime.setTimeout || ((fn, delay) => setTimeout(fn, delay));
            this._clearTimeout = runtime.clearTimeout || (timer => clearTimeout(timer));
            this._evaluationTimer = null;
            this._signalSequence = 0;
            this._lastBlockedNotice = new Map();
            this._convictionBySymbol = new Map();
        }

        propose(strategy, direction, reason, score, metadata = {}) {
            const symbol = this.bot.currentSymbol;
            const numericScore = Number(score);

            if (!symbol || !strategy || !VALID_DIRECTIONS.has(direction)) return false;
            if (!Number.isFinite(numericScore) || numericScore <= 0) return false;

            const now = this._now();

            // Bir strateji aynı anda hem BUY hem SELL oyu taşıyamaz. Yön değiştiyse
            // önceki oyu silinir. Sembol de kayda alınarak sembol değişiminde eski
            // tekliflerin yeni markete sızması engellenir.
            this.proposals = this.proposals.filter(proposal => !(
                proposal.symbol === symbol && proposal.strategy === strategy
            ));

            this.proposals.push({
                symbol,
                strategy,
                direction,
                reason,
                score: numericScore,
                baseScore: Number(metadata.baseScore) || numericScore,
                adaptiveWeight: Number(metadata.adaptiveWeight) || 1,
                regimeFactor: Number(metadata.regimeFactor) || 1,
                context: metadata.context || null,
                regime: metadata.regime || null,
                family: metadata.family || null,
                evidenceFamily: metadata.evidenceFamily || 'other',
                timeframe: metadata.timeframe || this.bot.currentTimeframe || null,
                timestamp: now
            });

            this._pruneExpired(now);
            this._scheduleEvaluation();
            return true;
        }

        _scheduleEvaluation(delayOverride = null) {
            if (this._evaluationTimer !== null) return;

            const configuredDelay = this._getSafetySettings().evaluationDelayMs;
            const delay = delayOverride === null ? configuredDelay : Math.max(0, Number(delayOverride) || 0);
            this._evaluationTimer = this._setTimeout(() => {
                this._evaluationTimer = null;
                this.checkConfluence();
            }, delay);
        }

        /**
         * Test, teşhis veya kontrollü kullanım için bekleyen pencereyi hemen
         * değerlendirir. Normal akışta propose() kısa toplama penceresini başlatır.
         */
        evaluateNow() {
            if (this._evaluationTimer !== null) {
                this._clearTimeout(this._evaluationTimer);
                this._evaluationTimer = null;
            }
            return this.checkConfluence();
        }

        checkConfluence() {
            const now = this._now();
            const symbol = this.bot.currentSymbol;
            this._pruneExpired(now);

            const proposals = this.proposals.filter(proposal => proposal.symbol === symbol);
            if (proposals.length === 0) {
                this._resetConviction(symbol);
                return { status: 'empty' };
            }

            const safety = this._getSafetySettings();
            const buyProposals = proposals.filter(proposal => proposal.direction === 'buy');
            const sellProposals = proposals.filter(proposal => proposal.direction === 'sell');
            const buyBreakdown = this._scoreDirection(buyProposals, safety.maxFamilyContributionRatio);
            const sellBreakdown = this._scoreDirection(sellProposals, safety.maxFamilyContributionRatio);
            const buyScore = buyBreakdown.cappedScore;
            const sellScore = sellBreakdown.cappedScore;
            const threshold = this._getThreshold();

            if (Math.abs(buyScore - sellScore) < 1e-9) {
                this._resetConviction(symbol);
                return { status: 'conflict', buyScore, sellScore, reason: 'equal-score' };
            }

            const direction = buyScore > sellScore ? 'buy' : 'sell';
            const candidateScore = direction === 'buy' ? buyScore : sellScore;
            const opposingScore = direction === 'buy' ? sellScore : buyScore;
            const candidateProposals = direction === 'buy' ? buyProposals : sellProposals;
            const opposingProposals = direction === 'buy' ? sellProposals : buyProposals;
            const candidateBreakdown = direction === 'buy' ? buyBreakdown : sellBreakdown;
            const opposingBreakdown = direction === 'buy' ? sellBreakdown : buyBreakdown;
            const scoreLead = candidateScore - opposingScore;

            if (candidateScore < threshold) {
                this._resetConviction(symbol);
                return { status: 'below-threshold', direction, score: candidateScore, threshold };
            }

            // BUY 5 / SELL 4 gibi çatışmalı bir tabloyu "güçlü 5" diye yayınlama.
            if (scoreLead < safety.minScoreLead) {
                this._resetConviction(symbol);
                return {
                    status: 'conflict',
                    direction,
                    buyScore,
                    sellScore,
                    reason: 'insufficient-score-lead'
                };
            }

            const confirmationCount = this._uniqueStrategyCount(candidateProposals);
            if (confirmationCount < safety.minConfirmations) {
                return {
                    status: 'awaiting-confirmation',
                    direction,
                    score: candidateScore,
                    confirmations: confirmationCount,
                    requiredConfirmations: safety.minConfirmations
                };
            }

            const independentFamilies = this._uniqueFamilyCount(candidateProposals);
            if (independentFamilies < safety.minIndependentFamilies) {
                return {
                    status: 'awaiting-family-diversity',
                    direction,
                    score: candidateScore,
                    families: independentFamilies,
                    requiredFamilies: safety.minIndependentFamilies
                };
            }

            const price = Number(this.bot.marketData && this.bot.marketData.price);
            if (!Number.isFinite(price) || price <= 0) {
                return this._block(symbol, direction, 'Fiyat oluşmadan sinyal üretimi engellendi.', now, 'missing-price');
            }

            const activeSignal = this._findActiveSignal(symbol);
            if (safety.preventSignalsWhileActive && activeSignal) {
                const message = activeSignal.direction === direction
                    ? `Aktif ${direction.toUpperCase()} sinyali varken yinelenen sinyal engellendi.`
                    : `Aktif ${activeSignal.direction.toUpperCase()} sinyali kapanmadan ters ${direction.toUpperCase()} sinyali engellendi.`;
                return this._block(symbol, direction, message, now, 'active-signal-lock');
            }

            const latestSignal = this._findLatestSignal(symbol);
            if (latestSignal && now - latestSignal.timestamp < this._getCooldown('signalMs', 15000)) {
                return this._block(symbol, direction, 'Genel sinyal cooldown süresi devam ediyor.', now, 'signal-cooldown');
            }

            const latestSameDirection = this._findLatestSignal(symbol, direction);
            if (latestSameDirection && now - latestSameDirection.timestamp < this._getCooldown('sameDirectionMs', 30000)) {
                return this._block(symbol, direction, 'Aynı yön sinyal cooldown süresi devam ediyor.', now, 'same-direction-cooldown');
            }

            const isReversal = Boolean(latestSignal && latestSignal.direction !== direction);
            if (isReversal) {
                const reversalAge = now - latestSignal.timestamp;
                if (reversalAge < safety.oppositeSignalLockMs) {
                    return this._block(
                        symbol,
                        direction,
                        `Ters yön kilidi devam ediyor (${Math.ceil((safety.oppositeSignalLockMs - reversalAge) / 1000)} sn).`,
                        now,
                        'opposite-signal-lock'
                    );
                }

                if (confirmationCount < safety.minReversalConfirmations) {
                    return this._block(
                        symbol,
                        direction,
                        `Ters sinyal için en az ${safety.minReversalConfirmations} bağımsız strateji gerekiyor.`,
                        now,
                        'insufficient-reversal-confirmations'
                    );
                }

                const requiredReverseLead = safety.minScoreLead + safety.reverseHysteresisPoints;
                if (scoreLead < requiredReverseLead) {
                    return this._block(
                        symbol,
                        direction,
                        `Ters sinyal skor farkı yetersiz (${scoreLead.toFixed(2)}/${requiredReverseLead}).`,
                        now,
                        'insufficient-reversal-hysteresis'
                    );
                }

                const previousScore = Number(latestSignal.score) || 0;
                const requiredReversalScore = Math.max(
                    threshold,
                    Math.ceil(previousScore * safety.reversalScoreMultiplier)
                );

                if (candidateScore < requiredReversalScore) {
                    return this._block(
                        symbol,
                        direction,
                        `Ters sinyal skoru yetersiz (${candidateScore.toFixed(2)}/${requiredReversalScore}).`,
                        now,
                        'insufficient-reversal-score'
                    );
                }

                if (!this._isReversalPriceInvalidated(latestSignal, direction, price, safety)) {
                    return this._block(
                        symbol,
                        direction,
                        `Önceki ${latestSignal.direction.toUpperCase()} tezi ATR/mum kapanışıyla geçersiz olmadı.`,
                        now,
                        'reversal-price-not-invalidated'
                    );
                }
            }

            const conviction = this._updateConviction(
                symbol,
                direction,
                buyScore - sellScore,
                now,
                isReversal,
                safety
            );
            if (!conviction.ready) {
                this._scheduleEvaluation(Math.max(50, safety.convictionWindowMs));
                return {
                    status: 'building-conviction',
                    direction,
                    score: candidateScore,
                    windows: conviction.windows,
                    requiredWindows: conviction.requiredWindows,
                    elapsedMs: conviction.elapsedMs,
                    requiredMs: conviction.requiredMs,
                    smoothedPressure: conviction.smoothedPressure
                };
            }

            return this.generateFinalSignal(direction, candidateProposals, {
                buyScore,
                sellScore,
                rawBuyScore: buyBreakdown.rawScore,
                rawSellScore: sellBreakdown.rawScore,
                candidateScore,
                opposingScore,
                scoreLead,
                isReversal,
                independentFamilies,
                familyScores: candidateBreakdown.familyScores,
                opposingFamilyScores: opposingBreakdown.familyScores,
                opposingDetails: opposingProposals.map(proposal => this._proposalDiagnostic(proposal)),
                conviction: {
                    windows: conviction.windows,
                    elapsedMs: conviction.elapsedMs,
                    smoothedPressure: conviction.smoothedPressure
                }
            });
        }

        generateFinalSignal(direction, proposals, diagnostics = {}) {
            const now = this._now();
            const rawScore = this._sumScores(proposals);
            const totalScore = Number(diagnostics.candidateScore) || rawScore;
            const strategyNames = proposals.map(proposal => {
                const strategy = this.bot.strategies && this.bot.strategies[proposal.strategy];
                return strategy && strategy.displayName ? strategy.displayName : proposal.strategy;
            });
            const uniqueStrategyNames = [...new Set(strategyNames)];

            const signal = {
                id: `sig_${now}_${++this._signalSequence}`,
                timestamp: now,
                symbol: this.bot.currentSymbol,
                timeframe: this.bot.currentTimeframe || proposals[0]?.timeframe || null,
                context: proposals[0]?.context || null,
                regime: proposals[0]?.regime || null,
                direction,
                price: Number(this.bot.marketData.price),
                score: Math.round(totalScore * 100) / 100,
                rawScore: Math.round(rawScore * 100) / 100,
                confirmations: uniqueStrategyNames.length,
                reason: uniqueStrategyNames.join(', '),
                details: proposals.map(proposal => ({
                    strategy: proposal.strategy,
                    reason: proposal.reason,
                    score: proposal.score,
                    baseScore: proposal.baseScore,
                    adaptiveWeight: proposal.adaptiveWeight,
                    regimeFactor: proposal.regimeFactor,
                    context: proposal.context,
                    regime: proposal.regime,
                    family: proposal.family,
                    evidenceFamily: proposal.evidenceFamily
                })),
                diagnostics,
                status: 'active',
                note: ''
            };

            this.bot.calculateDynamicTpSl(signal);
            this.bot.addFinalSignal(signal);

            // Sinyal sonrasında iki yöndeki tüm teklifler temizlenir. Böylece önceki
            // karar penceresinden kalan karşıt oy bir sonraki sinyali tetiklemez.
            this.clearProposals(signal.symbol);
            this._resetConviction(signal.symbol);
            this.lastSignalTime = now;
            this.lastSignalTimeByDirection[direction] = now;

            return { status: 'generated', signal };
        }

        clearProposals(symbol = null) {
            if (symbol) {
                this.proposals = this.proposals.filter(proposal => proposal.symbol !== symbol);
            } else {
                this.proposals = [];
            }
        }

        reset(symbol = null) {
            if (this._evaluationTimer !== null) {
                this._clearTimeout(this._evaluationTimer);
                this._evaluationTimer = null;
            }
            this.clearProposals(symbol);
            if (symbol) this._resetConviction(symbol);
            else this._convictionBySymbol.clear();
            this._lastBlockedNotice.clear();
        }

        dispose() {
            this.reset();
        }

        _pruneExpired(now) {
            const timeout = this._getCooldown('proposalTimeoutMs', 3000);
            this.proposals = this.proposals.filter(proposal => now - proposal.timestamp < timeout);
        }

        _sumScores(proposals) {
            return proposals.reduce((sum, proposal) => sum + proposal.score, 0);
        }

        _uniqueStrategyCount(proposals) {
            return new Set(proposals.map(proposal => proposal.strategy)).size;
        }

        _uniqueFamilyCount(proposals) {
            return new Set(proposals.map(proposal => proposal.evidenceFamily || 'other')).size;
        }

        _scoreDirection(proposals, maxFamilyRatio) {
            const rawScore = this._sumScores(proposals);
            const familyScores = proposals.reduce((scores, proposal) => {
                const family = proposal.evidenceFamily || 'other';
                scores[family] = (scores[family] || 0) + proposal.score;
                return scores;
            }, {});
            if (!rawScore) return { rawScore: 0, cappedScore: 0, familyScores };

            const ratio = Math.min(1, Math.max(0.25, Number(maxFamilyRatio) || 1));
            const cap = rawScore * ratio;
            const cappedScore = Object.values(familyScores)
                .reduce((sum, familyScore) => sum + Math.min(familyScore, cap), 0);
            return {
                rawScore: Math.round(rawScore * 100) / 100,
                cappedScore: Math.round(cappedScore * 100) / 100,
                familyScores
            };
        }

        _proposalDiagnostic(proposal) {
            return {
                strategy: proposal.strategy,
                direction: proposal.direction,
                reason: proposal.reason,
                score: proposal.score,
                baseScore: proposal.baseScore,
                adaptiveWeight: proposal.adaptiveWeight,
                regimeFactor: proposal.regimeFactor,
                evidenceFamily: proposal.evidenceFamily
            };
        }

        _updateConviction(symbol, direction, pressure, now, isReversal, safety) {
            const previous = this._convictionBySymbol.get(symbol);
            const alpha = Math.min(1, Math.max(0.05, safety.convictionAlpha));
            const smoothedPressure = previous
                ? alpha * pressure + (1 - alpha) * previous.smoothedPressure
                : pressure;
            const requiredPressure = safety.minScoreLead + (isReversal ? safety.reverseHysteresisPoints : 0);
            const supportsDirection = direction === 'buy'
                ? smoothedPressure >= requiredPressure
                : smoothedPressure <= -requiredPressure;

            let state;
            if (!previous || previous.direction !== direction || !supportsDirection) {
                state = {
                    direction,
                    windows: supportsDirection ? 1 : 0,
                    firstSeen: now,
                    lastWindowAt: now,
                    smoothedPressure
                };
            } else {
                const canCountWindow = now - previous.lastWindowAt >= safety.convictionWindowMs;
                state = {
                    ...previous,
                    windows: previous.windows + (canCountWindow ? 1 : 0),
                    lastWindowAt: canCountWindow ? now : previous.lastWindowAt,
                    smoothedPressure
                };
            }
            this._convictionBySymbol.set(symbol, state);

            const requiredWindows = isReversal
                ? safety.minReversalConvictionWindows
                : safety.minConvictionWindows;
            const requiredMs = isReversal
                ? safety.minReversalConvictionMs
                : safety.minConvictionMs;
            const elapsedMs = now - state.firstSeen;
            return {
                ...state,
                elapsedMs,
                requiredWindows,
                requiredMs,
                ready: supportsDirection && state.windows >= requiredWindows && elapsedMs >= requiredMs
            };
        }

        _resetConviction(symbol) {
            if (symbol) this._convictionBySymbol.delete(symbol);
        }

        _isReversalPriceInvalidated(latestSignal, newDirection, currentPrice, safety) {
            if (!latestSignal || latestSignal.status === 'sl') return true;
            if (safety.reversalAtrInvalidation <= 0) return true;

            const atr = Number(this.bot.indicators && this.bot.indicators.atr);
            const distance = (Number.isFinite(atr) && atr > 0 ? atr : currentPrice * 0.003)
                * safety.reversalAtrInvalidation;
            const referenceCandidate = Number(latestSignal.closedPrice);
            const reference = Number.isFinite(referenceCandidate) && referenceCandidate > 0
                ? referenceCandidate
                : Number(latestSignal.price);
            if (!Number.isFinite(reference) || reference <= 0) return false;

            let observedPrice = currentPrice;
            if (safety.requireClosedCandleForReversal && typeof this.bot.getClosedCandles === 'function') {
                const close = Number(this.bot.getClosedCandles().at(-1)?.close);
                if (!Number.isFinite(close)) return false;
                observedPrice = close;
            }

            if (latestSignal.direction === 'buy' && newDirection === 'sell') {
                return observedPrice <= reference - distance;
            }
            if (latestSignal.direction === 'sell' && newDirection === 'buy') {
                return observedPrice >= reference + distance;
            }
            return true;
        }

        _getThreshold() {
            const threshold = Number(this.bot.settings && this.bot.settings.confluenceThreshold);
            return Number.isFinite(threshold) && threshold > 0 ? threshold : 3;
        }

        _getCooldown(key, fallback) {
            const value = Number(this.bot.settings && this.bot.settings.cooldowns && this.bot.settings.cooldowns[key]);
            const configured = Number.isFinite(value) && value >= 0 ? value : fallback;
            if (
                this.bot.adaptiveLearning
                && typeof this.bot.adaptiveLearning.getGlobalCooldown === 'function'
                && (key === 'signalMs' || key === 'sameDirectionMs')
            ) {
                return this.bot.adaptiveLearning.getGlobalCooldown(key, configured);
            }
            return configured;
        }

        _getSafetySettings() {
            const configured = (this.bot.settings && this.bot.settings.signalSafety) || {};
            const baseOppositeLock = this._nonNegative(configured.oppositeSignalLockMs, 120000);
            const oppositeSignalLockMs = this.bot.adaptiveLearning
                && typeof this.bot.adaptiveLearning.getOppositeLock === 'function'
                ? this.bot.adaptiveLearning.getOppositeLock(baseOppositeLock)
                : baseOppositeLock;
            return {
                // İlk oy gelir gelmez karar vermek yerine diğer stratejilere kısa bir
                // süre tanınır. Bu, sıra bağımlı "ilk gelen kazanır" hatasını giderir.
                evaluationDelayMs: this._nonNegative(configured.evaluationDelayMs, 1000),
                minScoreLead: this._nonNegative(configured.minScoreLead, 2),
                // "Confluence" gerçekten en az iki bağımsız kaynaktan gelsin.
                // Böylece tek bir stratejinin ağırlığı olan 5, yanlışlıkla beş ayrı
                // teyit gibi sunulmaz.
                minConfirmations: Math.max(1, Math.floor(this._nonNegative(configured.minConfirmations, 2))),
                minIndependentFamilies: Math.max(1, Math.floor(this._nonNegative(configured.minIndependentFamilies, 1))),
                maxFamilyContributionRatio: Math.min(1, Math.max(0.25, this._nonNegative(configured.maxFamilyContributionRatio, 1))),
                preventSignalsWhileActive: configured.preventSignalsWhileActive !== false,
                oppositeSignalLockMs,
                minReversalConfirmations: Math.max(1, Math.floor(this._nonNegative(configured.minReversalConfirmations, 2))),
                reversalScoreMultiplier: Math.max(1, this._nonNegative(configured.reversalScoreMultiplier, 1.25)),
                reverseHysteresisPoints: this._nonNegative(configured.reverseHysteresisPoints, 0),
                minConvictionWindows: Math.max(1, Math.floor(this._nonNegative(configured.minConvictionWindows, 1))),
                minReversalConvictionWindows: Math.max(1, Math.floor(this._nonNegative(configured.minReversalConvictionWindows, 1))),
                minConvictionMs: this._nonNegative(configured.minConvictionMs, 0),
                minReversalConvictionMs: this._nonNegative(configured.minReversalConvictionMs, 0),
                convictionWindowMs: this._nonNegative(configured.convictionWindowMs, 0),
                convictionAlpha: Math.min(1, Math.max(0.05, this._nonNegative(configured.convictionAlpha, 0.35))),
                reversalAtrInvalidation: this._nonNegative(configured.reversalAtrInvalidation, 0),
                requireClosedCandleForReversal: configured.requireClosedCandleForReversal === true,
                blockedNoticeThrottleMs: this._nonNegative(configured.blockedNoticeThrottleMs, 10000)
            };
        }

        _nonNegative(value, fallback) {
            const numeric = Number(value);
            return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
        }

        _findActiveSignal(symbol) {
            const signals = Array.isArray(this.bot.signals) ? this.bot.signals : [];
            return signals.find(signal => signal.symbol === symbol && signal.status === 'active') || null;
        }

        _findLatestSignal(symbol, direction = null) {
            const signals = Array.isArray(this.bot.signals) ? this.bot.signals : [];
            return signals
                .filter(signal => signal.symbol === symbol && (!direction || signal.direction === direction))
                .reduce((latest, signal) => {
                    if (!latest) return signal;
                    return Number(signal.timestamp) > Number(latest.timestamp) ? signal : latest;
                }, null);
        }

        _block(symbol, direction, message, now, reason) {
            // Engellenen teklifleri tüket. Aktif işlem kapanınca birkaç saniye önceki
            // bayat karşıt teklifin aniden sinyale dönüşmesini istemiyoruz.
            this.clearProposals(symbol);
            this._resetConviction(symbol);
            if (this.bot.eventBus && typeof this.bot.eventBus.emit === 'function') {
                this.bot.eventBus.emit('signal.blocked', { symbol, direction, reason, message, timestamp: now });
            }
            this._logBlockedOnce(`${symbol}:${direction}:${reason}`, message, now);
            return { status: 'blocked', direction, reason, message };
        }

        _logBlockedOnce(key, message, now) {
            const throttle = this._getSafetySettings().blockedNoticeThrottleMs;
            const previous = this._lastBlockedNotice.get(key) || 0;
            if (now - previous < throttle) return;

            this._lastBlockedNotice.set(key, now);
            if (typeof this.bot.logToJournal === 'function') {
                this.bot.logToJournal(`[SİNYAL KORUMASI] ${message}`);
            }
        }
    }

    return { ConfluenceEngine };
}));
