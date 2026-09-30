const { test, expect } = require('@playwright/test');

const chartLibraryMock = `
window.LightweightCharts = {
  CrosshairMode: { Normal: 0 },
  createChart() {
    const series = { setData(){}, update(){}, applyOptions(){}, setMarkers(){} };
    return {
      addCandlestickSeries(){ return { ...series }; },
      addHistogramSeries(){ return { ...series }; },
      resize(){}, applyOptions(){},
      timeScale(){
        return {
          fitContent(){},
          getVisibleLogicalRange(){ return { from: 0, to: 100 }; },
          setVisibleLogicalRange(){}
        };
      }
    };
  }
};`;

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
        body: chartLibraryMock
    }));
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.route('https://fapi.binance.com/**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(candleRows())
    }));
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
        await expect(page.locator('#connection-text')).toHaveText('CANLI');
        await expect(page.locator('#chart-empty')).toHaveClass(/hidden/);
        await expect(page.locator('#start-btn')).toBeDisabled();
        await expect(page.locator('#stop-btn')).toBeEnabled();

        await page.evaluate(() => {
            window.app.handleMarketData('btcusdt@ticker', {
                s: 'BTCUSDT', c: '65432.10', P: '2.75', q: '123456789'
            });
            window.app.handleMarketData('btcusdt@depth20@100ms', {
                b: [['65430', '12'], ['65420', '8']],
                a: [['65435', '10'], ['65445', '6']]
            });
        });
        await expect(page.locator('#ticker-price')).toContainText('65,432.10');
        await expect(page.locator('#ticker-change')).toHaveText('+2.75%');

        await page.locator('#learning-mode').selectOption('shadow');
        await expect.poll(() => page.evaluate(() => window.app.adaptiveLearning.state.mode)).toBe('shadow');

        const downloadPromise = page.waitForEvent('download');
        await page.locator('#export-learning-btn').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^utc-learning-BTCUSDT-\d+\.json$/);

        await page.locator('#stop-btn').click();
        await expect(page.locator('#connection-text')).toHaveText('DURDURULDU');
        await expect(page.locator('#start-btn')).toBeEnabled();
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

        await page.locator('[data-mobile-view="market"]').click();
        await expect(page.locator('.market-panel')).toBeVisible();
        await expect(page.locator('.control-panel')).toBeHidden();
        await expect(page.locator('#mobile-page-title')).toHaveText('Piyasa');

        await page.locator('[data-mobile-view="signals"]').click();
        await expect(page.locator('.signals-panel')).toBeVisible();
        await expect(page.locator('#mobile-page-title')).toHaveText('Sinyaller');

        await page.locator('[data-mobile-view="learning"]').click();
        await expect(page.locator('.learning-panel')).toBeVisible();
        await expect(page.locator('#mobile-page-title')).toHaveText('Öğrenme');

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
        const detailBox = await page.locator('#signal-detail-dialog').boundingBox();
        expect(detailBox.width).toBe(390);
        expect(detailBox.height).toBe(844);
        await page.locator('#close-signal-detail-btn').click();

        await page.locator('#mobile-settings-tab').click();
        await expect(page.locator('#settings-dialog')).toBeVisible();
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
