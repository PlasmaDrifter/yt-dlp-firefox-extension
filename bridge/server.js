const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
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

    // Run yt-dlp script in background
    exec(`/home/jmc/Scripts/yt-dlp-cli.sh "${url}"`, (err, stdout, stderr) => {
        if (err) {
            console.error('[yt-dlp-bridge] Error:', stderr || err);
            return;
        }
        console.log('[yt-dlp-bridge] Output:', stdout);
    });

    res.send('Download started');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'yt-dlp-bridge' });
});

app.listen(port, '127.0.0.1', () => {
    console.log(`yt-dlp bridge server listening at http://127.0.0.1:${port}`);
});
