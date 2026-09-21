const express = require('express');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const { execFile, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 16800;

// Rate limiting to prevent denial of service (CWE-770)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    message: { error: 'Too many requests, please try again later.' },
});

app.use(limiter);
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

function resolveScriptPath() {
    const candidatePaths = [
        path.join(os.homedir(), '.local', 'share', 'yt-dlp-bridge', 'yt-dlp-cli.sh'),
        path.join(os.homedir(), '.local', 'bin', 'yt-dlp-cli.sh'),
        path.join(os.homedir(), 'Scripts', 'yt-dlp-cli.sh'),
        path.join(__dirname, 'yt-dlp-cli.sh'),
    ];

    for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

app.post('/download', limiter, (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
        return res.status(400).send('No URL provided.');
    }

    // Validate URL protocol to prevent command/argument injection
    let targetUrl;
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return res.status(400).send('Invalid URL protocol. Only HTTP and HTTPS are supported.');
        }
        targetUrl = parsedUrl.href;
    } catch {
        return res.status(400).send('Invalid URL format.');
    }

    console.log(`[yt-dlp-bridge] Downloading: ${targetUrl}`);

    const scriptPath = resolveScriptPath();

    if (scriptPath) {
        execFile(scriptPath, [targetUrl], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                console.error('[yt-dlp-bridge] Error:', stderr || err);
                return;
            }
            console.log('[yt-dlp-bridge] Output:', stdout);
        });
    } else {
        // Fallback: spawn yt-dlp directly into ~/Downloads
        const downloadDir = path.join(os.homedir(), 'Downloads');
        const proc = spawn('yt-dlp', ['-P', downloadDir, targetUrl], { detached: true, stdio: 'ignore' });
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
