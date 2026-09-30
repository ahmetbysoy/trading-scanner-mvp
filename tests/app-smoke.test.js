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
        appendChild() {},
        prepend() {},
        remove() {},
        click() {},
        showModal() { this.open = true; },
        close() { this.open = false; },
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
    const document = {
        documentElement,
        body,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, createElement(id));
            return elements.get(id);
        },
        querySelectorAll() { return []; },
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
});
