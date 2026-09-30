const path = require('node:path');

async function prepare() {
    const chromiumModule = require('@sparticuz/chromium');
    const chromium = chromiumModule.default;
    const binPath = path.join(__dirname, '..', 'node_modules', '@sparticuz', 'chromium', 'bin');
    await chromiumModule.inflate(path.join(binPath, 'al2023.tar.br'));
    const executablePath = await chromium.executablePath(binPath);
    process.stdout.write(`Playwright Chromium hazır: ${executablePath}\n`);
}

prepare().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
