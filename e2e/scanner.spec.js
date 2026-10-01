const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const chartLibrary = fs.readFileSync(
    path.join(__dirname, '..', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
    'utf8'
);

function candleRows(count = 80) {
    const interval = 15 * 60 * 1000;
    const end = Date.now() - interval;
    return Array.from({ length: count }, (_, index) => {
        const openTime = end - (count - index) * interval;
        const base = 64_000 + index * 8;
        return [
            openTime,
            String(base),
            String(base + 120),
            String(base - 90),
            String(base + 35),
            String(100 + index),
            openTime + interval - 1,
            '0', '0', '0', '0', '0'
        ];
    });
}

async function preparePage(page) {
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: chartLibrary
    }));
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.route('https://fapi.binance.com/**', route => {
        const ticker = route.request().url().includes('/ticker/24hr');
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(ticker
                ? { s: 'BTCUSDT', c: '64777.50', P: '1.25', q: '98765432' }
                : candleRows())
        });
    });
    await page.addInitScript(() => {
        class FakeWebSocket {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;

            constructor(url) {
                this.url = url;
                this.readyState = FakeWebSocket.CONNECTING;
                this.listeners = new Map();
                window.__fakeSockets = window.__fakeSockets || [];
                window.__fakeSockets.push(this);
                window.__lastFakeSocket = this;
                setTimeout(() => {
                    if (this.readyState !== FakeWebSocket.CONNECTING) return;
                    this.readyState = FakeWebSocket.OPEN;
                    this.dispatch('open', {});
                }, 10);
            }

            addEventListener(type, listener) {
                const listeners = this.listeners.get(type) || [];
                listeners.push(listener);
                this.listeners.set(type, listeners);
            }

            dispatch(type, payload) {
                (this.listeners.get(type) || []).forEach(listener => listener(payload));
                const handler = this[`on${type}`];
                if (typeof handler === 'function') handler(payload);
            }

            close() {
                this.readyState = FakeWebSocket.CLOSED;
                this.dispatch('close', { code: 1000 });
            }
        }
        window.WebSocket = FakeWebSocket;
    });
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.app));
}

async function injectActiveSignal(page) {
    await page.evaluate(() => {
        window.app.signals = [{
            id: 'e2e-contributor-signal',
            timestamp: Date.now(),
            symbol: 'BTCUSDT',
            timeframe: '15m',
            direction: 'buy',
            price: 64_500,
            tp: 65_200,
            sl: 64_100,
            score: 8,
            rawScore: 10,
            confirmations: 2,
            regime: 'trend-up:normal',
            status: 'active',
            reason: 'Hacimli Kırılım, Emir Akışı Momentumu',
            details: [
                {
                    strategy: 'breakoutPattern',
                    evidenceFamily: 'momentum',
                    reason: 'Hacimli kırılım',
                    baseScore: 6,
                    adaptiveWeight: 1.1,
                    regimeFactor: 1.05,
                    score: 6.93,
                    contributionScore: 4.8,
                    contributionPercent: 60,
                    familyCapFactor: 0.693
                },
                {
                    strategy: 'orderFlowMomentum',
                    evidenceFamily: 'microstructure',
                    reason: 'Pozitif emir akışı',
                    baseScore: 3,
                    adaptiveWeight: 1,
                    regimeFactor: 1,
                    score: 3,
                    contributionScore: 3.2,
                    contributionPercent: 40,
                    familyCapFactor: 1
                }
            ],
            diagnostics: {
                scoreLead: 6,
                independentFamilies: 2,
                contributionTotal: 8,
                conviction: { windows: 2, elapsedMs: 900 }
            }
        }];
        window.app.renderAll();
    });
}

