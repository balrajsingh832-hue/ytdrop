const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Check yt-dlp installed hai ya nahi
function checkYtDlp(cb) {
  exec('yt-dlp --version', (err) => cb(!err));
}

// Video info fetch
app.get('/info', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL required' });

  exec(`yt-dlp --dump-json --no-playlist "${url}"`, { timeout: 30000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: 'Video fetch failed. Check URL.' });
    try {
      const data = JSON.parse(stdout);
      res.json({
        title: data.title,
        duration: formatDuration(data.duration),
        channel: data.uploader || data.channel,
        thumbnail: data.thumbnail,
        formats: (data.formats || [])
          .filter(f => f.ext === 'mp4' || f.vcodec !== 'none')
          .map(f => ({ format_id: f.format_id, quality: f.format_note || f.height + 'p', ext: f.ext }))
          .filter((v, i, a) => a.findIndex(x => x.quality === v.quality) === i)
      });
    } catch (e) {
      res.status(500).json({ error: 'Parse error' });
    }
  });
});

// Download
app.get('/download', (req, res) => {
  const { url, quality, format } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const tmpDir = os.tmpdir();
  const safeId = Date.now();
  const outTemplate = path.join(tmpDir, `ytdrop_${safeId}.%(ext)s`);

  let ytArgs = [];

  if (format === 'mp3') {
    const bitrate = (quality || '192kbps').replace('kbps', '');
    ytArgs = [
      '-x', '--audio-format', 'mp3',
      '--audio-quality', bitrate + 'K',
      '-o', outTemplate,
      '--no-playlist',
      url
    ];
  } else {
    // mp4 or webm
    let fmtStr = 'bestvideo+bestaudio/best';
    if (quality && quality !== 'best') {
      const h = quality.replace('p', '');
      fmtStr = `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`;
    }
    const ext = format === 'webm' ? 'webm' : 'mp4';
    ytArgs = [
      '-f', fmtStr,
      '--merge-output-format', ext,
      '-o', outTemplate,
      '--no-playlist',
      url
    ];
  }

  const yt = spawn('yt-dlp', ytArgs);
  let errOutput = '';

  yt.stderr.on('data', d => { errOutput += d.toString(); });
  yt.stdout.on('data', () => {});

  yt.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp error:', errOutput);
      return res.status(500).json({ error: 'Download failed: ' + errOutput.slice(0, 200) });
    }

    // Find the output file
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`ytdrop_${safeId}`));
    if (!files.length) return res.status(500).json({ error: 'Output file not found' });

    const filePath = path.join(tmpDir, files[0]);
    const ext = path.extname(files[0]);
    const dlName = `ytdrop_${safeId}${ext}`;

    res.setHeader('Content-Disposition', `attachment; filename="${dlName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('end', () => {
      fs.unlink(filePath, () => {});
    });
    stream.on('error', () => {
      res.status(500).json({ error: 'File stream error' });
    });
  });
});

function formatDuration(sec) {
  if (!sec) return '--:--';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

app.listen(PORT, () => {
  console.log(`\n✅ YTDrop server running at http://localhost:${PORT}\n`);
  checkYtDlp(ok => {
    if (ok) console.log('✅ yt-dlp found — ready to download!\n');
    else console.log('❌ yt-dlp NOT found! Run: pip install yt-dlp\n');
  });
});
