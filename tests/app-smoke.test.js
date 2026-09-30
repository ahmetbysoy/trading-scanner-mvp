const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(id = '') {
    const classes = new Set();
    const listeners = {};
    const element = {
        id,
        value: '',
        checked: false,
        disabled: false,
        hidden: false,
        textContent: '',
        innerHTML: '',
        className: '',
        style: {},
        dataset: {},
        attributes: {},
        clientWidth: 900,
        clientHeight: 500,
        parentElement: null,
        options: [{ text: 'Otomatik' }],
        selectedIndex: 0,
        classList: {
            add(...names) { names.forEach(name => classes.add(name)); },
            remove(...names) { names.forEach(name => classes.delete(name)); },
            contains(name) { return classes.has(name); },
            toggle(name, force) {
                const enabled = force === undefined ? !classes.has(name) : force;
                if (enabled) classes.add(name); else classes.delete(name);
                return enabled;
            }
        },
        addEventListener(name, handler) { (listeners[name] ||= []).push(handler); },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        appendChild() {},
        prepend() {},
        remove() {},
        click() { (listeners.click || []).forEach(handler => handler({ currentTarget: this, target: this })); },
        showModal() { this.open = true; },
        close() {
            this.open = false;
            (listeners.close || []).forEach(handler => handler({ currentTarget: this, target: this }));
        },
        scrollTo(options) { this.scrollTop = options?.top ?? 0; },
        getContext() {
            return {
                clearRect() {}, setTransform() {}, fillRect() {}, fillText() {},
                beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
                fillStyle: '', strokeStyle: '', font: '', textAlign: ''
            };
        }
    };
    element.parentElement = element;
    return element;
}

function createBrowserContext() {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const ids = [...html.matchAll(/\bid=["']([^"']+)/g)].map(match => match[1]);
    const elements = new Map(ids.map(id => [id, createElement(id)]));
    const windowListeners = {};
    const storage = new Map();

    const documentElement = createElement('html');
    documentElement.dataset.theme = 'dark';
    const body = createElement('body');
    const mobileTabs = ['home', 'market', 'signals', 'learning'].map(view => {
        const tab = createElement(`mobile-tab-${view}`);
        tab.dataset.mobileView = view;
        return tab;
    });
    const settingsTab = elements.get('mobile-settings-tab');
    settingsTab.dataset.mobileAction = 'settings';
    const appShell = createElement('app-shell');
    const document = {
        documentElement,
        body,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, createElement(id));
            return elements.get(id);
        },
        querySelector(selector) {
            if (selector === '.app-shell') return appShell;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '#mobile-tabbar [data-mobile-view]') return mobileTabs;
            if (selector === '#mobile-tabbar .mobile-tab') return [...mobileTabs, settingsTab];
            return [];
        },
        createElement: id => createElement(id)
    };

    const series = () => ({
        setData() {}, update() {}, applyOptions() {}, setMarkers() {}
    });
    const chart = {
        addCandlestickSeries: series,
        addHistogramSeries: series,
        resize() {}, applyOptions() {},
        timeScale() {
            return {
                fitContent() {},
                getVisibleLogicalRange: () => ({ from: 0, to: 100 }),
                setVisibleLogicalRange() {}
            };
        }
    };

    const context = {
        console,
        document,
        navigator: {},
        isSecureContext: false,
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        LightweightCharts: {
            createChart: () => chart,
            CrosshairMode: { Normal: 0 }
        },
        ResizeObserver: class { observe() {} disconnect() {} },
        getComputedStyle: () => ({ getPropertyValue: () => '#8090a6' }),
        requestAnimationFrame: callback => callback(),
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Blob,
        URL,
        Math,
        Date,
        JSON,
        Map,
        Set,
        Promise,
        Number,
        String,
        Array,
        Object,
        Error,
        WebSocket: class {},
        confirm: () => true,
        addEventListener(name, handler) { (windowListeners[name] ||= []).push(handler); }
    };
    context.window = context;
    context.globalThis = context;
    context.windowListeners = windowListeners;
    context.elements = elements;
    context.mobileTabs = mobileTabs;
    context.appShell = appShell;
    return vm.createContext(context);
}

