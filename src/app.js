(() => {
    'use strict';

    const STORAGE = {
        settings: 'utc_settings',
        signals: 'utc_signals',
        symbol: 'utc_current_symbol',
        timeframe: 'utc_current_timeframe',
        theme: 'utc_theme'
    };

    const STRATEGY_LABELS = {
        wallBounce: 'Duvar Tepkisi',
        velocityScalping: 'Fiyat Hızı',
        rsiDivergence: 'RSI Uyumsuzluğu',
        orderFlowMomentum: 'Emir Akışı Momentumu',
        liquidityGaps: 'Likidite Boşlukları',
        breakoutPattern: 'Hacimli Kırılım',
        supportResistance: 'Destek / Direnç',
        fibonacciRetracement: 'Fibonacci Düzeltmesi',
        volumeProfile: 'Hacim Profili',
        smartMoneyConcepts: 'Smart Money / FVG',
        divergenceDetection: 'Pivot Uyumsuzluğu',
        marketStructure: 'Piyasa Yapısı',
        institutionalOrderFlow: 'Kurumsal Emir Akışı',
        microSpreadArbitrage: 'Spread Dönüşü',
        vwapReversion: 'VWAP Dönüşü',
        superTrend: 'Trend Kırılımı'
    };

    const DEFAULT_ACTIVE = new Set([
        'wallBounce',
        'velocityScalping',
        'rsiDivergence',
        'orderFlowMomentum',
        'breakoutPattern',
        'marketStructure',
        'institutionalOrderFlow'
    ]);

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const finite = value => Number.isFinite(Number(value));

    class ChartManager {
        constructor(containerId) {
            this.container = document.getElementById(containerId);
            this.chart = null;
            this.candles = null;
            this.volume = null;
            this.signalMarkers = [];
            this.resizeObserver = null;
            this.init();
        }

        init() {
            if (!this.container || !window.LightweightCharts) {
                throw new Error('Grafik kütüphanesi yüklenemedi.');
            }

            this.chart = LightweightCharts.createChart(this.container, this.chartOptions());
            this.candles = this.chart.addCandlestickSeries(this.candleOptions());
            this.volume = this.chart.addHistogramSeries({
                priceFormat: { type: 'volume' },
                priceScaleId: '',
                scaleMargins: { top: 0.82, bottom: 0 }
            });

            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.container);
            this.resize();
        }

        resize() {
            const width = this.container.clientWidth;
            const height = this.container.clientHeight;
            if (width > 0 && height > 0) this.chart.resize(width, height);
        }

        chartOptions() {
            const styles = getComputedStyle(document.documentElement);
            return {
                width: Math.max(1, this.container.clientWidth),
                height: Math.max(1, this.container.clientHeight),
                layout: {
                    backgroundColor: 'transparent',
                    textColor: styles.getPropertyValue('--muted').trim(),
                    fontFamily: '"Roboto Mono", monospace',
                    fontSize: 10
                },
                grid: {
                    vertLines: { color: styles.getPropertyValue('--border').trim() },
                    horzLines: { color: styles.getPropertyValue('--border').trim() }
                },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
                rightPriceScale: { borderColor: styles.getPropertyValue('--border').trim() },
                timeScale: {
                    borderColor: styles.getPropertyValue('--border').trim(),
                    timeVisible: true,
                    secondsVisible: false,
                    rightOffset: 8
                },
                handleScroll: true,
                handleScale: true
            };
        }

        candleOptions() {
            const styles = getComputedStyle(document.documentElement);
            const positive = styles.getPropertyValue('--positive').trim();
            const negative = styles.getPropertyValue('--negative').trim();
            return {
                upColor: positive,
                downColor: negative,
                borderVisible: false,
                wickUpColor: positive,
                wickDownColor: negative,
                priceFormat: { type: 'price', precision: 6, minMove: 0.000001 }
            };
        }

        updateTheme() {
            this.chart.applyOptions(this.chartOptions());
            this.candles.applyOptions(this.candleOptions());
        }

        setData(candles) {
            const candleData = candles.map(candle => ({
                time: candle.time / 1000,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            }));
            const volumeData = candles.map(candle => ({
                time: candle.time / 1000,
                value: candle.volume,
                color: candle.close >= candle.open ? 'rgba(43, 217, 159, .34)' : 'rgba(255, 95, 109, .34)'
            }));
            this.candles.setData(candleData);
            this.volume.setData(volumeData);
            if (candles.length) this.chart.timeScale().fitContent();
        }

        updateRealtime(candle) {
            const data = {
                time: candle.time / 1000,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            };
            this.candles.update(data);
            this.volume.update({
                time: data.time,
                value: candle.volume,
                color: candle.close >= candle.open ? 'rgba(43, 217, 159, .34)' : 'rgba(255, 95, 109, .34)'
            });
        }

        setSignalMarkers(signals) {
            const styles = getComputedStyle(document.documentElement);
            const positive = styles.getPropertyValue('--positive').trim();
            const negative = styles.getPropertyValue('--negative').trim();
            this.signalMarkers = signals
                .filter(signal => finite(signal.timestamp) && finite(signal.price))
                .map(signal => ({
                    time: Number(signal.timestamp) / 1000,
                    position: signal.direction === 'buy' ? 'belowBar' : 'aboveBar',
                    color: signal.direction === 'buy' ? positive : negative,
                    shape: signal.direction === 'buy' ? 'arrowUp' : 'arrowDown',
                    text: `${signal.direction.toUpperCase()} · ${signal.score} (${signal.confirmations || 1}T)`
                }))
                .sort((a, b) => a.time - b.time);
            this.candles.setMarkers(this.signalMarkers);
        }

        zoom(multiplier) {
            const range = this.chart.timeScale().getVisibleLogicalRange();
            if (!range) return;
            const center = (range.from + range.to) / 2;
            const halfSpan = ((range.to - range.from) / multiplier) / 2;
            this.chart.timeScale().setVisibleLogicalRange({ from: center - halfSpan, to: center + halfSpan });
        }

        resetZoom() {
            this.chart.timeScale().fitContent();
        }
    }

    class HeatmapManager {
        constructor(canvasId) {
            this.canvas = document.getElementById(canvasId);
            this.ctx = this.canvas.getContext('2d');
            this.width = 0;
            this.height = 0;
            this.lastOrderBook = null;
            this.lastPrice = null;
            this.resizeObserver = new ResizeObserver(() => {
                this.resize();
                if (this.lastOrderBook) this.draw(this.lastOrderBook, this.lastPrice);
            });
            this.resizeObserver.observe(this.canvas.parentElement);
            this.resize();
        }

        resize() {
            const width = this.canvas.clientWidth;
            const height = this.canvas.clientHeight;
            if (!width || !height) return;
            const dpr = window.devicePixelRatio || 1;
            this.width = width;
            this.height = height;
            this.canvas.width = Math.round(width * dpr);
            this.canvas.height = Math.round(height * dpr);
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        clear() {
            this.ctx.clearRect(0, 0, this.width, this.height);
        }

        draw(orderBook, price) {
            this.lastOrderBook = orderBook;
            this.lastPrice = price;
            this.clear();
            if (!orderBook.bids.length || !orderBook.asks.length || !this.width || !this.height) return;

            const asks = orderBook.asks.slice().reverse();
            const bids = orderBook.bids.slice();
            const levels = [...asks, ...bids];
            const maxQuantity = Math.max(...levels.map(level => level[1]), 1e-8);
            const half = this.height / 2;

            this.drawLevels(asks, 'ask', maxQuantity, 0, half, price);
            this.drawLevels(bids, 'bid', maxQuantity, half, half, price);

            const styles = getComputedStyle(document.documentElement);
            this.ctx.strokeStyle = styles.getPropertyValue('--border-strong').trim();
            this.ctx.beginPath();
            this.ctx.moveTo(0, half);
            this.ctx.lineTo(this.width, half);
            this.ctx.stroke();
        }

        drawLevels(levels, type, maxQuantity, offsetY, availableHeight, referencePrice) {
            if (!levels.length) return;
            const styles = getComputedStyle(document.documentElement);
            const textColor = styles.getPropertyValue('--muted').trim();
            const height = availableHeight / levels.length;
            const skip = Math.max(1, Math.ceil(15 / Math.max(height, 1)));
            const decimals = this.decimals(referencePrice);

            levels.forEach(([price, quantity], index) => {
                const intensity = clamp(Math.sqrt(quantity / maxQuantity), 0, 1);
                const y = offsetY + index * height;
                const red = type === 'ask' ? '255, 95, 109' : '43, 217, 159';
                this.ctx.fillStyle = `rgba(${red}, ${0.08 + intensity * 0.5})`;
                this.ctx.fillRect(0, y, this.width * intensity, Math.max(height, 1));

                if (index % skip === 0) {
                    this.ctx.fillStyle = textColor;
                    this.ctx.font = '9px "Roboto Mono"';
                    this.ctx.textAlign = 'left';
                    this.ctx.fillText(`${quantity.toFixed(3)} @ ${price.toFixed(decimals)}`, 9, y + Math.min(12, height - 2));
                }
            });
        }

        decimals(price) {
            if (!price || price > 1000) return 2;
            if (price > 1) return 3;
            if (price > 0.01) return 4;
            return 6;
        }
    }

    class Strategy {
        constructor(bot, name) {
            this.bot = bot;
            this.name = name;
            this.displayName = STRATEGY_LABELS[name] || name;
            this.lastProposalTime = Object.create(null);
        }

        propose(direction, reason, score) {
            const symbol = this.bot.currentSymbol;
            const now = Date.now();
            const cooldown = this.bot.settings.cooldowns.strategyProposalMs ?? 10000;

            // Stratejinin yön değiştirerek birkaç saniyede kendi oyunu tersine
            // çevirmesini de engelle. Cooldown sembol bazındadır, yön bazında değil.
            if (now - (this.lastProposalTime[symbol] || 0) < cooldown) return;
            this.bot.confluenceEngine.propose(this.name, direction, reason, score);
            this.lastProposalTime[symbol] = now;
        }

        analyzeOrderBook() {}
        processTrade() {}
        periodicAnalyze() {}
    }

    class WallBounceStrategy extends Strategy {
        constructor(bot) {
            super(bot, 'wallBounce');
            this.distanceThreshold = 0.0005;
        }
        analyzeOrderBook(orderBook) {
            const current = this.bot.marketData.price;
            if (!current) return;
            const btcPrice = this.bot.marketData.btcPrice || 70000;
            const threshold = (this.bot.settings.params.wallBtc * btcPrice) / current;
            const askWall = orderBook.asks.find(([price, qty]) => qty > threshold && price > current && (price - current) / current < this.distanceThreshold);
            if (askWall) return this.propose('sell', `Satış duvarı ${askWall[0]}`, 3);
            const bidWall = orderBook.bids.find(([price, qty]) => qty > threshold && price < current && (current - price) / current < this.distanceThreshold);
            if (bidWall) this.propose('buy', `Alış duvarı ${bidWall[0]}`, 3);
        }
    }

    class VelocityScalpingStrategy extends Strategy {
        constructor(bot) {
            super(bot, 'velocityScalping');
            this.points = [];
            this.windowMs = 2000;
            this.minPoints = 20;
            this.threshold = 0.001;
        }
        processTrade(trade) {
            const now = Date.now();
            this.points.push({ time: now, price: trade.price });
            this.points = this.points.filter(point => now - point.time < this.windowMs);
            if (this.points.length < this.minPoints) return;
            const change = (this.points.at(-1).price - this.points[0].price) / this.points[0].price;
            if (change > this.threshold) {
                this.propose('buy', `Fiyat hızı +${(change * 100).toFixed(2)}%`, 4);
                this.points = [];
            } else if (change < -this.threshold) {
                this.propose('sell', `Fiyat hızı ${(change * 100).toFixed(2)}%`, 4);
                this.points = [];
            }
        }
    }

    class RsiDivergenceStrategy extends Strategy {
        constructor(bot) { super(bot, 'rsiDivergence'); }
        periodicAnalyze() {
            const candles = this.bot.getClosedCandles();
            const rsi = this.bot.indicators.rsi;
            const lookback = this.bot.settings.params.rsiPeriod;
            if (candles.length < lookback + 1 || rsi.length !== candles.length) return;
            const last = candles.at(-1);
            const previous = candles.at(-1 - lookback);
            const lastRsi = rsi.at(-1);
            const previousRsi = rsi.at(-1 - lookback);
            if (![lastRsi, previousRsi].every(Number.isFinite)) return;
            if (last.high > previous.high && lastRsi < previousRsi) this.propose('sell', 'RSI ayı uyuşmazlığı', 5);
            else if (last.low < previous.low && lastRsi > previousRsi) this.propose('buy', 'RSI boğa uyuşmazlığı', 5);
        }
    }

    class OrderFlowMomentumStrategy extends Strategy {
        constructor(bot) {
            super(bot, 'orderFlowMomentum');
            this.trades = [];
            this.windowMs = 5000;
        }
        processTrade(trade) {
            const now = Date.now();
            this.trades.push(trade);
            this.trades = this.trades.filter(item => now - item.timestamp < this.windowMs);
            if (this.trades.length < 50) return;
            const buys = this.trades.filter(item => !item.isBuyerMaker).reduce((sum, item) => sum + item.quantity, 0);
            const sells = this.trades.filter(item => item.isBuyerMaker).reduce((sum, item) => sum + item.quantity, 0);
            const total = buys + sells;
            if (!total) return;
            if (buys / total > 0.7) {
                this.propose('buy', `Alıcı akışı %${Math.round(buys / total * 100)}`, 4);
                this.trades = [];
            } else if (sells / total > 0.7) {
                this.propose('sell', `Satıcı akışı %${Math.round(sells / total * 100)}`, 4);
                this.trades = [];
            }
        }
    }

    class LiquidityGapsStrategy extends Strategy {
        constructor(bot) {
            super(bot, 'liquidityGaps');
            this.threshold = 0.001;
        }
        analyzeOrderBook(orderBook) {
            for (let i = 0; i < orderBook.asks.length - 1; i += 1) {
                const gap = (orderBook.asks[i + 1][0] - orderBook.asks[i][0]) / orderBook.asks[i][0];
                if (gap > this.threshold) return this.propose('buy', 'Ask tarafında likidite boşluğu', 3);
            }
            for (let i = 0; i < orderBook.bids.length - 1; i += 1) {
                const gap = (orderBook.bids[i][0] - orderBook.bids[i + 1][0]) / orderBook.bids[i][0];
                if (gap > this.threshold) return this.propose('sell', 'Bid tarafında likidite boşluğu', 3);
            }
        }
    }

    class BreakoutPatternStrategy extends Strategy {
        constructor(bot) { super(bot, 'breakoutPattern'); }
        periodicAnalyze() {
            const candles = this.bot.getClosedCandles();
            const lookback = 30;
            if (candles.length < lookback + 1) return;
            const recent = candles.slice(-lookback - 1);
            const last = recent.at(-1);
            const history = recent.slice(0, -1);
            const maxHigh = Math.max(...history.map(candle => candle.high));
            const minLow = Math.min(...history.map(candle => candle.low));
            const averageVolume = mean(history.map(candle => candle.volume));
            if (last.close > maxHigh * 1.0003 && last.volume > averageVolume * 1.4) this.propose('buy', 'Aralık üstü hacimli kırılım', 4);
            else if (last.close < minLow * 0.9997 && last.volume > averageVolume * 1.4) this.propose('sell', 'Aralık altı hacimli kırılım', 4);
        }
    }

    class SupportResistanceStrategy extends Strategy {
        constructor(bot) { super(bot, 'supportResistance'); }
        periodicAnalyze() {
            const candles = this.bot.getClosedCandles();
            if (candles.length < 60) return;
            const recent = candles.slice(-60);
            const last = recent.at(-1);
            const history = recent.slice(0, -1);
            const resistance = Math.max(...history.map(candle => candle.high));
            const support = Math.min(...history.map(candle => candle.low));
            if ((resistance - last.close) / last.close >= 0 && (resistance - last.close) / last.close < 0.0015 && last.close < last.open) {
                this.propose('sell', 'Direnç bölgesi reddi', 3);
            } else if ((last.close - support) / last.close >= 0 && (last.close - support) / last.close < 0.0015 && last.close > last.open) {
                this.propose('buy', 'Destek bölgesi tepkisi', 3);
            }
        }
    }

    class FibonacciRetracementStrategy extends Strategy {
        constructor(bot) {
            super(bot, 'fibonacciRetracement');
            this.levels = [0.382, 0.5, 0.618];
        }
        periodicAnalyze() {
            const candles = this.bot.getClosedCandles();
            if (candles.length < 120) return;
            const recent = candles.slice(-120);
            let high = -Infinity;
            let low = Infinity;
            let highTime = 0;
            let lowTime = 0;
            recent.forEach(candle => {
                if (candle.high > high) { high = candle.high; highTime = candle.time; }
                if (candle.low < low) { low = candle.low; lowTime = candle.time; }
            });
            const range = high - low;
            if (!range) return;
            const last = recent.at(-1);
            const retracement = highTime > lowTime ? (high - last.close) / range : (last.close - low) / range;
            const level = this.levels.find(item => Math.abs(retracement - item) < 0.002);
            if (level) this.propose(highTime > lowTime ? 'buy' : 'sell', `Fibonacci ${Math.round(level * 100)}% bölgesi`, 3);
        }
    }

    class VolumeProfileStrategy extends Strategy {
        constructor(bot) { super(bot, 'volumeProfile'); }
        periodicAnalyze() {
            const candles = this.bot.getClosedCandles();
            if (candles.length < 21) return;
            const last = candles.at(-1);
            const average = mean(candles.slice(-21, -1).map(candle => candle.volume));
            const range = Math.max(last.high - last.low, 1e-8);
            if (last.volume > average * 2 && (last.close - last.low) / range > 0.7) this.propose('buy', 'Hacim sıçraması, üst kapanış', 3);
            else if (last.volume > average * 2 && (last.high - last.close) / range > 0.7) this.propose('sell', 'Hacim sıçraması, alt kapanış', 3);
        }
    }

    class SmartMoneyConceptsStrategy extends Strategy {
        constructor(bot) { super(bot, 'smartMoneyConcepts'); }
        periodicAnalyze() {
            const candles = this.bot.getClosedCandles();
            if (candles.length < 3) return;
            const first = candles.at(-3);
            const last = candles.at(-1);
            if ((last.low - first.high) / last.low > 0.0005) this.propose('buy', 'Bullish fair value gap', 4);
            else if ((first.low - last.high) / last.high > 0.0005) this.propose('sell', 'Bearish fair value gap', 4);
        }
    }

    class DivergenceDetectionStrategy extends Strategy {
        constructor(bot) { super(bot, 'divergenceDetection'); }
        periodicAnalyze() {
            const candles = this.bot.getClosedCandles();
            const rsi = this.bot.indicators.rsi;
            const lookback = 40;
            const swing = 3;
            if (candles.length < lookback || rsi.length !== candles.length) return;
            const recent = candles.slice(-lookback);
            const recentRsi = rsi.slice(-lookback);
            const lows = [];
            const highs = [];
            for (let i = swing; i < recent.length - swing; i += 1) {
                const left = recent.slice(i - swing, i);
                const right = recent.slice(i + 1, i + swing + 1);
                if (recent[i].low < Math.min(...left.map(item => item.low)) && recent[i].low < Math.min(...right.map(item => item.low))) lows.push(i);
                if (recent[i].high > Math.max(...left.map(item => item.high)) && recent[i].high > Math.max(...right.map(item => item.high))) highs.push(i);
            }
            if (lows.length >= 2) {
                const [a, b] = lows.slice(-2);
                if (recent[b].low < recent[a].low && recentRsi[b] > recentRsi[a]) return this.propose('buy', 'Pivot RSI boğa uyuşmazlığı', 5);
            }
            if (highs.length >= 2) {
                const [a, b] = highs.slice(-2);
                if (recent[b].high > recent[a].high && recentRsi[b] < recentRsi[a]) this.propose('sell', 'Pivot RSI ayı uyuşmazlığı', 5);
            }
        }
    }

    class MarketStructureStrategy extends Strategy {
        constructor(bot) { super(bot, 'marketStructure'); }
        periodicAnalyze() {
            const candles = this.bot.getClosedCandles();
            const swing = 3;
            if (candles.length < 30) return;
            const recent = candles.slice(-100);
            const pivotHighs = [];
            const pivotLows = [];
            for (let i = swing; i < recent.length - swing - 1; i += 1) {
                const left = recent.slice(i - swing, i);
                const right = recent.slice(i + 1, i + swing + 1);
                if (recent[i].high > Math.max(...left.map(item => item.high), ...right.map(item => item.high))) pivotHighs.push(recent[i].high);
                if (recent[i].low < Math.min(...left.map(item => item.low), ...right.map(item => item.low))) pivotLows.push(recent[i].low);
            }
            const last = recent.at(-1);
            if (pivotHighs.length && last.close > pivotHighs.at(-1)) this.propose('buy', 'Yapı kırılımı yukarı', 4);
            else if (pivotLows.length && last.close < pivotLows.at(-1)) this.propose('sell', 'Yapı kırılımı aşağı', 4);
        }
    }

    class InstitutionalOrderFlowStrategy extends Strategy {
        constructor(bot) { super(bot, 'institutionalOrderFlow'); }
        analyzeOrderBook(orderBook) {
            if (!orderBook.bids.length || !orderBook.asks.length) return;
            const bids = orderBook.bids.slice(0, 5).reduce((sum, [, qty]) => sum + qty, 0);
            const asks = orderBook.asks.slice(0, 5).reduce((sum, [, qty]) => sum + qty, 0);
            if (bids / Math.max(asks, 1e-8) > 2) this.propose('buy', 'Bid ağırlıklı emir defteri', 3);
            else if (asks / Math.max(bids, 1e-8) > 2) this.propose('sell', 'Ask ağırlıklı emir defteri', 3);
        }
    }

    class MicroSpreadArbitrageStrategy extends Strategy {
        constructor(bot) { super(bot, 'microSpreadArbitrage'); }
        analyzeOrderBook(orderBook) {
            if (!orderBook.bids.length || !orderBook.asks.length) return;
            const bid = orderBook.bids[0][0];
            const ask = orderBook.asks[0][0];
            const middle = (ask + bid) / 2;
            if ((ask - bid) / middle <= 0.0008) return;
            const current = this.bot.marketData.price || middle;
            this.propose(current < middle ? 'buy' : 'sell', 'Geniş spread ortalamaya dönüşü', 2);
        }
    }

    class VWAPReversionStrategy extends Strategy {
        constructor(bot) { super(bot, 'vwapReversion'); }
        periodicAnalyze() {
            const price = this.bot.marketData.price;
            const { vwap, atr } = this.bot.indicators;
            if (!price || !vwap || !atr) return;
            if ((price - vwap) / vwap > atr / price) this.propose('sell', 'VWAP üstü aşırı sapma', 3);
            else if ((price - vwap) / vwap < -(atr / price)) this.propose('buy', 'VWAP altı aşırı sapma', 3);
        }
    }

    class SuperTrendStrategy extends Strategy {
        constructor(bot) { super(bot, 'superTrend'); }
        periodicAnalyze() {
            const candles = this.bot.getClosedCandles();
            const atr = this.bot.indicators.atr;
            if (candles.length < 22 || !atr) return;
            const closes = candles.map(candle => candle.close);
            const last = candles.at(-1);
            const previous = candles.at(-2);
            const currentAverage = mean(closes.slice(-20));
            const previousAverage = mean(closes.slice(-21, -1));
            if (previous.close <= previousAverage && last.close > currentAverage + atr * 0.2) this.propose('buy', 'ATR trend kırılımı yukarı', 4);
            else if (previous.close >= previousAverage && last.close < currentAverage - atr * 0.2) this.propose('sell', 'ATR trend kırılımı aşağı', 4);
        }
    }

    class TradingScannerApp {
        constructor() {
            this.strategyClasses = {
                wallBounce: WallBounceStrategy,
                velocityScalping: VelocityScalpingStrategy,
                rsiDivergence: RsiDivergenceStrategy,
                orderFlowMomentum: OrderFlowMomentumStrategy,
                liquidityGaps: LiquidityGapsStrategy,
                breakoutPattern: BreakoutPatternStrategy,
                supportResistance: SupportResistanceStrategy,
                fibonacciRetracement: FibonacciRetracementStrategy,
                volumeProfile: VolumeProfileStrategy,
                smartMoneyConcepts: SmartMoneyConceptsStrategy,
                divergenceDetection: DivergenceDetectionStrategy,
                marketStructure: MarketStructureStrategy,
                institutionalOrderFlow: InstitutionalOrderFlowStrategy,
                microSpreadArbitrage: MicroSpreadArbitrageStrategy,
                vwapReversion: VWAPReversionStrategy,
                superTrend: SuperTrendStrategy
            };

            this.currentSymbol = this.loadData(STORAGE.symbol) || 'BTCUSDT';
            this.currentTimeframe = this.loadData(STORAGE.timeframe) || '15m';
            this.settings = this.loadSettings();
            this.signals = this.loadData(STORAGE.signals) || [];
            this.candles = [];
            this.orderBook = { bids: [], asks: [] };
            this.marketData = { price: null, btcPrice: null, change24h: null, volume24h: null };
            this.indicators = { rsi: [], atr: null, sma20: null, sma50: null, vwap: null };
            this.strategies = {};
            this.activeStrategies = {};
            this.socket = null;
            this.reconnectTimer = null;
            this.reconnectAttempts = 0;
            this.renderTimer = null;
            this.analysisTimer = null;
            this.isRunning = false;

            this.applySavedTheme();
            this.chartManager = new ChartManager('live-chart');
            this.heatmapManager = new HeatmapManager('orderbook-heatmap');
            this.confluenceEngine = new window.ConfluenceEngine(this);
            this.initStrategies();
            this.bindEvents();
            this.syncControls();
            this.renderAll();
            this.renderSafetyChips();
        }

        defaultSettings() {
            const activeStrategies = {};
            Object.keys(this.strategyClasses).forEach(key => { activeStrategies[key] = DEFAULT_ACTIVE.has(key); });
            return {
                confluenceThreshold: 3,
                params: { rsiPeriod: 14, atrPeriod: 14, wallBtc: 20, rrRatio: 1.5 },
                cooldowns: { signalMs: 15000, sameDirectionMs: 30000, proposalTimeoutMs: 3000, strategyProposalMs: 10000 },
                signalSafety: {
                    evaluationDelayMs: 1000,
                    minScoreLead: 2,
                    minConfirmations: 2,
                    preventSignalsWhileActive: true,
                    oppositeSignalLockMs: 120000,
                    minReversalConfirmations: 2,
                    reversalScoreMultiplier: 1.25,
                    blockedNoticeThrottleMs: 10000
                },
                activeStrategies
            };
        }

        loadSettings() {
            const defaults = this.defaultSettings();
            const saved = this.loadData(STORAGE.settings);
            if (!saved) return defaults;
            return {
                ...defaults,
                ...saved,
                params: { ...defaults.params, ...(saved.params || {}) },
                cooldowns: { ...defaults.cooldowns, ...(saved.cooldowns || {}) },
                signalSafety: { ...defaults.signalSafety, ...(saved.signalSafety || {}) },
                activeStrategies: { ...defaults.activeStrategies, ...(saved.activeStrategies || {}) }
            };
        }

        initStrategies() {
            Object.entries(this.strategyClasses).forEach(([key, StrategyClass]) => {
                this.strategies[key] = new StrategyClass(this);
            });
            this.updateActiveStrategies();
        }

        updateActiveStrategies() {
            this.activeStrategies = {};
            Object.entries(this.strategies).forEach(([key, strategy]) => {
                if (this.settings.activeStrategies[key]) this.activeStrategies[key] = strategy;
            });
        }

        bindEvents() {
            document.getElementById('start-btn').addEventListener('click', () => this.start());
            document.getElementById('stop-btn').addEventListener('click', () => this.stop());
            document.getElementById('theme-btn').addEventListener('click', () => this.toggleTheme());
            document.getElementById('settings-btn').addEventListener('click', () => this.openSettings());
            document.getElementById('clear-signals-btn').addEventListener('click', () => this.clearSignals());

            document.getElementById('symbol-input').addEventListener('change', event => {
                const base = this.sanitizeSymbol(event.target.value);
                event.target.value = base;
                this.changeMarket(`${base}USDT`, this.currentTimeframe);
            });
            document.getElementById('timeframe-select').addEventListener('change', event => {
                this.changeMarket(this.currentSymbol, event.target.value);
            });

            document.getElementById('chart-view-btn').addEventListener('click', () => this.switchView('chart'));
            document.getElementById('heatmap-view-btn').addEventListener('click', () => this.switchView('heatmap'));
            document.getElementById('zoom-in-btn').addEventListener('click', () => this.chartManager.zoom(1.3));
            document.getElementById('zoom-out-btn').addEventListener('click', () => this.chartManager.zoom(0.77));
            document.getElementById('zoom-reset-btn').addEventListener('click', () => this.chartManager.resetZoom());

            const form = document.getElementById('settings-form');
            form.addEventListener('submit', event => {
                event.preventDefault();
                if (event.submitter && event.submitter.value === 'default') this.applySettingsFromForm();
                document.getElementById('settings-dialog').close();
            });
            document.getElementById('reset-settings-btn').addEventListener('click', () => this.resetSettings());

            window.addEventListener('online', () => {
                if (this.isRunning && (!this.socket || this.socket.readyState > 1)) this.connectWebSocket(true);
            });
            window.addEventListener('offline', () => this.updateConnection(false, 'İNTERNET YOK'));
            window.addEventListener('beforeunload', () => this.disconnectWebSocket());
        }

        syncControls() {
            document.getElementById('symbol-input').value = this.currentSymbol.replace(/USDT$/, '');
            document.getElementById('timeframe-select').value = this.currentTimeframe;
            this.updateMarketLabels();
        }

        sanitizeSymbol(value) {
            const clean = String(value || '').toUpperCase().replace(/USDT$/i, '').replace(/[^A-Z0-9]/g, '').slice(0, 12);
            return clean || 'BTC';
        }

        async start() {
            if (this.isRunning) return;
            this.isRunning = true;
            document.getElementById('start-btn').disabled = true;
            document.getElementById('stop-btn').disabled = false;
            this.updateConnection(false, 'BAĞLANIYOR');
            this.notify('Sistem başlatılıyor; piyasa verisi yükleniyor.', 'success');

            await this.fetchInitialData();
            if (!this.isRunning) return;
            this.connectWebSocket(false);
            this.renderTimer = window.setInterval(() => this.renderPrice(), 250);
            this.analysisTimer = window.setInterval(() => this.runPeriodicAnalysis(), 5000);
        }

        stop(options = {}) {
            if (!this.isRunning && !this.socket) return;
            this.isRunning = false;
            document.getElementById('start-btn').disabled = false;
            document.getElementById('stop-btn').disabled = true;
            window.clearInterval(this.renderTimer);
            window.clearInterval(this.analysisTimer);
            this.renderTimer = null;
            this.analysisTimer = null;
            this.disconnectWebSocket();
            this.updateConnection(false, 'DURDURULDU');
            if (!options.silent) this.notify('Sistem durduruldu.', 'warning');
        }

        async changeMarket(symbol, timeframe) {
            if (symbol === this.currentSymbol && timeframe === this.currentTimeframe) return;
            const shouldRestart = this.isRunning;
            if (shouldRestart) this.stop({ silent: true });

            this.currentSymbol = symbol;
            this.currentTimeframe = timeframe;
            this.saveData(STORAGE.symbol, symbol);
            this.saveData(STORAGE.timeframe, timeframe);
            this.resetMarketData();
            this.syncControls();
            this.notify(`${symbol.replace('USDT', '/USDT')} · ${timeframe} seçildi.`, 'info');
            if (shouldRestart) await this.start();
        }

        resetMarketData() {
            this.confluenceEngine.reset();
            this.candles = [];
            this.orderBook = { bids: [], asks: [] };
            this.marketData = { price: null, btcPrice: null, change24h: null, volume24h: null };
            this.indicators = { rsi: [], atr: null, sma20: null, sma50: null, vwap: null };
            this.chartManager.setData([]);
            this.chartManager.setSignalMarkers([]);
            this.heatmapManager.lastOrderBook = null;
            this.heatmapManager.clear();
            document.getElementById('chart-empty').classList.remove('hidden');
            document.getElementById('heatmap-empty').classList.remove('hidden');
            this.renderAll();
        }

        async fetchInitialData() {
            try {
                const endpoint = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(this.currentSymbol)}&interval=${encodeURIComponent(this.currentTimeframe)}&limit=500`;
                const response = await fetch(endpoint);
                if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);
                const rows = await response.json();
                if (!Array.isArray(rows)) throw new Error('Beklenmeyen Binance yanıtı');
                const now = Date.now();
                this.candles = rows.map(row => ({
                    time: Number(row[0]),
                    closeTime: Number(row[6]),
                    open: Number(row[1]),
                    high: Number(row[2]),
                    low: Number(row[3]),
                    close: Number(row[4]),
                    volume: Number(row[5]),
                    closed: Number(row[6]) < now
                }));
                this.calculateIndicators();
                this.chartManager.setData(this.candles);
                this.chartManager.setSignalMarkers(this.signals.filter(signal => signal.symbol === this.currentSymbol));
                document.getElementById('chart-empty').classList.toggle('hidden', this.candles.length > 0);
            } catch (error) {
                console.error(error);
                this.notify(`Geçmiş veri alınamadı: ${error.message}`, 'danger');
            }
        }

        connectWebSocket(isReconnect) {
            if (!this.isRunning) return;
            this.disconnectWebSocket(false);
            if (!isReconnect) this.reconnectAttempts = 0;

            const lower = this.currentSymbol.toLowerCase();
            const streams = [`${lower}@ticker`, `${lower}@depth20@100ms`, `${lower}@aggTrade`, `${lower}@kline_${this.currentTimeframe}`];
            if (lower !== 'btcusdt') streams.push('btcusdt@ticker');
            const socket = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams.join('/')}`);
            this.socket = socket;

            socket.addEventListener('open', () => {
                if (socket !== this.socket) return;
                this.reconnectAttempts = 0;
                this.updateConnection(true, 'CANLI');
            });
            socket.addEventListener('message', event => {
                if (socket !== this.socket) return;
                try {
                    const message = JSON.parse(event.data);
                    this.handleMarketData(message.stream, message.data);
                } catch (error) {
                    console.error('WebSocket verisi işlenemedi:', error);
                }
            });
            socket.addEventListener('error', () => {
                if (socket === this.socket) this.updateConnection(false, 'BAĞLANTI HATASI');
            });
            socket.addEventListener('close', () => {
                if (socket !== this.socket || !this.isRunning) return;
                this.socket = null;
                this.reconnectAttempts += 1;
                const delay = Math.min(30000, 3000 * 2 ** Math.min(this.reconnectAttempts - 1, 4));
                this.updateConnection(false, `${Math.round(delay / 1000)} SN SONRA TEKRAR`);
                this.reconnectTimer = window.setTimeout(() => this.connectWebSocket(true), delay);
            });
        }

        disconnectWebSocket(clearReference = true) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
            const socket = this.socket;
            if (clearReference) this.socket = null;
            if (socket) {
                socket.onclose = null;
                if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000, 'İstemci kapattı');
            }
        }

        handleMarketData(stream, data) {
            if (!data) return;
            const streamType = stream.split('@')[1] || '';

            if (streamType === 'ticker') {
                if (data.s === 'BTCUSDT') this.marketData.btcPrice = Number(data.c);
                if (data.s === this.currentSymbol) {
                    this.marketData.price = Number(data.c);
                    this.marketData.change24h = Number(data.P);
                    this.marketData.volume24h = Number(data.q);
                    this.checkAutoCloseSignals();
                    this.renderPrice();
                }
                return;
            }

            if (streamType.startsWith('depth')) {
                this.orderBook = {
                    bids: (data.b || []).map(([price, qty]) => [Number(price), Number(qty)]),
                    asks: (data.a || []).map(([price, qty]) => [Number(price), Number(qty)])
                };
                this.heatmapManager.draw(this.orderBook, this.marketData.price);
                document.getElementById('heatmap-empty').classList.toggle('hidden', this.orderBook.bids.length > 0);
                Object.values(this.activeStrategies).forEach(strategy => strategy.analyzeOrderBook(this.orderBook));
                return;
            }

            if (streamType.startsWith('kline')) {
                const kline = data.k;
                const candle = {
                    time: Number(kline.t),
                    closeTime: Number(kline.T),
                    open: Number(kline.o),
                    high: Number(kline.h),
                    low: Number(kline.l),
                    close: Number(kline.c),
                    volume: Number(kline.v),
                    closed: Boolean(kline.x)
                };
                this.upsertCandle(candle);
                this.chartManager.updateRealtime(candle);
                if (candle.closed) this.calculateIndicators();
                this.checkAutoCloseSignals();
                return;
            }

            if (streamType === 'aggTrade') {
                const trade = {
                    price: Number(data.p),
                    quantity: Number(data.q),
                    isBuyerMaker: Boolean(data.m),
                    timestamp: Number(data.T)
                };
                Object.values(this.activeStrategies).forEach(strategy => strategy.processTrade(trade));
            }
        }

        upsertCandle(candle) {
            const last = this.candles.at(-1);
            if (last && last.time === candle.time) this.candles[this.candles.length - 1] = candle;
            else if (!last || candle.time > last.time) this.candles.push(candle);
            if (this.candles.length > 500) this.candles.shift();
        }

        getClosedCandles() {
            return this.candles.filter(candle => candle.closed);
        }

        runPeriodicAnalysis() {
            if (!this.isRunning) return;
            this.calculateIndicators();
            Object.values(this.activeStrategies).forEach(strategy => strategy.periodicAnalyze());
        }

        calculateIndicators() {
            const candles = this.getClosedCandles();
            const closes = candles.map(candle => candle.close);
            const rsiPeriod = clamp(Number(this.settings.params.rsiPeriod) || 14, 2, 100);
            this.indicators.rsi = this.calculateRsi(closes, rsiPeriod);

            const atrPeriod = clamp(Number(this.settings.params.atrPeriod) || 14, 2, 100);
            const trueRanges = [];
            for (let i = 1; i < candles.length; i += 1) {
                const current = candles[i];
                const previous = candles[i - 1];
                trueRanges.push(Math.max(
                    current.high - current.low,
                    Math.abs(current.high - previous.close),
                    Math.abs(current.low - previous.close)
                ));
            }
            if (trueRanges.length >= atrPeriod) {
                let atr = mean(trueRanges.slice(0, atrPeriod));
                for (let i = atrPeriod; i < trueRanges.length; i += 1) atr = (atr * (atrPeriod - 1) + trueRanges[i]) / atrPeriod;
                this.indicators.atr = atr;
            } else {
                this.indicators.atr = null;
            }

            this.indicators.sma20 = closes.length >= 20 ? mean(closes.slice(-20)) : null;
            this.indicators.sma50 = closes.length >= 50 ? mean(closes.slice(-50)) : null;
            let priceVolume = 0;
            let totalVolume = 0;
            candles.forEach(candle => {
                const typical = (candle.high + candle.low + candle.close) / 3;
                priceVolume += typical * candle.volume;
                totalVolume += candle.volume;
            });
            this.indicators.vwap = totalVolume ? priceVolume / totalVolume : null;
        }

        calculateRsi(closes, period) {
            const result = Array(closes.length).fill(NaN);
            if (closes.length <= period) return result;
            let gains = 0;
            let losses = 0;
            for (let i = 1; i <= period; i += 1) {
                const difference = closes[i] - closes[i - 1];
                gains += Math.max(difference, 0);
                losses += Math.max(-difference, 0);
            }
            let averageGain = gains / period;
            let averageLoss = losses / period;
            result[period] = this.rsiValue(averageGain, averageLoss);
            for (let i = period + 1; i < closes.length; i += 1) {
                const difference = closes[i] - closes[i - 1];
                averageGain = (averageGain * (period - 1) + Math.max(difference, 0)) / period;
                averageLoss = (averageLoss * (period - 1) + Math.max(-difference, 0)) / period;
                result[i] = this.rsiValue(averageGain, averageLoss);
            }
            return result;
        }

        rsiValue(averageGain, averageLoss) {
            if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
            if (averageGain === 0) return 0;
            return 100 - (100 / (1 + averageGain / averageLoss));
        }

        calculateDynamicTpSl(signal) {
            const atr = this.indicators.atr;
            const rr = clamp(Number(this.settings.params.rrRatio) || 1.5, 0.1, 20);
            const fallbackRisk = signal.price * 0.005;
            const atrMultiplier = clamp(1.5 - Math.min(signal.score, 10) * 0.05, 0.75, 1.5);
            const risk = atr && atr > 0 ? atr * atrMultiplier : fallbackRisk;
            if (signal.direction === 'buy') {
                signal.sl = signal.price - risk;
                signal.tp = signal.price + risk * rr;
            } else {
                signal.sl = signal.price + risk;
                signal.tp = signal.price - risk * rr;
            }
        }

        addFinalSignal(signal) {
            this.signals.unshift(signal);
            this.signals = this.signals.slice(0, 200);
            this.saveData(STORAGE.signals, this.signals);
            this.chartManager.setSignalMarkers(this.signals.filter(item => item.symbol === this.currentSymbol));
            this.renderSignals();
            this.renderStats();
            this.renderActiveSignal();
            this.notify(
                `${signal.direction.toUpperCase()} ${signal.symbol.replace('USDT', '/USDT')} · Skor ${signal.score} · ${signal.confirmations} teyit`,
                signal.direction === 'buy' ? 'success' : 'danger'
            );
            this.playSignal(signal.direction);
        }

        checkAutoCloseSignals() {
            const price = this.marketData.price;
            if (!price) return;
            let changed = false;
            this.signals.forEach(signal => {
                if (signal.status !== 'active' || signal.symbol !== this.currentSymbol) return;
                const hitTp = signal.direction === 'buy' ? price >= signal.tp : price <= signal.tp;
                const hitSl = signal.direction === 'buy' ? price <= signal.sl : price >= signal.sl;
                if (hitTp || hitSl) {
                    signal.status = hitTp ? 'tp' : 'sl';
                    signal.closedAt = Date.now();
                    signal.closedPrice = price;
                    changed = true;
                    this.notify(`Sinyal ${signal.status.toUpperCase()} ile kapandı.`, hitTp ? 'success' : 'danger');
                }
            });
            if (changed) {
                this.saveData(STORAGE.signals, this.signals);
                this.renderSignals();
                this.renderStats();
                this.renderActiveSignal();
            }
        }

        clearSignals() {
            if (!this.signals.length) return;
            if (!window.confirm('Tüm sinyal geçmişi silinsin mi?')) return;
            this.signals = [];
            this.confluenceEngine.reset();
            this.saveData(STORAGE.signals, this.signals);
            this.chartManager.setSignalMarkers([]);
            this.renderSignals();
            this.renderStats();
            this.renderActiveSignal();
            this.notify('Sinyal geçmişi temizlendi.', 'info');
        }

        renderAll() {
            this.renderPrice();
            this.renderSignals();
            this.renderStats();
            this.renderActiveSignal();
            this.updateMarketLabels();
        }

        renderPrice() {
            const price = this.marketData.price;
            const change = this.marketData.change24h;
            const volume = this.marketData.volume24h;
            const formattedPrice = price ? this.formatPrice(price) : '—';
            document.getElementById('ticker-price').textContent = formattedPrice;
            document.getElementById('current-price').textContent = formattedPrice;
            document.getElementById('volume-24h').textContent = volume ? this.formatVolume(volume) : '—';
            document.getElementById('atr-value').textContent = this.indicators.atr ? this.formatPrice(this.indicators.atr) : '—';

            const changeText = finite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—';
            const className = !finite(change) ? 'neutral' : change >= 0 ? 'positive' : 'negative';
            const tickerChange = document.getElementById('ticker-change');
            tickerChange.textContent = changeText;
            tickerChange.className = className;
            const metricChange = document.getElementById('change-24h');
            metricChange.textContent = changeText;
            metricChange.className = className;
        }

        renderSignals() {
            const body = document.getElementById('signals-body');
            if (!this.signals.length) {
                body.innerHTML = '<tr><td colspan="6" class="table-empty">Henüz sinyal yok.</td></tr>';
                return;
            }
            body.innerHTML = this.signals.slice(0, 100).map(signal => `
                <tr title="${this.escapeHtml(signal.reason || '')}">
                    <td>${new Date(signal.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                    <td><span class="direction-pill ${signal.direction}">${signal.direction.toUpperCase()}</span></td>
                    <td>${this.formatPrice(signal.price)}</td>
                    <td>${signal.score}</td>
                    <td>${signal.confirmations || 1}</td>
                    <td><span class="status-pill ${signal.status}">${signal.status.toUpperCase()}</span></td>
                </tr>
            `).join('');
        }

        renderStats() {
            const finished = this.signals.filter(signal => signal.status === 'tp' || signal.status === 'sl');
            const tp = finished.filter(signal => signal.status === 'tp').length;
            const sl = finished.length - tp;
            document.getElementById('stat-total').textContent = finished.length;
            document.getElementById('stat-tp').textContent = tp;
            document.getElementById('stat-sl').textContent = sl;
            document.getElementById('stat-winrate').textContent = finished.length ? `${(tp / finished.length * 100).toFixed(1)}%` : '—';
        }

        renderActiveSignal() {
            const active = this.signals.find(signal => signal.symbol === this.currentSymbol && signal.status === 'active');
            const card = document.getElementById('active-signal-card');
            const title = document.getElementById('active-signal-title');
            const detail = document.getElementById('active-signal-detail');
            card.className = `active-signal-card ${active ? active.direction : 'empty'}`;
            if (!active) {
                title.textContent = 'Aktif sinyal yok';
                detail.textContent = 'Yeni sinyal için en az iki bağımsız teyit bekleniyor.';
                return;
            }
            title.textContent = `${active.direction.toUpperCase()} · ${this.formatPrice(active.price)} · Skor ${active.score}`;
            detail.textContent = `TP ${this.formatPrice(active.tp)} · SL ${this.formatPrice(active.sl)} · ${active.confirmations || 1} bağımsız teyit`;
        }

        updateMarketLabels() {
            const label = this.currentSymbol.replace('USDT', '/USDT');
            document.getElementById('ticker-symbol').textContent = label;
            document.getElementById('market-title').textContent = `${label} · ${this.currentTimeframe}`;
        }

        updateConnection(online, text) {
            const badge = document.getElementById('connection-badge');
            badge.classList.toggle('online', online);
            badge.classList.toggle('offline', !online);
            document.getElementById('connection-text').textContent = text;
        }

        switchView(view) {
            const chart = view === 'chart';
            document.getElementById('chart-view').classList.toggle('active', chart);
            document.getElementById('chart-view').hidden = !chart;
            document.getElementById('heatmap-view').classList.toggle('active', !chart);
            document.getElementById('heatmap-view').hidden = chart;
            document.getElementById('chart-view-btn').classList.toggle('active', chart);
            document.getElementById('heatmap-view-btn').classList.toggle('active', !chart);
            requestAnimationFrame(() => {
                if (chart) this.chartManager.resize();
                else {
                    this.heatmapManager.resize();
                    this.heatmapManager.draw(this.orderBook, this.marketData.price);
                }
            });
        }

        openSettings() {
            this.fillSettingsForm();
            document.getElementById('settings-dialog').showModal();
        }

        fillSettingsForm() {
            const { params, cooldowns, signalSafety } = this.settings;
            this.setInput('setting-threshold', this.settings.confluenceThreshold);
            this.setInput('setting-rsi', params.rsiPeriod);
            this.setInput('setting-atr', params.atrPeriod);
            this.setInput('setting-wall', params.wallBtc);
            this.setInput('setting-rr', params.rrRatio);
            this.setInput('setting-proposal-timeout', cooldowns.proposalTimeoutMs);
            this.setInput('setting-signal-cooldown', cooldowns.signalMs);
            this.setInput('setting-same-cooldown', cooldowns.sameDirectionMs);
            this.setInput('setting-strategy-cooldown', cooldowns.strategyProposalMs);
            this.setInput('setting-evaluation-delay', signalSafety.evaluationDelayMs);
            this.setInput('setting-score-lead', signalSafety.minScoreLead);
            this.setInput('setting-confirmations', signalSafety.minConfirmations);
            this.setInput('setting-opposite-lock', signalSafety.oppositeSignalLockMs);
            this.setInput('setting-reversal-confirmations', signalSafety.minReversalConfirmations);
            this.setInput('setting-reversal-multiplier', signalSafety.reversalScoreMultiplier);
            document.getElementById('setting-active-lock').checked = signalSafety.preventSignalsWhileActive;

            document.getElementById('strategy-toggles').innerHTML = Object.keys(this.strategyClasses).map(key => `
                <label class="strategy-toggle">
                    <input type="checkbox" data-strategy="${key}" ${this.settings.activeStrategies[key] ? 'checked' : ''}>
                    <span>${this.escapeHtml(STRATEGY_LABELS[key])}</span>
                </label>
            `).join('');
        }

        applySettingsFromForm() {
            const number = (id, fallback, min, max) => clamp(Number(document.getElementById(id).value) || fallback, min, max);
            const proposalTimeout = number('setting-proposal-timeout', 3000, 500, 30000);
            const evaluationDelay = Math.min(number('setting-evaluation-delay', 1000, 100, 10000), Math.max(100, proposalTimeout - 100));
            const activeStrategies = {};
            document.querySelectorAll('[data-strategy]').forEach(input => { activeStrategies[input.dataset.strategy] = input.checked; });

            this.settings = {
                confluenceThreshold: number('setting-threshold', 3, 1, 50),
                params: {
                    rsiPeriod: number('setting-rsi', 14, 2, 100),
                    atrPeriod: number('setting-atr', 14, 2, 100),
                    wallBtc: number('setting-wall', 20, 0.1, 10000),
                    rrRatio: number('setting-rr', 1.5, 0.1, 20)
                },
                cooldowns: {
                    signalMs: number('setting-signal-cooldown', 15000, 0, 3600000),
                    sameDirectionMs: number('setting-same-cooldown', 30000, 0, 3600000),
                    proposalTimeoutMs: proposalTimeout,
                    strategyProposalMs: number('setting-strategy-cooldown', 10000, 0, 3600000)
                },
                signalSafety: {
                    evaluationDelayMs: evaluationDelay,
                    minScoreLead: number('setting-score-lead', 2, 0, 20),
                    minConfirmations: number('setting-confirmations', 2, 1, 10),
                    preventSignalsWhileActive: document.getElementById('setting-active-lock').checked,
                    oppositeSignalLockMs: number('setting-opposite-lock', 120000, 0, 3600000),
                    minReversalConfirmations: number('setting-reversal-confirmations', 2, 1, 10),
                    reversalScoreMultiplier: number('setting-reversal-multiplier', 1.25, 1, 5),
                    blockedNoticeThrottleMs: 10000
                },
                activeStrategies
            };
            this.saveData(STORAGE.settings, this.settings);
            this.confluenceEngine.reset();
            this.updateActiveStrategies();
            this.calculateIndicators();
            this.renderSafetyChips();
            this.notify('Ayarlar kaydedildi; bekleyen teklifler temizlendi.', 'success');
        }

        resetSettings() {
            if (!window.confirm('Tüm strateji ve güvenlik ayarları varsayılana dönsün mü?')) return;
            this.settings = this.defaultSettings();
            this.saveData(STORAGE.settings, this.settings);
            this.confluenceEngine.reset();
            this.updateActiveStrategies();
            this.fillSettingsForm();
            this.renderSafetyChips();
            this.notify('Varsayılan güvenli ayarlar yüklendi.', 'info');
        }

        renderSafetyChips() {
            const safety = this.settings.signalSafety;
            document.getElementById('safety-chips').innerHTML = [
                `${safety.minConfirmations} bağımsız teyit`,
                `${safety.minScoreLead} puan skor farkı`,
                `${Math.round(safety.oppositeSignalLockMs / 1000)} sn ters kilit`,
                `×${safety.reversalScoreMultiplier} ters skor`
            ].map(text => `<span>${this.escapeHtml(text)}</span>`).join('');
        }

        applySavedTheme() {
            const theme = localStorage.getItem(STORAGE.theme) || 'dark';
            document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
        }

        toggleTheme() {
            const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = next;
            localStorage.setItem(STORAGE.theme, next);
            this.chartManager.updateTheme();
            this.chartManager.setSignalMarkers(this.signals.filter(signal => signal.symbol === this.currentSymbol));
            if (this.heatmapManager.lastOrderBook) this.heatmapManager.draw(this.orderBook, this.marketData.price);
        }

        playSignal(direction) {
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return;
                const context = new AudioContext();
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                oscillator.type = direction === 'buy' ? 'triangle' : 'square';
                oscillator.frequency.value = direction === 'buy' ? 880 : 360;
                gain.gain.setValueAtTime(0.12, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);
                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.start();
                oscillator.stop(context.currentTime + 0.35);
                oscillator.addEventListener('ended', () => context.close());
            } catch (error) {
                console.debug('Sinyal sesi oynatılamadı:', error);
            }
        }

        notify(message, type = 'info') {
            const container = document.getElementById('notifications');
            const node = document.createElement('div');
            node.className = `notification ${type}`;
            node.textContent = message;
            container.prepend(node);
            window.setTimeout(() => {
                node.style.opacity = '0';
                node.style.transform = 'translateY(8px)';
                node.style.transition = 'opacity .25s, transform .25s';
                window.setTimeout(() => node.remove(), 260);
            }, 4500);
        }

        logToJournal(message) {
            console.info(`[UTC ${new Date().toLocaleTimeString('tr-TR')}] ${message}`);
        }

        formatPrice(price) {
            if (!finite(price)) return '—';
            const numeric = Number(price);
            const decimals = numeric > 1000 ? 2 : numeric > 1 ? 3 : numeric > 0.01 ? 4 : 6;
            return numeric.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        }

        formatVolume(volume) {
            if (!finite(volume)) return '—';
            const numeric = Number(volume);
            if (numeric >= 1e9) return `${(numeric / 1e9).toFixed(2)}B`;
            if (numeric >= 1e6) return `${(numeric / 1e6).toFixed(2)}M`;
            if (numeric >= 1e3) return `${(numeric / 1e3).toFixed(1)}K`;
            return numeric.toFixed(1);
        }

        setInput(id, value) {
            document.getElementById(id).value = value;
        }

        escapeHtml(value) {
            return String(value ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        saveData(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); }
            catch (error) { console.error('Veri kaydedilemedi:', error); }
        }

        loadData(key) {
            try {
                const value = localStorage.getItem(key);
                return value === null ? null : JSON.parse(value);
            } catch (error) {
                console.error('Kayıt okunamadı:', error);
                return null;
            }
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        try {
            window.app = new TradingScannerApp();
        } catch (error) {
            console.error('Uygulama başlatılamadı:', error);
            document.body.innerHTML = `<main style="padding:32px;font-family:monospace;color:#ff5f6d">Uygulama başlatılamadı: ${String(error.message || error)}</main>`;
        }
    });
})();