test.describe('masaüstü uygulama akışı', () => {
    test.use({ viewport: { width: 1440, height: 1000 } });

    test.beforeEach(async ({ page }) => {
        await preparePage(page);
    });

    test('dashboard, tema, grafik, heatmap ve ayarlar birlikte çalışır', async ({ page }) => {
        await expect(page.locator('.control-panel')).toBeVisible();
        await expect(page.locator('.market-panel')).toBeVisible();
        await expect(page.locator('.signals-panel')).toBeVisible();
        await expect(page.locator('.learning-panel')).toBeVisible();
        await expect(page.locator('#mobile-tabbar')).toBeHidden();

        await page.locator('#heatmap-view-btn').click();
        await expect(page.locator('#heatmap-view')).toBeVisible();
        await expect(page.locator('#chart-view')).toBeHidden();
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('utc_visual_view')))).toBe('heatmap');

        await page.locator('#chart-view-btn').click();
        await expect(page.locator('#chart-view')).toBeVisible();

        await page.locator('#theme-btn').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await page.locator('#theme-btn').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

        await page.locator('#settings-btn').click();
        await expect(page.locator('#settings-dialog')).toBeVisible();
        await page.locator('#setting-threshold').fill('4');
        await page.locator('#save-settings-btn').click();
        await expect(page.locator('#settings-dialog')).toBeHidden();
        await expect.poll(() => page.evaluate(() => window.app.settings.confluenceThreshold)).toBe(4);

        await page.locator('#settings-btn').click();
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#reset-settings-btn').click();
        await expect(page.locator('#setting-threshold')).toHaveValue('3');
        await expect.poll(() => page.evaluate(() => window.app.settings.confluenceThreshold)).toBe(3);
        await page.locator('#close-settings-btn').click();

        await page.locator('#symbol-input').fill('eth');
        await page.locator('#symbol-input').dispatchEvent('change');
        await expect(page.locator('#ticker-symbol')).toHaveText('ETH/USDT');
        await page.locator('#timeframe-select').selectOption('1h');
        await expect(page.locator('#market-title')).toHaveText('ETH/USDT · 1h');
    });

    test('başlat/durdur, piyasa akışı ve öğrenme araçları gerçek DOM üzerinde çalışır', async ({ page }) => {
        await page.locator('#start-btn').click();
        await expect(page.locator('#connection-text')).toHaveText('AKIŞ BEKLENİYOR');
        await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
        await expect(page.locator('#start-btn')).toBeDisabled();
        await expect(page.locator('#start-btn')).toHaveText('Çalışıyor');
        await expect(page.locator('#ticker-price')).toContainText('64,777.50');
        await expect(page.locator('#stop-btn')).toBeEnabled();

        const socketUrls = await page.evaluate(() => window.__fakeSockets.map(socket => socket.url));
        expect(socketUrls.some(url => url.includes('/market/stream?streams=btcusdt@aggTrade'))).toBe(true);
        expect(socketUrls.some(url => url.includes('/public/stream?streams=btcusdt@depth20@100ms'))).toBe(true);

        await page.evaluate(() => {
            const marketSocket = window.__fakeSockets.find(socket => socket.url.includes('/market/'));
            const now = Date.now();
            marketSocket.dispatch('message', {
                data: JSON.stringify({
                    stream: 'btcusdt@aggTrade',
                    data: { e: 'aggTrade', E: now, T: now, s: 'BTCUSDT', p: '65431.90', q: '0.010', m: false }
                })
            });
        });
        await expect(page.locator('#ticker-price')).toContainText('65,431.90');
        await expect(page.locator('#connection-text')).toHaveText('CANLI');

        await page.evaluate(() => {
            const marketSocket = window.__fakeSockets.find(socket => socket.url.includes('/market/'));
            const depthSocket = window.__fakeSockets.find(socket => socket.url.includes('/public/'));
            const send = (socket, stream, data) => socket.dispatch('message', {
                data: JSON.stringify({ stream, data })
            });
            const now = Date.now();
            send(marketSocket, 'btcusdt@aggTrade', {
                e: 'aggTrade', E: now, T: now, s: 'BTCUSDT', p: '65432.10', q: '0.015', m: true
            });
            send(marketSocket, 'btcusdt@ticker', {
                e: '24hrTicker', E: now + 10, s: 'BTCUSDT', c: '65432.00', P: '2.75', q: '123456789'
            });
            const interval = 15 * 60 * 1000;
            const candleTime = Math.floor(now / interval) * interval;
            send(marketSocket, 'btcusdt@kline_15m', {
                e: 'kline', E: now + 20, s: 'BTCUSDT',
                k: {
                    t: candleTime, T: candleTime + interval - 1,
                    o: '65431.90', h: '65435.00', l: '65430.00', c: '65432.10', v: '12.5', x: false
                }
            });
            send(depthSocket, 'btcusdt@depth20@100ms', {
                E: now + 30,
                b: [['65430', '12'], ['65420', '8']],
                a: [['65435', '10'], ['65445', '6']]
            });
        });
        await expect(page.locator('#ticker-price')).toContainText('65,432.10');
        await expect(page.locator('#current-price')).toContainText('65,432.10');
        await expect(page.locator('#ticker-change')).toHaveText('+2.75%');
        await expect.poll(() => page.evaluate(() => window.app.candles.at(-1)?.close)).toBe(65432.1);
        await expect.poll(() => page.evaluate(() => window.app.lastTradePrice)).toBe(65432.1);
        await expect.poll(() => page.evaluate(() => ({
            trades: window.app.commandTelemetry.tradeCount,
            klines: window.app.commandTelemetry.klineCount,
            depth: window.app.commandTelemetry.depthCount
        }))).toEqual({ trades: 2, klines: 1, depth: 1 });
        await expect(page.locator('#command-health')).toHaveText('TÜM SİSTEM CANLI');
        await expect(page.locator('#command-market-sync')).toHaveText('1 / 1');
        await expect.poll(() => page.evaluate(() => window.app.eventBus.recent('market.trade', 10).length)).toBe(2);
        await page.screenshot({ path: 'test-results/audit-command-center-live.png', fullPage: true });

        await page.locator('#learning-mode').selectOption('shadow');
        await expect.poll(() => page.evaluate(() => window.app.adaptiveLearning.state.mode)).toBe('shadow');

        const downloadPromise = page.waitForEvent('download');
        await page.locator('#export-learning-btn').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^utc-learning-BTCUSDT-\d+\.json$/);

        await page.locator('#stop-btn').click();
        await expect(page.locator('#connection-text')).toHaveText('DURDURULDU');
        await expect(page.locator('#start-btn')).toBeEnabled();
        await expect(page.locator('#start-btn')).toHaveText('Sistemi Başlat');
    });

    test('trade olayı strateji, öğrenme ve confluence motorlarına aynı omurgadan ulaşır', async ({ page }) => {
        await page.locator('#start-btn').click();
        await expect.poll(() => page.evaluate(() => window.__fakeSockets?.length || 0)).toBeGreaterThanOrEqual(2);

        await page.evaluate(() => {
            const velocity = window.app.strategies.velocityScalping;
            velocity.minPoints = 3;
            velocity.threshold = 0.0001;
            window.app.strategies.wallBounce.processTrade = () => { throw new Error('izole test hatası'); };
            const marketSocket = window.__fakeSockets.find(socket => socket.url.includes('/market/'));
            const now = Date.now();
            [65000, 65020, 65045].forEach((price, index) => {
                marketSocket.dispatch('message', {
                    data: JSON.stringify({
                        stream: 'btcusdt@aggTrade',
                        data: {
                            e: 'aggTrade', E: now + index * 40, T: now + index * 40,
                            s: 'BTCUSDT', p: String(price), q: '0.10', m: false
                        }
                    })
                });
            });
        });

        await expect.poll(() => page.evaluate(() => window.app.commandTelemetry.proposalCount)).toBeGreaterThanOrEqual(1);
        await expect.poll(() => page.evaluate(() => window.app.commandTelemetry.strategyErrors)).toBe(3);
        await expect.poll(() => page.evaluate(() => window.app.eventBus.recent('strategy.error', 20).length)).toBe(3);
        await expect.poll(() => page.evaluate(() =>
            window.app.eventBus.recent('proposal.created', 20)
                .some(envelope => envelope.payload.strategy === 'velocityScalping')
        )).toBe(true);
        await expect.poll(() => page.evaluate(() =>
            window.app.eventBus.recent('confluence.proposal.received', 20)
                .some(envelope => envelope.payload.strategy === 'velocityScalping')
        )).toBe(true);
        const decision = await page.evaluate(() => window.app.confluenceEngine.evaluateNow());
        expect(decision.status).toBe('below-threshold');
        await expect(page.locator('#command-decision')).toHaveText('EŞİK ALTI');
        await expect(page.locator('#command-health')).toHaveText('STRATEJİ HATASI');
        await expect(page.locator('#command-proposal-count')).toContainText('3 hata');
    });

    test('REST erişilemezken routed trade akışı fiyatı ve canlı mumu başlatır', async ({ page }) => {
        await page.route('https://fapi.binance.com/**', route => route.abort('connectionrefused'));
        await page.locator('#start-btn').click();
        await expect.poll(() => page.evaluate(() => window.__fakeSockets?.length || 0)).toBeGreaterThanOrEqual(2);
        await expect(page.locator('#connection-text')).toHaveText('AKIŞ BEKLENİYOR');

        await page.evaluate(() => {
            const marketSocket = window.__fakeSockets.find(socket => socket.url.includes('/market/'));
            const now = Date.now();
            marketSocket.dispatch('message', {
                data: JSON.stringify({
                    stream: 'btcusdt@aggTrade',
                    data: { e: 'aggTrade', E: now, T: now, s: 'BTCUSDT', p: '71234.50', q: '0.125', m: false }
                })
            });
        });

        await expect(page.locator('#ticker-price')).toContainText('71,234.50');
        await expect(page.locator('#current-price')).toContainText('71,234.50');
        await expect(page.locator('#connection-text')).toHaveText('CANLI');
        await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
        await expect.poll(() => page.evaluate(() => window.app.candles.at(-1)?.close)).toBe(71234.5);

        await page.evaluate(() => {
            const marketSocket = window.__fakeSockets.find(socket => socket.url.includes('/market/'));
            const now = Date.now();
            [71236.2, 71233.8, 71235.7].forEach((price, index) => {
                marketSocket.dispatch('message', {
                    data: JSON.stringify({
                        stream: 'btcusdt@aggTrade',
                        data: {
                            e: 'aggTrade', E: now + index * 40, T: now + index * 40,
                            s: 'BTCUSDT', p: String(price), q: '0.025', m: index % 2 === 0
                        }
                    })
                });
            });
        });
        await expect(page.locator('#ticker-price')).toContainText('71,235.70');
        await expect.poll(() => page.evaluate(() => window.app.candles.at(-1)?.high)).toBe(71236.2);
        await expect.poll(() => page.evaluate(() => window.app.candles.at(-1)?.low)).toBe(71233.8);
        await page.screenshot({ path: 'test-results/audit-live-trade-rest-fallback.png', fullPage: true });
    });

    test('contributors modalı net katkı, yüzde ve aile tavanını gösterir', async ({ page }) => {
        await injectActiveSignal(page);
        await expect(page.locator('#active-contributors-btn')).toBeVisible();
        await page.locator('#active-contributors-btn').click();
        await expect(page.locator('#signal-detail-dialog')).toBeVisible();
        await expect(page.locator('#signal-detail-summary')).toContainText('Contributors');
        await expect(page.locator('#signal-detail-summary')).toContainText('2 strateji · 8.00 net');

        const rows = page.locator('#signal-contributors-body tr');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toContainText('Hacimli Kırılım');
        await expect(rows.nth(0)).toContainText('4.80 · %60.0');
        await expect(rows.nth(1)).toContainText('3.20 · %40.0');
        await expect(rows.nth(0).locator('.contribution-meter i')).toHaveAttribute('style', 'width:60%');
        await expect(rows.nth(0).locator('.contribution-cell')).toHaveAttribute('title', 'Aile tavanı katsayısı: ×0.693');

        await page.screenshot({ path: 'test-results/desktop-contributors.png', fullPage: true });
        await page.locator('#close-signal-detail-btn').click();
        await expect(page.locator('#signal-detail-dialog')).toBeHidden();

        page.once('dialog', dialog => dialog.accept());
        await page.locator('#clear-signals-btn').click();
        await expect(page.locator('#signals-body')).toContainText('Henüz sinyal yok.');
        await expect(page.locator('#active-contributors-btn')).toBeHidden();
    });
});

