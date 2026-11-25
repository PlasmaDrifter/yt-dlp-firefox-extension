const express = require('express');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
const HOST = '127.0.0.1';
const PORT = Number(process.env.YTDLP_BRIDGE_PORT) || 16800;
const BRIDGE_VERSION = '1.1.1';
const FINISHED_RETENTION_MS = 3600 * 1000;

const MODE_FLAGS = {
    default: [],
    audio: ['-x'],
    single: ['--no-playlist'],
    playlist: ['--yes-playlist'],
};

const activeJobs = new Map();

function isAllowedHost(hostHeader) {
    if (!hostHeader) return false;
    const norm = hostHeader.trim().toLowerCase();
    return (
        norm === `127.0.0.1:${PORT}` ||
        norm === `localhost:${PORT}` ||
        norm === `[::1]:${PORT}` ||
        norm === '127.0.0.1' ||
        norm === 'localhost' ||
        norm === '[::1]'
    );
}

function isAllowedOrigin(originHeader) {
    if (!originHeader) return true;
    if (/[\r\n\0]/.test(originHeader)) return false;
    return /^moz-extension:\/\/[a-zA-Z0-9._-]+$/i.test(originHeader.trim());
}

function getConfiguredDestination() {
    const home = os.homedir();
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const candidates = [
        path.join(xdgConfig, 'yt-dlp', 'config'),
        path.join(xdgConfig, 'yt-dlp.conf'),
        path.join(home, '.yt-dlp.conf'),
        '/etc/yt-dlp.conf',
    ];
    for (const cfgPath of candidates) {
        if (!fs.existsSync(cfgPath)) continue;
        try {
            const lines = fs.readFileSync(cfgPath, 'utf8').split(/\r?\n/);
            for (const raw of lines) {
                const line = raw.trim();
                if (!line || line.startsWith('#')) continue;
                const m = line.match(/^(?:-P|--paths)\s+(?:home:)?(?:"([^"]+)"|'([^']+)'|(\S+))/);
                if (m) {
                    const rawVal = m[1] || m[2] || m[3];
                    if (rawVal.startsWith('temp:')) continue;
                    const expanded = rawVal.startsWith('~/') ? path.join(home, rawVal.slice(2)) : rawVal;
                    return expanded.startsWith(home) ? `~${expanded.slice(home.length)}` : expanded;
                }
            }
        } catch {
            // Ignore unreadable config
        }
    }
    return '~/Downloads';
}

function cleanupOldJobs() {
    const now = Date.now();
    for (const [id, job] of activeJobs.entries()) {
        if (job.finishedAt !== null && now - job.finishedAt > FINISHED_RETENTION_MS) {
            activeJobs.delete(id);
        }
    }
}

const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

app.use(limiter);
app.use((req, res, next) => {
    if (!isAllowedHost(req.headers.host)) {
        return res.status(403).json({ error: 'Forbidden host header' });
    }
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
        return res.status(403).json({ error: 'Forbidden origin' });
    }
    if (origin) {
        const cleanOrigin = origin.trim().replace(/[\r\n\0]/g, '');
        res.header('Access-Control-Allow-Origin', cleanOrigin);
        res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    if (req.method === 'POST') {
        const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (ctype !== 'application/json') {
            return res.status(415).json({ error: 'Content-Type must be application/json' });
        }
    }
    next();
});
app.use(bodyParser.json({ limit: '64kb' }));

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'yt-dlp-bridge',
        version: BRIDGE_VERSION,
        platform: process.platform,
        ytdlp_found: true,
        destination: getConfiguredDestination(),
    });
});

app.get('/downloads', (req, res) => {
    cleanupOldJobs();
    const now = Date.now();
    const downloads = Array.from(activeJobs.values()).map((j) => ({
        id: j.id,
        url: j.url,
        title: j.title,
        mode: j.mode,
        percent: j.percent,
        speed: j.speed,
        eta: j.eta,
        size: j.size,
        status: j.status,
        error: j.error,
        filename: j.filename,
        created_at: j.createdAt / 1000,
        finished_at: j.finishedAt !== null ? j.finishedAt / 1000 : null,
        elapsed_since_finished: j.finishedAt !== null ? Number(((now - j.finishedAt) / 1000).toFixed(1)) : null,
    }));
    res.json({ downloads });
});

