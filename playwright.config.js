const { defineConfig } = require('@playwright/test');
const chromium = require('@sparticuz/chromium').default;

module.exports = defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    expect: { timeout: 6_000 },
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    reporter: [['list'], ['html', { open: 'never' }]],
    outputDir: 'test-results',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul',
        serviceWorkers: 'block',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
        launchOptions: {
            executablePath: '/tmp/chromium',
            args: chromium.args.filter(arg => arg !== '--single-process' && arg !== '--no-zygote'),
            env: {
                ...process.env,
                LD_LIBRARY_PATH: '/tmp/al2023/lib'
            }
        }
    },
    webServer: {
        command: 'python3 -m http.server 4173 --bind 0.0.0.0',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        timeout: 30_000
    }
});