function runScript(context, relativePath) {
    const filename = path.join(__dirname, '..', relativePath);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}

test('uygulama null ticker verisiyle hatasız açılır ve adaptif paneli oluşturur', async () => {
    const context = createBrowserContext();
    runScript(context, 'src/adaptive-learning.js');
    runScript(context, 'src/confluence-engine.js');
    runScript(context, 'src/app.js');

    for (const handler of context.windowListeners.DOMContentLoaded || []) handler();
    await Promise.resolve();
    await Promise.resolve();

    assert.ok(context.app, `startup failed: ${context.document.body.innerHTML}`);
    assert.equal(context.elements.get('ticker-change').textContent, '—');
    assert.equal(context.elements.get('learning-mode').value, 'auto');
    assert.match(context.elements.get('learning-status').textContent, /Warm-up/);

    context.app.signals = [{
        id: 'sig-detail', timestamp: Date.now(), symbol: 'BTCUSDT', timeframe: '15m',
        direction: 'buy', price: 100, tp: 102, sl: 99, score: 6, rawScore: 7,
        confirmations: 2, regime: 'trend-up:normal', status: 'active',
        details: [{
            strategy: 'breakoutPattern', reason: 'Hacimli kırılım', baseScore: 4,
            adaptiveWeight: 1.1, regimeFactor: 1.05, score: 4.62,
            evidenceFamily: 'momentum'
        }],
        diagnostics: { scoreLead: 4, independentFamilies: 2, conviction: { windows: 2, elapsedMs: 900 } }
    }];
    context.app.openSignalDetail('sig-detail');
    assert.match(context.elements.get('signal-contributors-body').innerHTML, /Hacimli kırılım/);
    assert.equal(context.elements.get('signal-detail-dialog').open, true);
});

test('mobil alt menü ekran değiştirir, görünümü saklar ve ayar sayfasını açar', async () => {
    const context = createBrowserContext();
    runScript(context, 'src/adaptive-learning.js');
    runScript(context, 'src/confluence-engine.js');
    runScript(context, 'src/app.js');

    for (const handler of context.windowListeners.DOMContentLoaded || []) handler();
    await Promise.resolve();

    assert.equal(context.document.body.dataset.mobileView, 'home');
    assert.equal(context.elements.get('mobile-page-title').textContent, 'Ana Sayfa');

    const marketTab = context.mobileTabs.find(tab => tab.dataset.mobileView === 'market');
    marketTab.click();
    assert.equal(context.document.body.dataset.mobileView, 'market');
    assert.equal(context.elements.get('mobile-page-title').textContent, 'Piyasa');
    assert.equal(marketTab.classList.contains('active'), true);
    assert.equal(marketTab.getAttribute('aria-selected'), 'true');
    assert.equal(JSON.parse(context.localStorage.getItem('utc_mobile_view')), 'market');

    const settingsTab = context.elements.get('mobile-settings-tab');
    settingsTab.click();
    assert.equal(context.elements.get('settings-dialog').open, true);
    assert.equal(settingsTab.classList.contains('active'), true);
    context.elements.get('settings-dialog').close();
    assert.equal(settingsTab.classList.contains('active'), false);
    assert.equal(marketTab.classList.contains('active'), true);

    context.app.signals = [{
        id: 'active', status: 'active', timestamp: Date.now(), direction: 'buy',
        price: 100, score: 6, confirmations: 2, reason: 'test'
    }];
    context.app.renderSignals();
    assert.equal(context.elements.get('mobile-signal-badge').hidden, false);
    assert.equal(context.elements.get('mobile-signal-badge').textContent, '1');
});

test('mobil uygulama kabuğu güvenli alan ve erişilebilir navigasyon içerir', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));

    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /<nav[^>]+mobile-tabbar[^>]+aria-label=/);
    assert.equal((html.match(/class="mobile-tab/g) || []).length >= 5, true);
    assert.match(css, /env\(safe-area-inset-bottom\)/);
    assert.match(css, /min-height:\s*54px/);
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.lang, 'tr');
});