app.post('/download', (req, res) => {
    const { url, title, mode = 'default' } = req.body || {};
    if (!url || typeof url !== 'string' || /[\r\n\0]/.test(url)) {
        return res.status(400).json({ error: 'Invalid or missing URL.' });
    }
    if (!Object.hasOwn(MODE_FLAGS, mode)) {
        return res.status(400).json({ error: `Invalid download mode: ${mode}` });
    }

    let targetUrl;
    try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return res.status(400).json({ error: 'Invalid URL protocol. Only HTTP and HTTPS are supported.' });
        }
        targetUrl = parsed.href;
    } catch {
        return res.status(400).json({ error: 'Invalid URL format.' });
    }

    const jobId = `dl-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const args = ['--newline', ...MODE_FLAGS[mode], '--', targetUrl];
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const job = {
        id: jobId,
        url: targetUrl,
        title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 300) : targetUrl,
        mode,
        percent: 0,
        speed: '',
        eta: '',
        size: '',
        status: 'starting',
        error: '',
        filename: '',
        proc,
        createdAt: Date.now(),
        finishedAt: null,
    };
    activeJobs.set(jobId, job);

    const onOutput = (chunk) => {
        for (const rawLine of chunk.toString('utf8').split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            const errMatch = line.match(/^ERROR:\s*(.+)/);
            if (errMatch) {
                job.error = errMatch[1].slice(0, 240);
                continue;
            }
            const prog = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([^\s]+)(?:\s+in\s+[^\s]+)?(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([^\s]+))?/);
            if (prog) {
                job.percent = Math.min(100, Math.max(0, Number(prog[1])));
                if (prog[2] && !/^(?:N\/A|Unknown)$/i.test(prog[2])) job.size = prog[2];
                if (prog[3]) job.speed = prog[3];
                if (prog[4]) job.eta = prog[4];
                if (job.status !== 'cancelled') job.status = 'downloading';
            } else if (/\[(?:Merger|ExtractAudio|VideoRemuxer|VideoConvertor|EmbedSubtitle|Metadata)\]/.test(line)) {
                if (job.status !== 'cancelled') {
                    job.status = 'merging';
                    job.percent = 100;
                }
            }
        }
    };

    proc.stdout.on('data', onOutput);
    proc.stderr.on('data', onOutput);
    proc.on('close', (code) => {
        if (job.status === 'cancelled') {
            job.finishedAt = job.finishedAt || Date.now();
        } else if (code === 0) {
            job.status = 'completed';
            job.percent = 100;
            job.finishedAt = Date.now();
        } else {
            job.status = 'error';
            if (!job.error) job.error = `yt-dlp exited with code ${code}`;
            job.finishedAt = Date.now();
        }
    });

    res.json({ status: 'success', message: `Downloading ${targetUrl}`, job_id: jobId });
});

app.post('/cancel', (req, res) => {
    const { job_id: jobId } = req.body || {};
    if (!jobId || typeof jobId !== 'string') {
        return res.status(400).json({ error: 'Missing job_id' });
    }
    const job = activeJobs.get(jobId);
    if (!job) {
        return res.json({ status: 'not_found', job_id: jobId });
    }
    if (['starting', 'downloading', 'merging'].includes(job.status)) {
        job.status = 'cancelled';
        job.finishedAt = Date.now();
    }
    try {
        job.proc.kill('SIGTERM');
    } catch {
        // Ignore already exited
    }
    res.json({ status: 'cancelled', job_id: jobId });
});

app.post('/clear', (req, res) => {
    const { job_id: targetId } = req.body || {};
    const terminal = new Set(['completed', 'cancelled', 'error']);
    let clearedCount = 0;
    if (typeof targetId === 'string' && targetId) {
        const job = activeJobs.get(targetId);
        if (job && terminal.has(job.status)) {
            activeJobs.delete(targetId);
            clearedCount = 1;
        }
    } else {
        for (const [id, job] of activeJobs.entries()) {
            if (terminal.has(job.status)) {
                activeJobs.delete(id);
                clearedCount += 1;
            }
        }
    }
    res.json({ status: 'cleared', cleared_count: clearedCount });
});

app.listen(PORT, HOST, () => {
    console.log(`yt-dlp bridge server v${BRIDGE_VERSION} listening at http://${HOST}:${PORT}`);
});