test.describe('mobil uygulama akışı', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test.beforeEach(async ({ page }) => {
        await preparePage(page);
    });

    test('alt navigasyon bütün ekranları açar ve seçimi yenilemede korur', async ({ page }) => {
        await expect(page.locator('#mobile-tabbar')).toBeVisible();
        await expect(page.locator('.control-panel')).toBeVisible();
        await expect(page.locator('.market-panel')).toBeHidden();
        await expect(page.locator('#mobile-page-title')).toHaveText('Ana Sayfa');
        const tabbarHeight = await page.locator('#mobile-tabbar').evaluate(node => node.getBoundingClientRect().height);
        expect(tabbarHeight).toBe(70);
        const suffixHeight = await page.locator('.symbol-field b').evaluate(node => node.getBoundingClientRect().height);
        expect(suffixHeight).toBeLessThan(24);
        await page.screenshot({ path: 'test-results/audit-01-home-top.png' });
        await page.locator('.app-shell').evaluate(node => { node.scrollTop = node.scrollHeight; });
        await page.screenshot({ path: 'test-results/audit-02-home-bottom.png' });

        await page.evaluate(() => {
            const now = Date.now();
            const interval = 60_000;
            window.app.candles = Array.from({ length: 180 }, (_, index) => {
                const wave = Math.sin(index / 8) * 45;
                const close = 83500 + index * 0.32 + wave;
                const open = close - Math.cos(index / 5) * 18;
                return {
                    time: now - (180 - index) * interval,
                    closeTime: now - (179 - index) * interval - 1,
                    open,
                    high: Math.max(open, close) + 16,
                    low: Math.min(open, close) - 14,
                    close,
                    volume: 80 + (index % 24) * 5,
                    closed: true
                };
            });
            window.app.marketData.price = window.app.candles.at(-1).close;
            window.app.marketData.change24h = 1.42;
            window.app.marketData.volume24h = 245_000_000;
            window.app.chartManager.setData(window.app.candles);
            window.app.orderBook = {
                asks: [['83560.20', '0.12'], ['83561.00', '2.39'], ['83562.10', '0.08'], ['83563.40', '1.35']].map(row => row.map(Number)),
                bids: [['83559.80', '1.76'], ['83559.20', '0.31'], ['83558.60', '0.82'], ['83557.90', '1.18']].map(row => row.map(Number))
            };
            window.app.renderPrice();
            document.getElementById('chart-empty').classList.add('hidden');
            document.getElementById('heatmap-empty').classList.add('hidden');
        });

        await page.locator('#mobile-tabbar [data-mobile-view="market"]').click();
        await expect(page.locator('.market-panel')).toBeVisible();
        await expect(page.locator('.control-panel')).toBeHidden();
        await expect(page.locator('#mobile-page-title')).toHaveText('Piyasa');
        await expect.poll(() => page.evaluate(() => window.app.chartManager.pricePrecision)).toBe(2);
        const chartLayout = await page.evaluate(() => {
            const tools = document.querySelector('.chart-tools').getBoundingClientRect();
            const chartElement = document.getElementById('live-chart').getBoundingClientRect();
            const chart = window.app.chartManager.chart;
            const range = chart.timeScale().getVisibleLogicalRange();
            return {
                controlsRight: tools.right,
                chartRight: chartElement.right,
                priceScaleWidth: chart.priceScale('right').width(),
                seriesPrecision: window.app.chartManager.candles.options().priceFormat.precision,
                visibleBars: range ? range.to - range.from : null
            };
        });
        expect(chartLayout.seriesPrecision).toBe(2);
        expect(chartLayout.controlsRight).toBeLessThan(chartLayout.chartRight - chartLayout.priceScaleWidth - 8);
        expect(chartLayout.visibleBars).toBeGreaterThanOrEqual(50);
        expect(chartLayout.visibleBars).toBeLessThanOrEqual(62);
        await page.screenshot({ path: 'test-results/audit-03-market-chart.png' });
        await page.evaluate(() => window.app.toggleTheme());
        await page.screenshot({ path: 'test-results/audit-03b-market-chart-light.png' });
        await page.locator('#heatmap-view-btn').click();
        await page.screenshot({ path: 'test-results/audit-04-market-heatmap.png' });

        await page.locator('#mobile-tabbar [data-mobile-view="signals"]').click();
        await expect(page.locator('.signals-panel')).toBeVisible();
        await expect(page.locator('#mobile-page-title')).toHaveText('Sinyaller');
        await expect(page.locator('#mobile-signal-badge')).toBeHidden();
        await page.screenshot({ path: 'test-results/audit-05-signals-empty.png' });

        await page.locator('#mobile-tabbar [data-mobile-view="learning"]').click();
        await expect(page.locator('.learning-panel')).toBeVisible();
        await expect(page.locator('#mobile-page-title')).toHaveText('Öğrenme');
        await page.screenshot({ path: 'test-results/audit-06-learning-top.png' });
        await page.locator('.app-shell').evaluate(node => { node.scrollTop = node.scrollHeight; });
        await page.screenshot({ path: 'test-results/audit-07-learning-bottom.png' });
        const shellOverflow = await page.locator('.app-shell').evaluate(node => node.scrollWidth - node.clientWidth);
        expect(shellOverflow).toBeLessThanOrEqual(1);

        await page.reload();
        await page.waitForFunction(() => Boolean(window.app));
        await expect(page.locator('.learning-panel')).toBeVisible();
        await expect(page.locator('#mobile-tabbar [data-mobile-view="learning"]')).toHaveClass(/active/);
    });

    test('mobil ayarlar, contributors ve dokunma hedefleri uygulama gibi çalışır', async ({ page }) => {
        await injectActiveSignal(page);
        await expect(page.locator('#mobile-signal-badge')).toHaveText('1');

        await page.locator('[data-mobile-view="signals"]').click();
        await page.locator('#active-contributors-btn').click();
        await expect(page.locator('#signal-detail-dialog')).toBeVisible();
        await expect(page.locator('#signal-contributors-body')).toContainText('4.80 · %60.0');
        await page.screenshot({ path: 'test-results/audit-08-contributors-modal.png' });
        const contributorOverflow = await page.locator('#signal-detail-dialog .dialog-body').evaluate(node => node.scrollWidth - node.clientWidth);
        expect(contributorOverflow).toBeLessThanOrEqual(1);
        const detailBox = await page.locator('#signal-detail-dialog').boundingBox();
        expect(detailBox.width).toBe(390);
        expect(detailBox.height).toBe(844);
        await page.locator('#close-signal-detail-btn').click();

        await page.locator('#mobile-settings-tab').click();
        await expect(page.locator('#settings-dialog')).toBeVisible();
        await page.screenshot({ path: 'test-results/audit-09-settings-top.png' });
        const settingsBody = page.locator('#settings-dialog .dialog-body');
        await page.locator('[data-settings-target="settings-safety"]').click();
        await expect(page.locator('[data-settings-target="settings-safety"]')).toHaveClass(/active/);
        await expect(page.locator('#settings-safety')).toBeInViewport();
        await page.screenshot({ path: 'test-results/audit-10-settings-middle.png' });
        await page.locator('[data-settings-target="settings-strategies"]').click();
        await expect(page.locator('[data-settings-target="settings-strategies"]')).toHaveClass(/active/);
        await expect(page.locator('#settings-strategies')).toBeInViewport();
        await page.screenshot({ path: 'test-results/audit-11-settings-bottom.png' });
        const settingsOverflow = await settingsBody.evaluate(node => node.scrollWidth - node.clientWidth);
        expect(settingsOverflow).toBeLessThanOrEqual(1);
        const settingsBox = await page.locator('#settings-dialog').boundingBox();
        expect(settingsBox.width).toBe(390);
        expect(settingsBox.height).toBe(844);
        await page.locator('#close-settings-btn').click();
        await expect(page.locator('#settings-dialog')).toBeHidden();

        const tabHeight = await page.locator('[data-mobile-view="home"]').evaluate(node => node.getBoundingClientRect().height);
        expect(tabHeight).toBeGreaterThanOrEqual(54);
        await page.screenshot({ path: 'test-results/mobile-app.png', fullPage: true });
    });
});

test.describe('dar mobil görünüm', () => {
    test.use({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });

    test('320px ekranda bütün sekmeler ve ayarlar yatay taşma üretmez', async ({ page }) => {
        await preparePage(page);
        for (const view of ['home', 'market', 'signals', 'learning']) {
            await page.locator(`#mobile-tabbar [data-mobile-view="${view}"]`).click();
            const overflow = await page.locator('.app-shell').evaluate(node => node.scrollWidth - node.clientWidth);
            expect(overflow, `${view} yatay taşma`).toBeLessThanOrEqual(1);
        }
        await page.locator('#mobile-settings-tab').click();
        await expect(page.locator('.settings-section-nav')).toBeVisible();
        const dialogOverflow = await page.locator('#settings-dialog').evaluate(node => node.scrollWidth - node.clientWidth);
        expect(dialogOverflow).toBeLessThanOrEqual(1);
        await page.screenshot({ path: 'test-results/audit-12-settings-320px.png' });
    });
});
