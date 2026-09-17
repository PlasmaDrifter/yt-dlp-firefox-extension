const express = require('express');
const bodyParser = require('body-parser');
const { exec, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 16800;

app.use(bodyParser.json());

// Enable CORS so browser extension can POST to 127.0.0.1:16800
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.post('/download', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).send('No URL provided.');

    console.log(`[yt-dlp-bridge] Downloading: ${url}`);

    // Resolve script path dynamically
    const xdgScript = path.join(os.homedir(), '.local', 'share', 'yt-dlp-bridge', 'yt-dlp-cli.sh');
    const localBinScript = path.join(os.homedir(), '.local', 'bin', 'yt-dlp-cli.sh');
    const homeScript = path.join(os.homedir(), 'Scripts', 'yt-dlp-cli.sh');
    const localScript = path.join(__dirname, 'yt-dlp-cli.sh');

    let scriptPath = null;
    if (fs.existsSync(xdgScript)) {
        scriptPath = xdgScript;
    } else if (fs.existsSync(localBinScript)) {
        scriptPath = localBinScript;
    } else if (fs.existsSync(homeScript)) {
        scriptPath = homeScript;
    } else if (fs.existsSync(localScript)) {
        scriptPath = localScript;
    }

    if (scriptPath) {
        exec(`"${scriptPath}" "${url}"`, (err, stdout, stderr) => {
            if (err) {
                console.error('[yt-dlp-bridge] Error:', stderr || err);
                return;
            }
            console.log('[yt-dlp-bridge] Output:', stdout);
        });
    } else {
        // Fallback: spawn yt-dlp directly into ~/Downloads
        const downloadDir = path.join(os.homedir(), 'Downloads');
        const proc = spawn('yt-dlp', ['-P', downloadDir, url], { detached: true, stdio: 'ignore' });
        proc.unref();
    }

    res.send('Download started');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'yt-dlp-bridge' });
});

app.listen(port, '127.0.0.1', () => {
    console.log(`yt-dlp bridge server listening at http://127.0.0.1:${port}`);
});
