(() => {
    'use strict';

    const STORAGE = {
        settings: 'utc_settings',
        signals: 'utc_signals',
        symbol: 'utc_current_symbol',
        timeframe: 'utc_current_timeframe',
        theme: 'utc_theme',
        mobileView: 'utc_mobile_view',
        visualView: 'utc_visual_view'
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

    const STRATEGY_EVIDENCE_FAMILIES = {
        wallBounce: 'microstructure',
        velocityScalping: 'momentum',
        rsiDivergence: 'mean-reversion',
        orderFlowMomentum: 'microstructure',
        liquidityGaps: 'microstructure',
        breakoutPattern: 'momentum',
        supportResistance: 'mean-reversion',
        fibonacciRetracement: 'mean-reversion',
        volumeProfile: 'momentum',
        smartMoneyConcepts: 'structure',
        divergenceDetection: 'mean-reversion',
        marketStructure: 'structure',
        institutionalOrderFlow: 'microstructure',
        microSpreadArbitrage: 'mean-reversion',
        vwapReversion: 'mean-reversion',
        superTrend: 'momentum'
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
    // Number(null) ve Number('') sıfır döndürür; fakat bunlar henüz piyasa
    // verisi gelmediğini ifade eder. Null değeri sayısal kabul etmek ilk render'da
    // toFixed çağrısının çökmesine neden olur.
    const finite = value => value !== null
        && value !== undefined
        && value !== ''
        && Number.isFinite(Number(value));

    const TIMEFRAME_MS = {
        '1m': 60_000,
        '5m': 5 * 60_000,
        '15m': 15 * 60_000,
        '1h': 60 * 60_000,
        '4h': 4 * 60 * 60_000
    };

    async function fetchWithTimeout(url, timeoutMs = 8000) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { signal: controller.signal, cache: 'no-store' });
        } finally {
            window.clearTimeout(timer);
        }
    }

    class ChartManager {
        constructor(containerId) {
            this.container = document.getElementById(containerId);
            this.chart = null;
            this.candles = null;
            this.volume = null;
            this.signalMarkers = [];
            this.resizeObserver = null;
            this.pricePrecision = 2;
            this.dataLength = 0;
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
            const isMobile = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches;
            const gridColor = document.documentElement.dataset.theme === 'light'
                ? 'rgba(102, 117, 138, 0.18)'
                : styles.getPropertyValue('--border').trim();
            return {
                width: Math.max(1, this.container.clientWidth),
                height: Math.max(1, this.container.clientHeight),
                layout: {
                    backgroundColor: 'transparent',
                    textColor: styles.getPropertyValue('--muted').trim(),
                    fontFamily: '"Roboto Mono", monospace',
                    fontSize: isMobile ? 11 : 10
                },
                grid: {
                    vertLines: { color: gridColor },
                    horzLines: { color: gridColor }
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
                priceFormat: {
                    type: 'price',
                    precision: this.pricePrecision,
                    minMove: 10 ** -this.pricePrecision
                }
            };
        }

        updatePriceFormat(price) {
            if (!finite(price)) return;
            const numeric = Math.abs(Number(price));
            const precision = numeric >= 100 ? 2 : numeric >= 1 ? 3 : numeric >= 0.01 ? 4 : 6;
            if (precision === this.pricePrecision) return;
            this.pricePrecision = precision;
            if (this.candles) this.candles.applyOptions(this.candleOptions());
        }

        focusLatest() {
            if (!this.dataLength) return;
            const width = this.container.clientWidth || window.innerWidth || 390;
            const targetBars = width <= 360
                ? 42
                : width <= 480
                    ? 54
                    : width <= 720
                        ? 72
                        : width <= 1100
                            ? 110
                            : 150;
            const visibleBars = Math.min(targetBars, this.dataLength);
            const rightOffset = width <= 480 ? 4 : 7;
            this.chart.timeScale().setVisibleLogicalRange({
                from: Math.max(0, this.dataLength - visibleBars),
                to: this.dataLength + rightOffset
            });
        }

        updateTheme() {
            this.chart.applyOptions(this.chartOptions());
            this.candles.applyOptions(this.candleOptions());
        }

        setData(candles) {
            this.dataLength = candles.length;
            if (candles.length) this.updatePriceFormat(candles.at(-1).close);
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
            if (candles.length) this.focusLatest();
        }

        updateRealtime(candle) {
            this.updatePriceFormat(candle.close);
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
            this.focusLatest();
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
            this.ctx.strokeStyle = styles.getPropertyValue('--primary').trim();
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(0, half);
            this.ctx.lineTo(this.width, half);
            this.ctx.stroke();
            this.ctx.lineWidth = 1;

            const labelLeft = Math.max(0, this.width - 58);
            this.ctx.fillStyle = styles.getPropertyValue('--panel').trim();
            this.ctx.fillRect(labelLeft, half - 18, 54, 15);
            this.ctx.fillRect(labelLeft, half + 3, 54, 15);
            this.ctx.font = '600 10px "Roboto Mono"';
            this.ctx.textAlign = 'right';
            this.ctx.fillStyle = styles.getPropertyValue('--negative').trim();
            this.ctx.fillText('SATIŞ', this.width - 9, half - 7);
            this.ctx.fillStyle = styles.getPropertyValue('--positive').trim();
            this.ctx.fillText('ALIŞ', this.width - 9, half + 14);
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
                const barWidth = this.width * intensity;
                const barX = type === 'ask' ? this.width - barWidth : 0;
                this.ctx.fillStyle = `rgba(${red}, ${0.08 + intensity * 0.5})`;
                this.ctx.fillRect(barX, y, barWidth, Math.max(height, 1));

                if (index % skip === 0) {
                    this.ctx.fillStyle = textColor;
                    this.ctx.font = `${this.width <= 720 ? 10 : 9}px "Roboto Mono"`;
                    this.ctx.textAlign = 'left';
                    const labelHeight = height * skip;
                    this.ctx.fillText(
                        `${quantity.toFixed(3)} @ ${price.toFixed(decimals)}`,
                        9,
                        y + Math.max(9, Math.min(12, labelHeight - 2))
                    );
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
        constructor(bot, name, family = 'candle') {
            this.bot = bot;
            this.name = name;
            this.family = family;
            this.evidenceFamily = STRATEGY_EVIDENCE_FAMILIES[name] || 'other';
            this.displayName = STRATEGY_LABELS[name] || name;
            this.lastProposalTime = Object.create(null);
            this.lastProposalCandle = Object.create(null);
        }

        propose(direction, reason, score) {
            const symbol = this.bot.currentSymbol;
            const now = Date.now();
            const context = this.bot.adaptiveLearning.getContext(symbol, this.bot.currentTimeframe);

            if (this.family === 'candle') {
                // Mum stratejileri aynı kapanmış mum için yalnızca bir oy verebilir.
                // Milisaniye cooldown yerine veri periyoduyla senkron çalışır.
                const candleTime = this.bot.getClosedCandles().at(-1)?.time;
                if (!candleTime || this.lastProposalCandle[symbol] === candleTime) return;
                this.lastProposalCandle[symbol] = candleTime;
            } else {
                const baseCooldown = this.bot.settings.cooldowns.strategyProposalMs ?? 10000;
                const cooldown = this.bot.adaptiveLearning.getStrategyCooldown(
                    this.name,
                    context,
                    baseCooldown,
                    this.family
                );
                // Mikro-yapı stratejileri yön değiştirerek birkaç saniyede kendi
                // oyunu tersine çeviremez. Cooldown yön değil sembol bazındadır.
                if (now - (this.lastProposalTime[symbol] || 0) < cooldown) return;
                this.lastProposalTime[symbol] = now;
            }

            this.bot.handleStrategyProposal(this, direction, reason, score);
        }

        analyzeOrderBook() {}
        processTrade() {}
        periodicAnalyze() {}
    }

    class WallBounceStrategy extends Strategy {
        constructor(bot) {
            super(bot, 'wallBounce', 'micro');
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
            super(bot, 'velocityScalping', 'micro');
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
            super(bot, 'orderFlowMomentum', 'micro');
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
            super(bot, 'liquidityGaps', 'micro');
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
        constructor(bot) { super(bot, 'institutionalOrderFlow', 'micro'); }
        analyzeOrderBook(orderBook) {
            if (!orderBook.bids.length || !orderBook.asks.length) return;
            const bids = orderBook.bids.slice(0, 5).reduce((sum, [, qty]) => sum + qty, 0);
            const asks = orderBook.asks.slice(0, 5).reduce((sum, [, qty]) => sum + qty, 0);
            if (bids / Math.max(asks, 1e-8) > 2) this.propose('buy', 'Bid ağırlıklı emir defteri', 3);
            else if (asks / Math.max(bids, 1e-8) > 2) this.propose('sell', 'Ask ağırlıklı emir defteri', 3);
        }
    }

    class MicroSpreadArbitrageStrategy extends Strategy {
        constructor(bot) { super(bot, 'microSpreadArbitrage', 'micro'); }
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
            const savedMobileView = this.loadData(STORAGE.mobileView);
            this.mobileView = ['home', 'market', 'signals', 'learning'].includes(savedMobileView) ? savedMobileView : 'home';
            this.visualView = this.loadData(STORAGE.visualView) === 'heatmap' ? 'heatmap' : 'chart';
            document.body.dataset.mobileView = this.mobileView;
            this.settings = this.loadSettings();
            this.signals = this.loadData(STORAGE.signals) || [];
            this.candles = [];
            this.orderBook = { bids: [], asks: [] };
            this.marketData = { price: null, btcPrice: null, change24h: null, volume24h: null };
            this.indicators = { rsi: [], atr: null, sma20: null, sma50: null, vwap: null };
            this.strategies = {};
            this.activeStrategies = {};
            this.socket = null;
            this.depthSocket = null;
            this.reconnectTimer = null;
            this.depthReconnectTimer = null;
            this.reconnectAttempts = 0;
            this.depthReconnectAttempts = 0;
            this.lastMarketMessageAt = 0;
            this.lastTradeAt = 0;
            this.lastTradePrice = null;
            this.lastClosedCandleEventTime = 0;
            this.priceRenderFrame = null;
            this.commandRenderFrame = null;
            this.connectionWatchTimer = null;
            this.commandCenterTimer = null;
            this.renderTimer = null;
            this.analysisTimer = null;
            this.isRunning = false;
            this.commandTelemetry = {
                eventSequence: 0,
                tradeCount: 0,
                tradesInWindow: 0,
                recentTradeTimes: [],
                tradeRate: 0,
                depthCount: 0,
                klineCount: 0,
                closedCandleCount: 0,
                indicatorUpdates: 0,
                analysisCycles: 0,
                proposalCount: 0,
                confluenceCount: 0,
                signalCount: 0,
                strategyErrors: 0,
                lastTradeAt: 0,
                lastDepthAt: 0,
                lastKlineAt: 0,
                lastProposalAt: 0,
                lastDecision: 'BEKLEMEDE',
                lastDecisionAt: 0,
                lastRateSampleAt: Date.now()
            };

            this.applySavedTheme();
            this.chartManager = new ChartManager('live-chart');
            this.heatmapManager = new HeatmapManager('orderbook-heatmap');
            if (!window.UTCAdaptive) throw new Error('Adaptif öğrenme modülü yüklenemedi.');
            if (!window.UTCMarketQuality) throw new Error('Piyasa kalite modülü yüklenemedi.');
            this.eventBus = new window.UTCAdaptive.EventBus({ historyLimit: 400 });
            this.adaptiveLearning = new window.UTCAdaptive.AdaptiveLearningEngine(this, { eventBus: this.eventBus });
            this.marketQualityEngine = new window.UTCMarketQuality.MarketQualityEngine(this, { eventBus: this.eventBus });
            this.confluenceEngine = new window.ConfluenceEngine(this);
            this.initStrategies();
            this.bindCommandCenterEvents();
            this.learningReady = this.adaptiveLearning.initialize();
            this.bindLearningEvents();
            this.bindEvents();
            this.syncControls();
            this.setMobileView(this.mobileView, { persist: false, scroll: false });
            this.switchView(this.visualView, { persist: false });
            this.renderAll();
            this.renderSafetyChips();
            this.renderLearning();
            this.renderCommandCenter();
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
                    minIndependentFamilies: 2,
                    maxFamilyContributionRatio: 0.60,
                    preventSignalsWhileActive: true,
                    oppositeSignalLockMs: 120000,
                    minReversalConfirmations: 2,
                    reversalScoreMultiplier: 1.25,
                    reverseHysteresisPoints: 2,
                    minConvictionWindows: 2,
                    minReversalConvictionWindows: 3,
                    minConvictionMs: 600,
                    minReversalConvictionMs: 1200,
                    convictionWindowMs: 700,
                    convictionAlpha: 0.35,
                    reversalAtrInvalidation: 0.5,
                    requireClosedCandleForReversal: false,
                    blockedNoticeThrottleMs: 10000
                },
                learning: {
                    minSamples: 20,
                    optimizeEvery: 5,
                    minWeight: 0.65,
                    maxWeight: 1.35,
                    shadowEnabled: true,
                    shadowInfluence: 0.35,
                    maxShadowTrades: 120
                },
                marketQuality: {
                    enabled: true,
                    requireDepth: true,
                    maxTradeAgeMs: 3000,
                    maxDepthAgeMs: 2000,
                    maxTransportLagMs: 2000,
                    maxSpreadBps: 8,
                    minDepthUsd: 50000,
                    criticalSpreadMultiplier: 2,
                    criticalDepthRatio: 0.5,
                    shockMoveBps: 40,
                    shockWindowMs: 3000,
                    shockPauseMs: 120000
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
                learning: { ...defaults.learning, ...(saved.learning || {}) },
                marketQuality: { ...defaults.marketQuality, ...(saved.marketQuality || {}) },
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
            this.queueCommandCenterRender();
        }

        bindCommandCenterEvents() {
            this.eventBus.onAny(envelope => {
                this.commandTelemetry.eventSequence = envelope.id;
                if (!['market.trade', 'market.price', 'market.orderbook', 'market.candle.updated'].includes(envelope.event)) {
                    this.queueCommandCenterRender();
                }
            });

            this.eventBus.on('market.price', payload => {
                if (!payload || payload.symbol !== this.currentSymbol) return;
                this.checkAutoCloseSignals();
                this.queuePriceRender();
            });
            this.eventBus.on('market.ticker', payload => {
                if (!payload || payload.symbol !== this.currentSymbol) return;
                this.queuePriceRender();
            });
            this.eventBus.on('market.candle.updated', payload => {
                if (!payload || payload.symbol !== this.currentSymbol || !payload.candle) return;
                this.chartManager.dataLength = this.candles.length;
                this.chartManager.updateRealtime(payload.candle);
                document.getElementById('chart-empty').classList.add('hidden');
            });
            this.eventBus.on('market.trade', payload => {
                if (!payload || payload.symbol !== this.currentSymbol) return;
                this.dispatchStrategies('processTrade', payload.trade, 'market.trade');
            });
            this.eventBus.on('market.orderbook', payload => {
                if (!payload || payload.symbol !== this.currentSymbol) return;
                this.heatmapManager.draw(payload.orderBook, this.marketData.price);
                document.getElementById('heatmap-empty').classList.toggle('hidden', payload.orderBook.bids.length > 0);
                this.dispatchStrategies('analyzeOrderBook', payload.orderBook, 'market.orderbook');
            });
            this.eventBus.on('analysis.tick', payload => {
                if (!this.isRunning || (payload?.symbol && payload.symbol !== this.currentSymbol)) return;
                this.commandTelemetry.analysisCycles += 1;
                this.dispatchStrategies('periodicAnalyze', payload, 'analysis.tick');
            });
            this.eventBus.on('market.candle.closed', payload => {
                if (!payload || payload.symbol !== this.currentSymbol) return;
                this.eventBus.emit('market.regime.check', {
                    symbol: payload.symbol,
                    timeframe: payload.timeframe,
                    trigger: 'candle-close'
                });
                this.eventBus.emit('analysis.tick', {
                    symbol: payload.symbol,
                    timeframe: payload.timeframe,
                    trigger: 'candle-close'
                });
            });
            this.eventBus.on('proposal.created', () => {
                this.commandTelemetry.proposalCount += 1;
                this.commandTelemetry.lastProposalAt = Date.now();
            });
            this.eventBus.on('confluence.evaluated', result => {
                this.commandTelemetry.confluenceCount += 1;
                this.commandTelemetry.lastDecision = result?.status === 'blocked' && result?.marketQuality
                    ? 'ENGEL: PİYASA KALİTESİ'
                    : this.decisionLabel(result?.status);
                this.commandTelemetry.lastDecisionAt = Date.now();
            });
            this.eventBus.on('signal.generated', () => {
                this.commandTelemetry.signalCount += 1;
                this.commandTelemetry.lastDecision = 'SİNYAL ÜRETİLDİ';
                this.commandTelemetry.lastDecisionAt = Date.now();
            });
            this.eventBus.on('signal.blocked', payload => {
                this.commandTelemetry.lastDecision = payload?.marketQuality
                    ? 'ENGEL: PİYASA KALİTESİ'
                    : `ENGEL: ${this.decisionLabel(payload?.reason)}`;
                this.commandTelemetry.lastDecisionAt = Date.now();
            });
            this.eventBus.on('strategy.error', payload => {
                this.commandTelemetry.strategyErrors += 1;
                this.commandTelemetry.lastDecision = `HATA: ${payload?.strategy || 'STRATEJİ'}`;
                this.commandTelemetry.lastDecisionAt = Date.now();
            });
        }

        dispatchStrategies(method, payload, sourceEvent) {
            Object.values(this.strategies).forEach(strategy => {
                if (typeof strategy[method] !== 'function') return;
                try {
                    strategy[method](payload);
                } catch (error) {
                    console.error(`[Strategy:${strategy.name}:${method}]`, error);
                    this.eventBus.emit('strategy.error', {
                        strategy: strategy.name,
                        method,
                        sourceEvent,
                        message: error.message,
                        timestamp: Date.now()
                    });
                }
            });
        }

        resetCommandTelemetry() {
            Object.assign(this.commandTelemetry, {
                tradeCount: 0,
                tradesInWindow: 0,
                recentTradeTimes: [],
                tradeRate: 0,
                depthCount: 0,
                klineCount: 0,
                closedCandleCount: 0,
                indicatorUpdates: 0,
                analysisCycles: 0,
                proposalCount: 0,
                confluenceCount: 0,
                signalCount: 0,
                strategyErrors: 0,
                lastTradeAt: 0,
                lastDepthAt: 0,
                lastKlineAt: 0,
                lastProposalAt: 0,
                lastDecision: 'BEKLEMEDE',
                lastDecisionAt: 0,
                lastRateSampleAt: Date.now()
            });
            this.renderCommandCenter();
        }

        startCommandCenterClock() {
            window.clearInterval(this.commandCenterTimer);
            this.commandTelemetry.lastRateSampleAt = Date.now();
            this.commandCenterTimer = window.setInterval(() => {
                const now = Date.now();
                this.commandTelemetry.recentTradeTimes = this.commandTelemetry.recentTradeTimes
                    .filter(timestamp => now - timestamp <= 5000);
                const oldest = this.commandTelemetry.recentTradeTimes[0] || now;
                const windowSeconds = Math.min(5, Math.max((now - oldest) / 1000, 1));
                this.commandTelemetry.tradeRate = this.commandTelemetry.recentTradeTimes.length / windowSeconds;
                this.commandTelemetry.tradesInWindow = 0;
                this.commandTelemetry.lastRateSampleAt = now;
                this.marketQualityEngine.tick(now);
                this.renderCommandCenter();
            }, 1000);
        }

        queueCommandCenterRender() {
            if (this.commandRenderFrame !== null || typeof window.requestAnimationFrame !== 'function') return;
            this.commandRenderFrame = -1;
            const frame = window.requestAnimationFrame(() => {
                this.commandRenderFrame = null;
                this.renderCommandCenter();
            });
            if (this.commandRenderFrame !== null) this.commandRenderFrame = frame;
        }

        decisionLabel(status) {
            const labels = {
                empty: 'TEKLİF YOK',
                conflict: 'ÇATIŞMA',
                'below-threshold': 'EŞİK ALTI',
                'awaiting-confirmation': 'TEYİT BEKLİYOR',
                'awaiting-family-diversity': 'AİLE TEYİDİ',
                'awaiting-conviction': 'KARAR OLUŞUYOR',
                generated: 'SİNYAL ÜRETİLDİ',
                blocked: 'ENGELLENDİ',
                signal: 'SİNYAL',
                'active-signal-lock': 'AKTİF KİLİT',
                'signal-cooldown': 'COOLDOWN',
                'same-direction-cooldown': 'YÖN COOLDOWN'
            };
            return labels[status] || String(status || 'BEKLEMEDE').replaceAll('-', ' ').toUpperCase();
        }

        ageLabel(timestamp) {
            if (!timestamp) return 'Veri yok';
            const ageMs = Math.max(0, Date.now() - timestamp);
            if (ageMs < 1000) return `${Math.max(0, Math.round(ageMs))} ms`;
            return `${(ageMs / 1000).toFixed(ageMs < 10_000 ? 1 : 0)} sn`;
        }

        marketQualityLabel(status) {
            const labels = {
                healthy: 'SAĞLIKLI',
                degraded: 'TEMKİNLİ',
                stale: 'BAYAT VERİ',
                shock: 'ŞOK KİLİDİ',
                invalid: 'GEÇERSİZ',
                waiting: 'BEKLENİYOR',
                disabled: 'KAPALI',
                stopped: 'DURDURULDU'
            };
            return labels[status] || 'BEKLENİYOR';
        }

        compactUsd(value) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return '—';
            if (numeric >= 1e9) return `$${(numeric / 1e9).toFixed(1)}B`;
            if (numeric >= 1e6) return `$${(numeric / 1e6).toFixed(1)}M`;
            if (numeric >= 1e3) return `$${(numeric / 1e3).toFixed(0)}K`;
            return `$${Math.round(numeric)}`;
        }

        renderCommandCenter() {
            const health = document.getElementById('command-health');
            if (!health) return;
            const telemetry = this.commandTelemetry;
            const now = Date.now();
            const quality = this.marketQualityEngine.getSnapshot(now);
            const tradeAge = telemetry.lastTradeAt ? now - telemetry.lastTradeAt : Infinity;
            const marketAge = telemetry.lastKlineAt ? now - telemetry.lastKlineAt : Infinity;
            const depthAge = telemetry.lastDepthAt ? now - telemetry.lastDepthAt : Infinity;
            let healthText = 'BEKLEMEDE';
            let healthClass = 'waiting';
            if (!this.isRunning) {
                healthText = 'DURDURULDU';
            } else if (telemetry.strategyErrors > 0) {
                healthText = 'STRATEJİ HATASI';
                healthClass = 'degraded';
            } else if (quality.enabled && quality.blockNewSignals) {
                if (quality.status === 'waiting') {
                    healthText = 'VERİ BEKLENİYOR';
                    healthClass = 'waiting';
                } else {
                    healthText = quality.status === 'shock' ? 'ŞOK KİLİDİ' : 'PİYASA KİLİDİ';
                    healthClass = 'degraded';
                }
            } else if (quality.status === 'degraded') {
                healthText = 'KALİTE UYARISI';
                healthClass = 'degraded';
            } else if (tradeAge < 3000 && marketAge < 5000 && depthAge < 5000) {
                healthText = 'TÜM SİSTEM CANLI';
                healthClass = 'live';
            } else if (tradeAge < 5000 || marketAge < 5000) {
                healthText = 'KISMİ AKIŞ';
                healthClass = 'degraded';
            } else {
                healthText = 'VERİ BEKLENİYOR';
                healthClass = 'waiting';
            }
            health.textContent = healthText;
            health.className = `stream-health ${healthClass}`;

            document.getElementById('command-trade-rate').textContent = `${telemetry.tradeRate.toFixed(1)}/sn`;
            document.getElementById('command-trade-age').textContent = `Son: ${this.ageLabel(telemetry.lastTradeAt)}`;
            document.getElementById('command-market-sync').textContent = `${telemetry.klineCount} / ${telemetry.depthCount}`;
            document.getElementById('command-market-age').textContent = `M ${this.ageLabel(telemetry.lastKlineAt)} · D ${this.ageLabel(telemetry.lastDepthAt)}`;
            const qualityElement = document.getElementById('command-market-quality');
            qualityElement.textContent = this.marketQualityLabel(quality.status);
            qualityElement.className = `quality-state ${quality.status}`;
            const qualityDetail = document.getElementById('command-market-quality-detail');
            qualityDetail.textContent = quality.primaryReason
                ? quality.primaryReason.message
                : `Spread ${quality.spreadBps === null ? '—' : `${quality.spreadBps.toFixed(2)} bp`} · Derinlik ${this.compactUsd(quality.minDepthUsd)}`;
            qualityDetail.title = quality.reasons.length
                ? quality.reasons.map(reason => reason.message).join(' · ')
                : qualityDetail.textContent;
            document.getElementById('command-strategy-state').textContent = `${Object.keys(this.activeStrategies).length} / ${Object.keys(this.strategies).length}`;
            document.getElementById('command-proposal-count').textContent = telemetry.strategyErrors
                ? `${telemetry.proposalCount} teklif · ${telemetry.strategyErrors} hata`
                : `${telemetry.proposalCount} teklif · ${telemetry.analysisCycles} tur`;
            document.getElementById('command-decision').textContent = telemetry.lastDecision;
            document.getElementById('command-event-sequence').textContent = `Olay #${telemetry.eventSequence} · ${telemetry.confluenceCount} karar`;
        }

        handleStrategyProposal(strategy, direction, reason, baseScore) {
            const regime = this.adaptiveLearning.currentRegime;
            const context = this.adaptiveLearning.getContext(this.currentSymbol, this.currentTimeframe);
            const proposal = {
                strategy: strategy.name,
                family: strategy.family,
                evidenceFamily: strategy.evidenceFamily,
                symbol: this.currentSymbol,
                timeframe: this.currentTimeframe,
                direction,
                reason,
                score: Number(baseScore),
                price: this.marketData.price,
                regime,
                context,
                timestamp: Date.now(),
                contributesToSignal: Boolean(this.activeStrategies[strategy.name])
            };

            // Aktif veya pasif tüm stratejiler shadow olarak ölçülür. Yalnızca
            // kullanıcı tarafından aktif edilen stratejiler nihai sinyale oy verir.
            this.adaptiveLearning.observeProposal(proposal);
            if (!proposal.contributesToSignal) return;

            const adaptiveWeight = this.adaptiveLearning.getWeight(strategy.name, context);
            const regimeFactor = this.adaptiveLearning.getRegimeFactor(strategy.evidenceFamily);
            const effectiveScore = Math.round(Number(baseScore) * adaptiveWeight * regimeFactor * 100) / 100;
            this.confluenceEngine.propose(strategy.name, direction, reason, effectiveScore, {
                baseScore: Number(baseScore),
                adaptiveWeight,
                regimeFactor,
                context,
                regime,
                family: strategy.family,
                evidenceFamily: strategy.evidenceFamily,
                timeframe: this.currentTimeframe
            });
        }

        bindLearningEvents() {
            const render = () => this.renderLearning();
            this.eventBus.on('learning.ready', render);
            this.eventBus.on('learning.updated', render);
            this.eventBus.on('learning.reset', render);
            this.eventBus.on('optimizer.updated', render);
            this.eventBus.on('market.regime.changed', render);

            document.getElementById('learning-mode').addEventListener('change', event => {
                this.adaptiveLearning.setMode(event.target.value);
                this.notify(`Öğrenme modu: ${event.target.options[event.target.selectedIndex].text}`, 'info');
            });
            document.getElementById('export-learning-btn').addEventListener('click', () => this.exportLearningData());
            document.getElementById('reset-learning-btn').addEventListener('click', async () => {
                if (!window.confirm('Tüm adaptif strateji istatistikleri ve shadow işlemleri silinsin mi?')) return;
                await this.adaptiveLearning.reset();
                this.notify('Adaptif öğrenme verileri sıfırlandı.', 'warning');
            });
        }

        bindEvents() {
            document.getElementById('start-btn').addEventListener('click', () => this.start());
            document.getElementById('stop-btn').addEventListener('click', () => this.stop());
            document.getElementById('theme-btn').addEventListener('click', () => this.toggleTheme());
            document.getElementById('settings-btn').addEventListener('click', () => this.openSettings());
            document.querySelectorAll('#mobile-tabbar [data-mobile-view]').forEach(tab => {
                tab.addEventListener('click', () => this.setMobileView(tab.dataset.mobileView));
            });
            document.getElementById('mobile-settings-tab').addEventListener('click', event => {
                event.currentTarget.classList.add('active');
                event.currentTarget.setAttribute('aria-selected', 'true');
                this.openSettings();
            });
            document.getElementById('settings-dialog').addEventListener('close', () => this.syncMobileTabs());
            document.getElementById('clear-signals-btn').addEventListener('click', () => this.clearSignals());
            document.getElementById('active-contributors-btn').addEventListener('click', () => {
                const active = this.signals.find(signal => signal.symbol === this.currentSymbol && signal.status === 'active');
                if (active) this.openSignalDetail(active.id);
            });
            document.getElementById('signals-body').addEventListener('click', event => {
                const row = event.target.closest ? event.target.closest('[data-signal-id]') : null;
                if (row) this.openSignalDetail(row.dataset.signalId);
            });
            document.getElementById('close-signal-detail-btn').addEventListener('click', () => {
                document.getElementById('signal-detail-dialog').close();
            });

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
            document.querySelectorAll('[data-settings-target]').forEach(button => {
                button.addEventListener('click', () => this.scrollSettingsTo(button.dataset.settingsTarget));
            });

            window.addEventListener('online', () => {
                if (this.isRunning && (!this.socket || this.socket.readyState > 1)) this.connectWebSocket(true);
            });
            window.addEventListener('offline', () => this.updateConnection(false, 'İNTERNET YOK'));
            window.addEventListener('resize', () => {
                if (this.mobileView === 'market') this.resizeActiveVisual();
            });
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
            const startButton = document.getElementById('start-btn');
            startButton.disabled = true;
            startButton.textContent = 'Başlatılıyor…';
            document.getElementById('stop-btn').disabled = false;
            this.updateConnection(false, 'BAĞLANIYOR');
            this.resetCommandTelemetry();
            this.startCommandCenterClock();
            this.eventBus.emit('system.started', {
                symbol: this.currentSymbol,
                timeframe: this.currentTimeframe,
                timestamp: Date.now()
            });
            this.notify('Sistem başlatılıyor; öğrenme durumu ve piyasa verisi yükleniyor.', 'success');

            await this.learningReady;
            if (!this.isRunning) return;

            // Gerçek zamanlı akış REST geçmiş verisini beklemez. Böylece REST bölgesel
            // olarak yavaş veya erişilemez olsa bile trade fiyatı ve canlı mum başlar.
            const initialRequestStartedAt = Date.now();
            this.connectWebSocket(false);
            this.startConnectionWatch();
            await this.fetchInitialData(initialRequestStartedAt);
            if (!this.isRunning) return;
            this.renderTimer = window.setInterval(() => this.renderPrice(), 1000);
            this.analysisTimer = window.setInterval(() => this.runPeriodicAnalysis(), 5000);
        }

        stop(options = {}) {
            if (!this.isRunning && !this.socket && !this.depthSocket) return;
            this.isRunning = false;
            const startButton = document.getElementById('start-btn');
            startButton.disabled = false;
            startButton.textContent = 'Sistemi Başlat';
            document.getElementById('stop-btn').disabled = true;
            window.clearInterval(this.renderTimer);
            window.clearInterval(this.analysisTimer);
            window.clearInterval(this.connectionWatchTimer);
            window.clearInterval(this.commandCenterTimer);
            if (this.priceRenderFrame !== null) window.cancelAnimationFrame(this.priceRenderFrame);
            if (this.commandRenderFrame !== null) window.cancelAnimationFrame(this.commandRenderFrame);
            this.renderTimer = null;
            this.analysisTimer = null;
            this.connectionWatchTimer = null;
            this.commandCenterTimer = null;
            this.priceRenderFrame = null;
            this.commandRenderFrame = null;
            this.disconnectWebSocket();
            this.updateConnection(false, 'DURDURULDU');
            this.eventBus.emit('system.stopped', {
                symbol: this.currentSymbol,
                timeframe: this.currentTimeframe,
                timestamp: Date.now()
            });
            this.renderCommandCenter();
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
            this.eventBus.emit('market.changed', {
                symbol,
                timeframe,
                timestamp: Date.now()
            });
            this.notify(`${symbol.replace('USDT', '/USDT')} · ${timeframe} seçildi.`, 'info');
            if (shouldRestart) await this.start();
        }

        resetMarketData() {
            this.confluenceEngine.reset();
            this.candles = [];
            this.orderBook = { bids: [], asks: [] };
            this.marketData = { price: null, btcPrice: null, change24h: null, volume24h: null };
            this.lastMarketMessageAt = 0;
            this.lastTradeAt = 0;
            this.lastTradePrice = null;
            this.lastClosedCandleEventTime = 0;
            this.indicators = { rsi: [], atr: null, sma20: null, sma50: null, vwap: null };
            this.chartManager.setData([]);
            this.chartManager.setSignalMarkers([]);
            this.heatmapManager.lastOrderBook = null;
            this.heatmapManager.clear();
            document.getElementById('chart-empty').classList.remove('hidden');
            document.getElementById('heatmap-empty').classList.remove('hidden');
            this.renderAll();
        }

        async fetchInitialData(requestStartedAt = Date.now()) {
            const requestedSymbol = this.currentSymbol;
            const requestedTimeframe = this.currentTimeframe;
            const symbol = encodeURIComponent(requestedSymbol);
            const timeframe = encodeURIComponent(requestedTimeframe);
            const candlesEndpoint = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=500`;
            const tickerEndpoint = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`;
            const [candlesResult, tickerResult] = await Promise.allSettled([
                fetchWithTimeout(candlesEndpoint),
                fetchWithTimeout(tickerEndpoint)
            ]);
            if (!this.isRunning || requestedSymbol !== this.currentSymbol || requestedTimeframe !== this.currentTimeframe) return;

            let loadedHistory = false;
            if (candlesResult.status === 'fulfilled' && candlesResult.value.ok) {
                try {
                    const rows = await candlesResult.value.json();
                    if (!Array.isArray(rows)) throw new Error('Beklenmeyen Binance yanıtı');
                    const now = Date.now();
                    const streamedCandle = this.lastMarketMessageAt > requestStartedAt
                        ? this.candles.at(-1)
                        : null;
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
                    if (streamedCandle && streamedCandle.time >= (this.candles.at(-1)?.time || 0)) {
                        this.upsertCandle(streamedCandle);
                    }
                    if (this.lastTradeAt > requestStartedAt && finite(this.lastTradePrice)) {
                        this.mergeTradeIntoCandle(this.lastTradePrice, this.lastTradeAt, 0, false);
                    }
                    this.calculateIndicators('initial-history');
                    this.chartManager.setData(this.candles);
                    this.chartManager.setSignalMarkers(this.signals.filter(signal => signal.symbol === this.currentSymbol));
                    document.getElementById('chart-empty').classList.toggle('hidden', this.candles.length > 0);
                    loadedHistory = true;
                    this.eventBus.emit('market.history.loaded', {
                        symbol: this.currentSymbol,
                        timeframe: this.currentTimeframe,
                        candles: this.candles.length,
                        timestamp: Date.now()
                    });
                } catch (error) {
                    console.warn('Geçmiş mum verisi okunamadı:', error);
                }
            }

            let tickerData = null;
            if (tickerResult.status === 'fulfilled' && tickerResult.value.ok) {
                try {
                    const payload = await tickerResult.value.json();
                    if (payload && !Array.isArray(payload)) tickerData = payload;
                } catch (error) {
                    console.warn('24 saat ticker verisi okunamadı:', error);
                }
            }

            if (tickerData) {
                this.marketData.change24h = finite(tickerData.P) ? Number(tickerData.P) : this.marketData.change24h;
                this.marketData.volume24h = finite(tickerData.q) ? Number(tickerData.q) : this.marketData.volume24h;
                if (this.lastTradeAt <= requestStartedAt && finite(tickerData.c)) {
                    this.setLivePrice(Number(tickerData.c), Date.now(), 'rest', { updateCandle: false });
                }
                this.eventBus.emit('market.ticker', {
                    symbol: this.currentSymbol,
                    change24h: this.marketData.change24h,
                    volume24h: this.marketData.volume24h,
                    source: 'rest',
                    timestamp: Date.now()
                });
            }

            const latestCandle = this.candles.at(-1);
            if (!finite(this.marketData.price) && latestCandle && finite(latestCandle.close)) {
                this.setLivePrice(Number(latestCandle.close), Date.now(), 'rest', { updateCandle: false });
            }
            if (this.currentSymbol === 'BTCUSDT' && finite(this.marketData.price)) {
                this.marketData.btcPrice = this.marketData.price;
            }
            this.renderPrice();

            if (!loadedHistory) {
                const reason = candlesResult.status === 'rejected'
                    ? candlesResult.reason?.message
                    : `Binance HTTP ${candlesResult.value?.status || 'hatası'}`;
                console.warn('Geçmiş veri alınamadı:', reason);
                this.eventBus.emit('feed.error', {
                    channel: 'history',
                    reason,
                    timestamp: Date.now()
                });
                this.notify('Geçmiş mumlar yüklenemedi; canlı trade akışıyla devam ediliyor.', 'warning');
            }
        }

        connectWebSocket(isReconnect) {
            if (!this.isRunning) return;
            this.disconnectWebSocket();
            if (!isReconnect) this.reconnectAttempts = 0;

            const lower = this.currentSymbol.toLowerCase();
            const marketStreams = [
                `${lower}@aggTrade`,
                `${lower}@ticker`,
                `${lower}@kline_${this.currentTimeframe}`
            ];
            if (lower !== 'btcusdt') marketStreams.push('btcusdt@aggTrade');

            // Binance, 23 Nisan 2026'da eski yönlendirilmemiş /stream adresini
            // kapattı. Trade/kline/ticker artık /market yolundan bağlanmalıdır.
            const socket = new WebSocket(
                `wss://fstream.binance.com/market/stream?streams=${marketStreams.join('/')}`
            );
            this.socket = socket;
            this.marketSocketOpenedAt = Date.now();

            socket.addEventListener('open', () => {
                if (socket !== this.socket) return;
                this.reconnectAttempts = 0;
                this.marketSocketOpenedAt = Date.now();
                document.getElementById('start-btn').textContent = 'Çalışıyor';
                this.updateConnection(false, 'AKIŞ BEKLENİYOR');
                this.eventBus.emit('feed.connected', { channel: 'market', timestamp: Date.now() });
            });
            socket.addEventListener('message', event => {
                if (socket !== this.socket) return;
                try {
                    const message = JSON.parse(event.data);
                    this.lastMarketMessageAt = Date.now();
                    this.updateConnection(true, 'CANLI');
                    this.handleMarketData(message.stream, message.data);
                } catch (error) {
                    console.error('WebSocket verisi işlenemedi:', error);
                }
            });
            socket.addEventListener('error', () => {
                if (socket !== this.socket) return;
                this.updateConnection(false, 'BAĞLANTI HATASI');
                this.eventBus.emit('feed.error', { channel: 'market', timestamp: Date.now() });
            });
            socket.addEventListener('close', () => {
                if (socket !== this.socket || !this.isRunning) return;
                this.eventBus.emit('feed.disconnected', { channel: 'market', timestamp: Date.now() });
                this.socket = null;
                this.closeDepthSocket();
                this.reconnectAttempts += 1;
                const delay = Math.min(30000, 3000 * 2 ** Math.min(this.reconnectAttempts - 1, 4));
                this.updateConnection(false, `${Math.round(delay / 1000)} SN SONRA TEKRAR`);
                this.reconnectTimer = window.setTimeout(() => this.connectWebSocket(true), delay);
            });

            this.connectDepthWebSocket();
        }

        connectDepthWebSocket() {
            if (!this.isRunning) return;
            window.clearTimeout(this.depthReconnectTimer);
            this.depthReconnectTimer = null;
            this.closeDepthSocket();

            const lower = this.currentSymbol.toLowerCase();
            const socket = new WebSocket(
                `wss://fstream.binance.com/public/stream?streams=${lower}@depth20@100ms`
            );
            this.depthSocket = socket;

            socket.addEventListener('open', () => {
                if (socket !== this.depthSocket) return;
                this.depthReconnectAttempts = 0;
                this.eventBus.emit('feed.connected', { channel: 'depth', timestamp: Date.now() });
            });
            socket.addEventListener('message', event => {
                if (socket !== this.depthSocket) return;
                try {
                    const message = JSON.parse(event.data);
                    this.handleMarketData(message.stream, message.data);
                } catch (error) {
                    console.error('Depth WebSocket verisi işlenemedi:', error);
                }
            });
            socket.addEventListener('error', () => {
                if (socket === this.depthSocket) {
                    this.eventBus.emit('feed.error', { channel: 'depth', timestamp: Date.now() });
                }
            });
            socket.addEventListener('close', () => {
                if (socket !== this.depthSocket || !this.isRunning || !this.socket) return;
                this.eventBus.emit('feed.disconnected', { channel: 'depth', timestamp: Date.now() });
                this.depthSocket = null;
                this.depthReconnectAttempts += 1;
                const delay = Math.min(30000, 3000 * 2 ** Math.min(this.depthReconnectAttempts - 1, 4));
                this.depthReconnectTimer = window.setTimeout(() => this.connectDepthWebSocket(), delay);
            });
        }

        closeDepthSocket() {
            const socket = this.depthSocket;
            this.depthSocket = null;
            if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
                socket.close(1000, 'İstemci kapattı');
            }
        }

        disconnectWebSocket() {
            window.clearTimeout(this.reconnectTimer);
            window.clearTimeout(this.depthReconnectTimer);
            this.reconnectTimer = null;
            this.depthReconnectTimer = null;
            const socket = this.socket;
            this.socket = null;
            this.closeDepthSocket();
            if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
                socket.close(1000, 'İstemci kapattı');
            }
        }

        startConnectionWatch() {
            window.clearInterval(this.connectionWatchTimer);
            this.connectionWatchTimer = window.setInterval(() => {
                if (!this.isRunning || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
                const lastActivity = this.lastMarketMessageAt || this.marketSocketOpenedAt || Date.now();
                if (Date.now() - lastActivity <= 8000) return;
                this.updateConnection(false, 'VERİ AKIŞI BEKLENİYOR');
                this.socket.close(4000, 'Piyasa verisi zaman aşımı');
            }, 2000);
        }

        handleMarketData(stream, data) {
            if (!data) return;
            const streamType = stream.split('@')[1] || '';

            if (streamType === 'ticker') {
                if (data.s === 'BTCUSDT' && finite(data.c)) this.marketData.btcPrice = Number(data.c);
                if (data.s === this.currentSymbol) {
                    this.marketData.change24h = finite(data.P) ? Number(data.P) : this.marketData.change24h;
                    this.marketData.volume24h = finite(data.q) ? Number(data.q) : this.marketData.volume24h;
                    // 24s ticker yalnızca istatistik kaynağıdır. Trade akışı birkaç saniye
                    // sessiz kalırsa düşük hacimli pariteler için son fiyat yedeği olur.
                    if (Date.now() - this.lastTradeAt > 3000 && finite(data.c)) {
                        this.setLivePrice(Number(data.c), Number(data.E) || Date.now(), 'ticker');
                    }
                    this.eventBus.emit('market.ticker', {
                        symbol: this.currentSymbol,
                        change24h: this.marketData.change24h,
                        volume24h: this.marketData.volume24h,
                        source: 'websocket',
                        timestamp: Number(data.E) || Date.now()
                    });
                }
                return;
            }

            if (streamType.startsWith('depth')) {
                this.orderBook = {
                    bids: (data.b || []).map(([price, qty]) => [Number(price), Number(qty)]),
                    asks: (data.a || []).map(([price, qty]) => [Number(price), Number(qty)])
                };
                const timestamp = Number(data.E) || Date.now();
                const receivedAt = Date.now();
                this.commandTelemetry.depthCount += 1;
                this.commandTelemetry.lastDepthAt = receivedAt;
                this.eventBus.emit('market.orderbook', {
                    symbol: this.currentSymbol,
                    orderBook: this.orderBook,
                    bestBid: this.orderBook.bids[0]?.[0] || null,
                    bestAsk: this.orderBook.asks[0]?.[0] || null,
                    timestamp,
                    receivedAt
                });
                return;
            }

            if (streamType.startsWith('kline')) {
                const kline = data.k;
                if (!kline) return;
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
                const timestamp = Number(data.E) || Date.now();
                this.commandTelemetry.klineCount += 1;
                this.commandTelemetry.lastKlineAt = Date.now();
                this.upsertCandle(candle);
                if (Date.now() - this.lastTradeAt > 1500) {
                    this.setLivePrice(candle.close, timestamp, 'kline', { updateCandle: false });
                }
                if (candle.closed) this.calculateIndicators('candle-close');
                this.eventBus.emit('market.candle.updated', {
                    symbol: this.currentSymbol,
                    timeframe: this.currentTimeframe,
                    candle: { ...candle },
                    source: 'kline',
                    timestamp
                });
                if (candle.closed) this.publishClosedCandle(candle, 'kline', timestamp);
                return;
            }

            if (streamType === 'aggTrade') {
                const trade = {
                    price: Number(data.p),
                    quantity: Number(data.q),
                    isBuyerMaker: Boolean(data.m),
                    timestamp: Number(data.T) || Number(data.E) || Date.now()
                };
                if (!finite(trade.price)) return;
                if (data.s === 'BTCUSDT') this.marketData.btcPrice = trade.price;
                if (data.s !== this.currentSymbol) return;
                const receivedAt = Date.now();
                this.commandTelemetry.tradeCount += 1;
                this.commandTelemetry.tradesInWindow += 1;
                this.commandTelemetry.recentTradeTimes.push(receivedAt);
                const oldestRecentTrade = this.commandTelemetry.recentTradeTimes[0] || receivedAt;
                const liveWindowSeconds = Math.min(5, Math.max((receivedAt - oldestRecentTrade) / 1000, 1));
                this.commandTelemetry.tradeRate = this.commandTelemetry.recentTradeTimes.length / liveWindowSeconds;
                this.commandTelemetry.lastTradeAt = receivedAt;
                this.setLivePrice(trade.price, trade.timestamp, 'aggTrade', { quantity: trade.quantity });
                this.eventBus.emit('market.trade', {
                    symbol: this.currentSymbol,
                    timeframe: this.currentTimeframe,
                    trade,
                    timestamp: trade.timestamp,
                    receivedAt
                });
            }
        }

        setLivePrice(price, timestamp = Date.now(), source = 'stream', options = {}) {
            if (!finite(price)) return;
            const numericPrice = Number(price);
            const eventTime = finite(timestamp) ? Number(timestamp) : Date.now();
            const previousPrice = finite(this.marketData.price) ? Number(this.marketData.price) : null;
            this.marketData.price = numericPrice;
            if (this.currentSymbol === 'BTCUSDT') this.marketData.btcPrice = numericPrice;

            if (source === 'aggTrade') {
                this.lastTradeAt = eventTime;
                this.lastTradePrice = numericPrice;
            }
            if (options.updateCandle !== false) {
                this.mergeTradeIntoCandle(numericPrice, eventTime, Number(options.quantity) || 0, true);
            }

            this.eventBus.emit('market.price', {
                symbol: this.currentSymbol,
                timeframe: this.currentTimeframe,
                price: numericPrice,
                previousPrice,
                source,
                timestamp: eventTime
            });
        }

        publishClosedCandle(candle, trigger = 'stream', timestamp = Date.now()) {
            if (!candle || !finite(candle.time) || Number(candle.time) <= this.lastClosedCandleEventTime) return false;
            this.lastClosedCandleEventTime = Number(candle.time);
            this.commandTelemetry.closedCandleCount += 1;
            this.eventBus.emit('market.candle.closed', {
                symbol: this.currentSymbol,
                timeframe: this.currentTimeframe,
                candle: { ...candle, closed: true },
                trigger,
                timestamp
            });
            return true;
        }

        mergeTradeIntoCandle(price, timestamp, quantity = 0, updateChart = true) {
            const interval = TIMEFRAME_MS[this.currentTimeframe] || TIMEFRAME_MS['15m'];
            const candleTime = Math.floor(timestamp / interval) * interval;
            const closeTime = candleTime + interval - 1;
            const last = this.candles.at(-1);
            let candle;
            let closedPrevious = false;

            if (!last || candleTime > last.time) {
                if (last && !last.closed) {
                    last.closed = true;
                    closedPrevious = true;
                }
                candle = {
                    time: candleTime,
                    closeTime,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: Math.max(0, quantity),
                    closed: false
                };
            } else if (last.time === candleTime) {
                candle = {
                    ...last,
                    closeTime,
                    high: Math.max(Number(last.high), price),
                    low: Math.min(Number(last.low), price),
                    close: price,
                    closed: false
                };
            } else {
                return null;
            }

            this.upsertCandle(candle);
            if (updateChart) {
                this.eventBus.emit('market.candle.updated', {
                    symbol: this.currentSymbol,
                    timeframe: this.currentTimeframe,
                    candle: { ...candle },
                    source: 'price',
                    timestamp
                });
            }
            if (closedPrevious) {
                this.calculateIndicators('trade-rollover');
                this.publishClosedCandle(last, 'trade-rollover', timestamp);
            }
            return candle;
        }

        queuePriceRender() {
            if (this.priceRenderFrame !== null) return;
            this.priceRenderFrame = -1;
            const frame = window.requestAnimationFrame(() => {
                this.priceRenderFrame = null;
                this.renderPrice();
            });
            if (this.priceRenderFrame !== null) this.priceRenderFrame = frame;
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
            this.calculateIndicators('periodic');
            this.eventBus.emit('market.regime.check', {
                symbol: this.currentSymbol,
                timeframe: this.currentTimeframe,
                trigger: 'periodic'
            });
            this.eventBus.emit('analysis.tick', {
                symbol: this.currentSymbol,
                timeframe: this.currentTimeframe,
                trigger: 'periodic'
            });
        }

        calculateIndicators(trigger = 'manual') {
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
            this.commandTelemetry.indicatorUpdates += 1;
            this.eventBus.emit('market.indicators.updated', {
                symbol: this.currentSymbol,
                timeframe: this.currentTimeframe,
                indicators: {
                    atr: this.indicators.atr,
                    sma20: this.indicators.sma20,
                    sma50: this.indicators.sma50,
                    vwap: this.indicators.vwap,
                    rsi: this.indicators.rsi.at(-1)
                },
                closedCandles: candles.length,
                trigger,
                timestamp: Date.now()
            });
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
            this.eventBus.emit('signal.generated', { signal });
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
                    this.eventBus.emit('signal.closed', { signal, price });
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

            const numericChange = finite(change) ? Number(change) : null;
            const changeText = numericChange !== null ? `${numericChange >= 0 ? '+' : ''}${numericChange.toFixed(2)}%` : '—';
            const className = numericChange === null ? 'neutral' : numericChange >= 0 ? 'positive' : 'negative';
            const tickerChange = document.getElementById('ticker-change');
            tickerChange.textContent = changeText;
            tickerChange.className = className;
            const metricChange = document.getElementById('change-24h');
            metricChange.textContent = changeText;
            metricChange.className = className;
        }

        renderSignals() {
            const body = document.getElementById('signals-body');
            const panel = document.querySelector('.signals-panel');
            if (panel) panel.classList.toggle('has-history', this.signals.length > 0);
            const activeCount = this.signals.filter(signal => signal.status === 'active').length;
            const mobileBadge = document.getElementById('mobile-signal-badge');
            mobileBadge.textContent = activeCount > 9 ? '9+' : String(activeCount);
            mobileBadge.hidden = activeCount === 0;
            if (!this.signals.length) {
                body.innerHTML = '<tr><td colspan="6" class="table-empty">Henüz sinyal yok.</td></tr>';
                return;
            }
            body.innerHTML = this.signals.slice(0, 100).map(signal => `
                <tr class="signal-row" data-signal-id="${this.escapeHtml(signal.id)}" title="Detay için tıkla · ${this.escapeHtml(signal.reason || '')}">
                    <td>${new Date(signal.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                    <td><span class="direction-pill ${signal.direction}">${signal.direction.toUpperCase()}</span></td>
                    <td>${this.formatPrice(signal.price)}</td>
                    <td>${signal.score}</td>
                    <td>${signal.confirmations || 1}</td>
                    <td><span class="status-pill ${signal.status}">${signal.status.toUpperCase()}</span></td>
                </tr>
            `).join('');
        }

        openSignalDetail(signalId) {
            const signal = this.signals.find(item => item.id === signalId);
            if (!signal) return;
            const diagnostics = signal.diagnostics || {};
            const conviction = diagnostics.conviction || {};
            const signalQuality = diagnostics.marketQuality || null;
            const contributors = signal.details || [];
            const familyCount = diagnostics.independentFamilies || new Set(contributors.map(item => item.evidenceFamily)).size;
            const contributionTotal = contributors.reduce((sum, detail) => {
                const contribution = finite(detail.contributionScore) ? Number(detail.contributionScore) : Number(detail.score || 0);
                return sum + contribution;
            }, 0);
            document.getElementById('signal-detail-title').textContent = `${signal.direction.toUpperCase()} · ${signal.symbol.replace('USDT', '/USDT')} · Skor ${signal.score}`;
            document.getElementById('signal-detail-summary').innerHTML = `
                <article><span>Durum</span><strong class="${signal.status === 'tp' ? 'positive' : signal.status === 'sl' ? 'negative' : ''}">${signal.status.toUpperCase()}</strong></article>
                <article><span>Etkin / Ham Skor</span><strong>${signal.score} / ${signal.rawScore ?? signal.score}</strong></article>
                <article><span>Bağımsız Teyit</span><strong>${signal.confirmations || 1} strateji · ${familyCount} aile</strong></article>
                <article><span>Contributors / Katkı</span><strong>${contributors.length} strateji · ${contributionTotal.toFixed(2)} net</strong></article>
                <article><span>Skor Farkı</span><strong>${Number(diagnostics.scoreLead || 0).toFixed(2)}</strong></article>
                <article><span>Kararlılık</span><strong>${conviction.windows || 1} pencere · ${Math.round(conviction.elapsedMs || 0)} ms</strong></article>
                <article><span>Piyasa Kalitesi</span><strong>${signalQuality ? `${this.marketQualityLabel(signalQuality.status)} · ${signalQuality.spreadBps ?? '—'} bp` : '—'}</strong></article>
                <article><span>Rejim</span><strong>${this.escapeHtml(signal.regime || 'bilinmiyor')}</strong></article>
                <article><span>Giriş</span><strong>${this.formatPrice(signal.price)}</strong></article>
                <article><span>TP / SL</span><strong>${this.formatPrice(signal.tp)} / ${this.formatPrice(signal.sl)}</strong></article>
            `;

            document.getElementById('signal-contributors-body').innerHTML = contributors.length
                ? contributors.map(detail => {
                    const contribution = finite(detail.contributionScore) ? Number(detail.contributionScore) : Number(detail.score || 0);
                    const percent = finite(detail.contributionPercent)
                        ? Number(detail.contributionPercent)
                        : contributionTotal > 0 ? contribution / contributionTotal * 100 : 0;
                    const capFactor = finite(detail.familyCapFactor) ? Number(detail.familyCapFactor) : 1;
                    return `
                        <tr>
                            <td data-label="Strateji">${this.escapeHtml(STRATEGY_LABELS[detail.strategy] || detail.strategy)}</td>
                            <td data-label="Aile">${this.escapeHtml(detail.evidenceFamily || '—')}</td>
                            <td data-label="Sebep">${this.escapeHtml(detail.reason || '—')}</td>
                            <td data-label="Temel">${Number(detail.baseScore ?? detail.score ?? 0).toFixed(2)}</td>
                            <td data-label="Öğrenme">×${Number(detail.adaptiveWeight || 1).toFixed(2)}</td>
                            <td data-label="Rejim">×${Number(detail.regimeFactor || 1).toFixed(2)}</td>
                            <td data-label="Etkin">${Number(detail.score || 0).toFixed(2)}</td>
                            <td data-label="Net Katkı" class="contribution-cell" title="Aile tavanı katsayısı: ×${capFactor.toFixed(3)}">
                                <strong>${contribution.toFixed(2)} · %${percent.toFixed(1)}</strong>
                                <span class="contribution-meter" aria-hidden="true"><i style="width:${clamp(percent, 0, 100)}%"></i></span>
                            </td>
                        </tr>
                    `;
                }).join('')
                : '<tr><td colspan="8" class="table-empty">Eski sinyalde katkı detayı bulunmuyor.</td></tr>';

            const opponents = diagnostics.opposingDetails || [];
            document.getElementById('signal-opponents-body').innerHTML = opponents.length
                ? opponents.map(detail => `
                    <tr>
                        <td data-label="Strateji">${this.escapeHtml(STRATEGY_LABELS[detail.strategy] || detail.strategy)}</td>
                        <td data-label="Yön">${String(detail.direction || '').toUpperCase()}</td>
                        <td data-label="Aile">${this.escapeHtml(detail.evidenceFamily || '—')}</td>
                        <td data-label="Sebep">${this.escapeHtml(detail.reason || '—')}</td>
                        <td data-label="Etkin Skor">${Number(detail.score || 0).toFixed(2)}</td>
                    </tr>
                `).join('')
                : '<tr><td colspan="5" class="table-empty">Karşıt oy yok.</td></tr>';
            document.getElementById('signal-detail-dialog').showModal();
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
            const contributorsButton = document.getElementById('active-contributors-btn');
            card.className = `active-signal-card ${active ? active.direction : 'empty'}`;
            contributorsButton.hidden = !active;
            if (!active) {
                title.textContent = 'Aktif sinyal yok';
                detail.textContent = 'Yeni sinyal için en az iki bağımsız teyit bekleniyor.';
                return;
            }
            const contributorCount = (active.details || []).length || active.confirmations || 1;
            title.textContent = `${active.direction.toUpperCase()} · ${this.formatPrice(active.price)} · Skor ${active.score}`;
            detail.textContent = `TP ${this.formatPrice(active.tp)} · SL ${this.formatPrice(active.sl)} · ${contributorCount} strateji katkısı`;
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

        setMobileView(view, options = {}) {
            const labels = {
                home: 'Ana Sayfa',
                market: 'Piyasa',
                signals: 'Sinyaller',
                learning: 'Öğrenme'
            };
            if (!labels[view]) return;
            this.mobileView = view;
            document.body.dataset.mobileView = view;
            document.getElementById('mobile-page-title').textContent = labels[view];
            this.syncMobileTabs();
            if (options.persist !== false) this.saveData(STORAGE.mobileView, view);

            const shell = document.querySelector('.app-shell');
            if (options.scroll !== false && shell && typeof shell.scrollTo === 'function') {
                shell.scrollTo({ top: 0, behavior: 'auto' });
            }
            if (view === 'market') requestAnimationFrame(() => this.resizeActiveVisual());
        }

        syncMobileTabs() {
            document.querySelectorAll('#mobile-tabbar .mobile-tab').forEach(tab => {
                const active = tab.dataset.mobileView === this.mobileView;
                tab.classList.toggle('active', active);
                tab.setAttribute('aria-selected', String(active));
            });
        }

        resizeActiveVisual() {
            if (this.visualView === 'heatmap') {
                this.heatmapManager.resize();
                this.heatmapManager.draw(this.orderBook, this.marketData.price);
            } else {
                this.chartManager.resize();
                this.chartManager.focusLatest();
            }
        }

        switchView(view, options = {}) {
            const chart = view !== 'heatmap';
            this.visualView = chart ? 'chart' : 'heatmap';
            document.getElementById('chart-view').classList.toggle('active', chart);
            document.getElementById('chart-view').hidden = !chart;
            document.getElementById('heatmap-view').classList.toggle('active', !chart);
            document.getElementById('heatmap-view').hidden = chart;
            document.getElementById('chart-view-btn').classList.toggle('active', chart);
            document.getElementById('heatmap-view-btn').classList.toggle('active', !chart);
            if (options.persist !== false) this.saveData(STORAGE.visualView, this.visualView);
            requestAnimationFrame(() => this.resizeActiveVisual());
        }

        openSettings() {
            this.fillSettingsForm();
            const dialog = document.getElementById('settings-dialog');
            dialog.showModal();
            requestAnimationFrame(() => {
                const body = dialog.querySelector('.dialog-body');
                if (body) body.scrollTop = 0;
                this.syncSettingsSectionNav('settings-basic');
            });
        }

        scrollSettingsTo(targetId) {
            const dialog = document.getElementById('settings-dialog');
            const body = dialog.querySelector('.dialog-body');
            const target = document.getElementById(targetId);
            if (!body || !target) return;
            body.scrollTo({ top: Math.max(0, target.offsetTop - 8), behavior: 'smooth' });
            this.syncSettingsSectionNav(targetId);
        }

        syncSettingsSectionNav(targetId) {
            document.querySelectorAll('[data-settings-target]').forEach(button => {
                const active = button.dataset.settingsTarget === targetId;
                button.classList.toggle('active', active);
                button.setAttribute('aria-current', active ? 'true' : 'false');
            });
        }

        fillSettingsForm() {
            const { params, cooldowns, signalSafety, learning, marketQuality } = this.settings;
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
            this.setInput('setting-independent-families', signalSafety.minIndependentFamilies);
            this.setInput('setting-family-cap', signalSafety.maxFamilyContributionRatio);
            this.setInput('setting-conviction-windows', signalSafety.minConvictionWindows);
            this.setInput('setting-reversal-windows', signalSafety.minReversalConvictionWindows);
            this.setInput('setting-reverse-hysteresis', signalSafety.reverseHysteresisPoints);
            this.setInput('setting-reversal-atr', signalSafety.reversalAtrInvalidation);
            this.setInput('setting-opposite-lock', signalSafety.oppositeSignalLockMs);
            this.setInput('setting-reversal-confirmations', signalSafety.minReversalConfirmations);
            this.setInput('setting-reversal-multiplier', signalSafety.reversalScoreMultiplier);
            document.getElementById('setting-active-lock').checked = signalSafety.preventSignalsWhileActive;
            document.getElementById('setting-reversal-close').checked = signalSafety.requireClosedCandleForReversal;
            document.getElementById('setting-quality-enabled').checked = marketQuality.enabled;
            document.getElementById('setting-quality-require-depth').checked = marketQuality.requireDepth;
            this.setInput('setting-quality-trade-age', marketQuality.maxTradeAgeMs);
            this.setInput('setting-quality-depth-age', marketQuality.maxDepthAgeMs);
            this.setInput('setting-quality-transport-lag', marketQuality.maxTransportLagMs);
            this.setInput('setting-quality-spread', marketQuality.maxSpreadBps);
            this.setInput('setting-quality-depth-usd', marketQuality.minDepthUsd);
            this.setInput('setting-quality-shock-bps', marketQuality.shockMoveBps);
            this.setInput('setting-quality-shock-window', marketQuality.shockWindowMs);
            this.setInput('setting-quality-shock-pause', marketQuality.shockPauseMs);
            this.setInput('setting-learning-min-samples', learning.minSamples);
            this.setInput('setting-learning-every', learning.optimizeEvery);
            this.setInput('setting-shadow-influence', learning.shadowInfluence);
            this.setInput('setting-min-weight', learning.minWeight);
            this.setInput('setting-max-weight', learning.maxWeight);
            document.getElementById('setting-shadow-enabled').checked = learning.shadowEnabled;

            document.getElementById('strategy-toggles').innerHTML = Object.keys(this.strategyClasses).map(key => `
                <label class="strategy-toggle">
                    <input type="checkbox" data-strategy="${key}" ${this.settings.activeStrategies[key] ? 'checked' : ''}>
                    <span>${this.escapeHtml(STRATEGY_LABELS[key])}</span>
                </label>
            `).join('');
        }

        applySettingsFromForm() {
            const number = (id, fallback, min, max) => {
                const parsed = Number(document.getElementById(id).value);
                return clamp(Number.isFinite(parsed) ? parsed : fallback, min, max);
            };
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
                    minIndependentFamilies: number('setting-independent-families', 2, 1, 4),
                    maxFamilyContributionRatio: number('setting-family-cap', 0.60, 0.25, 1),
                    preventSignalsWhileActive: document.getElementById('setting-active-lock').checked,
                    oppositeSignalLockMs: number('setting-opposite-lock', 120000, 0, 3600000),
                    minReversalConfirmations: number('setting-reversal-confirmations', 2, 1, 10),
                    reversalScoreMultiplier: number('setting-reversal-multiplier', 1.25, 1, 5),
                    reverseHysteresisPoints: number('setting-reverse-hysteresis', 2, 0, 20),
                    minConvictionWindows: number('setting-conviction-windows', 2, 1, 10),
                    minReversalConvictionWindows: number('setting-reversal-windows', 3, 1, 10),
                    minConvictionMs: this.settings.signalSafety.minConvictionMs ?? 600,
                    minReversalConvictionMs: this.settings.signalSafety.minReversalConvictionMs ?? 1200,
                    convictionWindowMs: this.settings.signalSafety.convictionWindowMs ?? 700,
                    convictionAlpha: this.settings.signalSafety.convictionAlpha ?? 0.35,
                    reversalAtrInvalidation: number('setting-reversal-atr', 0.5, 0, 5),
                    requireClosedCandleForReversal: document.getElementById('setting-reversal-close').checked,
                    blockedNoticeThrottleMs: 10000
                },
                learning: {
                    minSamples: number('setting-learning-min-samples', 20, 5, 500),
                    optimizeEvery: number('setting-learning-every', 5, 1, 100),
                    minWeight: number('setting-min-weight', 0.65, 0.2, 1),
                    maxWeight: number('setting-max-weight', 1.35, 1, 3),
                    shadowEnabled: document.getElementById('setting-shadow-enabled').checked,
                    shadowInfluence: number('setting-shadow-influence', 0.35, 0, 1),
                    maxShadowTrades: this.settings.learning.maxShadowTrades || 120
                },
                marketQuality: {
                    enabled: document.getElementById('setting-quality-enabled').checked,
                    requireDepth: document.getElementById('setting-quality-require-depth').checked,
                    maxTradeAgeMs: number('setting-quality-trade-age', 3000, 500, 60000),
                    maxDepthAgeMs: number('setting-quality-depth-age', 2000, 500, 60000),
                    maxTransportLagMs: number('setting-quality-transport-lag', 2000, 250, 30000),
                    maxSpreadBps: number('setting-quality-spread', 8, 0.01, 1000),
                    minDepthUsd: number('setting-quality-depth-usd', 50000, 0, 1e12),
                    criticalSpreadMultiplier: this.settings.marketQuality.criticalSpreadMultiplier || 2,
                    criticalDepthRatio: this.settings.marketQuality.criticalDepthRatio ?? 0.5,
                    shockMoveBps: number('setting-quality-shock-bps', 40, 1, 10000),
                    shockWindowMs: number('setting-quality-shock-window', 3000, 250, 60000),
                    shockPauseMs: number('setting-quality-shock-pause', 120000, 1000, 900000)
                },
                activeStrategies
            };
            this.saveData(STORAGE.settings, this.settings);
            this.confluenceEngine.reset();
            this.updateActiveStrategies();
            this.calculateIndicators('settings-changed');
            this.eventBus.emit('settings.changed', { settings: this.settings, timestamp: Date.now() });
            this.renderSafetyChips();
            this.renderLearning();
            this.notify('Ayarlar kaydedildi; bekleyen teklifler temizlendi.', 'success');
        }

        resetSettings() {
            if (!window.confirm('Tüm strateji ve güvenlik ayarları varsayılana dönsün mü?')) return;
            this.settings = this.defaultSettings();
            this.saveData(STORAGE.settings, this.settings);
            this.confluenceEngine.reset();
            this.updateActiveStrategies();
            this.fillSettingsForm();
            this.eventBus.emit('settings.changed', { settings: this.settings, timestamp: Date.now() });
            this.renderSafetyChips();
            this.renderLearning();
            this.notify('Varsayılan güvenli ayarlar yüklendi.', 'info');
        }

        renderSafetyChips() {
            const safety = this.settings.signalSafety;
            document.getElementById('safety-chips').innerHTML = [
                `${safety.minConfirmations} strateji / ${safety.minIndependentFamilies} aile`,
                `${safety.minConvictionWindows} pencere kararlılık`,
                `${safety.minScoreLead} puan skor farkı`,
                `${Math.round(safety.oppositeSignalLockMs / 1000)} sn ters kilit`,
                `+${safety.reverseHysteresisPoints} ters histerezis`,
                `${safety.reversalAtrInvalidation} ATR geçersizlik`,
                this.settings.marketQuality.enabled ? 'piyasa kalite kilidi' : 'kalite kilidi kapalı'
            ].map(text => `<span>${this.escapeHtml(text)}</span>`).join('');
        }

        renderLearning() {
            if (!this.adaptiveLearning) return;
            const summary = this.adaptiveLearning.getSummary();
            document.getElementById('learning-mode').value = summary.mode;
            const adxText = summary.adx === null || summary.adx === undefined ? '' : ` · ADX ${summary.adx.toFixed(1)}`;
            document.getElementById('learning-regime').textContent = `${summary.regime.replace(':', ' · ')}${adxText}`;
            document.getElementById('learning-live-count').textContent = Math.round(summary.totalLive);
            document.getElementById('learning-shadow-count').textContent = Math.round(summary.totalShadow);
            document.getElementById('learning-active-shadow').textContent = summary.activeShadowTrades;
            document.getElementById('learning-optimization-count').textContent = summary.optimizationCount;
            document.getElementById('learning-global-cooldown').textContent = `×${summary.globalCooldownMultiplier.toFixed(2)}`;

            const status = document.getElementById('learning-status');
            if (summary.mode === 'paused') {
                status.textContent = 'Öğrenme durduruldu. Sinyal motoru temel skor ve cooldown değerleriyle çalışıyor.';
            } else if (summary.mode === 'shadow') {
                status.textContent = 'Shadow modu: Sonuçlar kaydediliyor fakat ağırlık ve cooldown değerleri sinyallere uygulanmıyor.';
            } else if (summary.warmupRemaining > 0) {
                status.textContent = `Warm-up aktif: İlk adaptif ağırlık için yaklaşık ${Math.ceil(summary.warmupRemaining)} etkili sonuç daha gerekiyor. Shadow sonuçların etkisi sınırlıdır.`;
            } else {
                status.textContent = `Otomatik optimizasyon aktif. Ağırlıklar ${this.settings.learning.minWeight.toFixed(2)}–${this.settings.learning.maxWeight.toFixed(2)} sınırında; hard güvenlik kuralları değiştirilemez.`;
            }

            const body = document.getElementById('learning-body');
            if (!summary.rows.length) {
                body.innerHTML = '<tr><td colspan="9" class="table-empty">Öğrenme verisi bekleniyor.</td></tr>';
                return;
            }
            body.innerHTML = summary.rows.map(row => {
                const weightClass = row.weight > 1.005 ? 'up' : row.weight < 0.995 ? 'down' : 'neutral';
                const cooldown = row.cooldown === null ? 'Mum bazlı' : `${(row.cooldown / 1000).toFixed(1)} sn`;
                return `
                    <tr>
                        <td data-label="Strateji">${this.escapeHtml(row.displayName)}</td>
                        <td data-label="Rol"><span class="role-pill ${row.active ? 'live' : 'shadow'}">${row.active ? 'LIVE + SHADOW' : 'SHADOW'}</span></td>
                        <td data-label="Live">${row.liveCount}</td>
                        <td data-label="Shadow">${row.shadowCount}</td>
                        <td data-label="Bayes Win%">${row.winRate === null ? '—' : `${(row.winRate * 100).toFixed(1)}%`}</td>
                        <td data-label="Ort. R" class="${row.averageR > 0 ? 'positive' : row.averageR < 0 ? 'negative' : ''}">${row.effectiveCount ? row.averageR.toFixed(2) : '—'}</td>
                        <td data-label="EWMA R" class="${row.ewmaR > 0 ? 'positive' : row.ewmaR < 0 ? 'negative' : ''}">${row.effectiveCount ? row.ewmaR.toFixed(2) : '—'}</td>
                        <td data-label="Ağırlık"><span class="weight-pill ${weightClass}">×${row.weight.toFixed(2)}</span></td>
                        <td data-label="Cooldown">${cooldown}</td>
                    </tr>
                `;
            }).join('');
        }

        exportLearningData() {
            const blob = new Blob([this.adaptiveLearning.exportState()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `utc-learning-${this.currentSymbol}-${Date.now()}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            this.notify('Öğrenme istatistikleri JSON olarak dışa aktarıldı.', 'success');
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
            if ('serviceWorker' in navigator && window.isSecureContext) {
                navigator.serviceWorker.register('./sw.js?v=8').catch(error => {
                    console.warn('Çevrimdışı uygulama kabuğu kaydedilemedi:', error);
                });
            }
        } catch (error) {
            console.error('Uygulama başlatılamadı:', error);
            document.body.innerHTML = `<main style="padding:32px;font-family:monospace;color:#ff5f6d">Uygulama başlatılamadı: ${String(error.message || error)}</main>`;
        }
    });
})();
