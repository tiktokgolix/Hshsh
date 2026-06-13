/**
 * ============================================================
 * CLIPHOOK SERVER — VERSIONE AGGIORNATA E ANTIBLOCCO
 * ============================================================
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { YoutubeTranscript } = require('youtube-transcript');

const PORT = process.env.PORT || 3000;

// Token statico di autenticazione per l'app HTML
const AUTH_TOKEN =
  process.env.AUTH_TOKEN ||
  'K9xW2mQpL8nRjT4wYbA6cXeZsDuF3hGiN7oV1tW0_CLIPHOOK_PRIVATE';

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'projects.json');

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({}), 'utf8');
  }
}
ensureDB();

function loadProjects() {
  try {
    ensureDB();
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data || '{}');
  } catch (e) {
    console.error('Errore lettura DB JSON, uso cache vuota:', e);
    return {};
  }
}

function saveProjects(projects) {
  try {
    ensureDB();
    fs.writeFileSync(DB_PATH, JSON.stringify(projects, null, 2), 'utf8');
  } catch (e) {
    console.error('Errore scrittura DB JSON:', e);
  }
}

let projectsCache = loadProjects();

const app = express();
app.use(cors());
app.use(express.json());

// Middleware di Autenticazione h24
function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Token non valido o mancante.' });
  }
  next();
}

// Estrazione ID Video
function extractVideoId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

// ============================================================
// 1. ENDPOINT: POST /api/fetch-video (Migliorato e Resiliente)
// ============================================================
app.post('/api/fetch-video', authMiddleware, async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, message: 'URL mancante.' });
  }

  try {
    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ success: false, message: 'URL di YouTube non valido.' });
    }

    // Recupero Dati Base via oEmbed ufficiale (Gratuito, sicuro e MAI bloccato da Cloudflare/YouTube)
    let title = 'Video di YouTube';
    let thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        title = oembedData.title || title;
      }
    } catch (e) {
      console.log('Avviso oEmbed non raggiungibile, uso fallback statico.');
    }

    let transcriptText = '';
    let status = 'Pronto per AI';

    try {
      // Tentativo di estrazione pulito con user-agent simulato per bypassare i filtri base
      const transcriptTracks = await YoutubeTranscript.fetchTranscript(videoId, {
        lang: 'it',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      });
      transcriptText = transcriptTracks.map((t) => t.text).join(' ');
    } catch (err) {
      console.log(`YouTube ha bloccato la richiesta di trascrizione automatica per il video ${videoId}. Attivo modalità resiliente.`);
      // Non mandiamo in errore l'app! Creiamo un testo alternativo istruttivo per l'utente
      transcriptText = `[ATTENZIONE: I sottotitoli automatici non sono stati estratti dal server a causa delle protezioni anti-bot di YouTube. Puoi comunque usare questa card per salvare i dati o incollare i risultati dell'AI direttamente se possiedi il testo del video.]`;
      status = 'Completato (senza trascrizione)';
    }

    // Generazione del prompt (anche se vuoto, l'interfaccia non si rompe)
    const aiPrompt = `Sei un esperto copywriter ed editor video specializzato in contenuti verticali corti e virali.
Analizza accuratamente questa trascrizione e seleziona le 5 clip con il più alto potenziale di viralità.

Regole tassative per la risposta:
- Devi rispondere ESCLUSIVAMENTE con un oggetto JSON valido. Nessun testo prima o dopo il codice JSON.
- Non aggiungere saluti, introduzioni o commenti cortesi.

Formato della risposta richiesto (JSON puro):
{
  "videoRating": {
    "score": 85,
    "motivazione": "Spiegazione sintetica del perché il video può o non può funzionare sui social."
  },
  "clips": [
    {
      "rank": 1,
      "start_time": "MM:SS",
      "end_time": "MM:SS",
      "titolo": "Titolo accattivante della clip",
      "hook": "La prima frase pronunciata (gancio)",
      "motivazione": "Perché questa clip è virale",
      "viral_score": 92
    }
  ]
}

Ecco la trascrizione del video da analizzare:
${transcriptText}`;

    const newProject = {
      videoId,
      title,
      url,
      thumbnail,
      status,
      aiPrompt,
      videoRating: { score: 0, motivazione: '' },
      clips: [],
      createdAt: new Date().toISOString(),
    };

    projectsCache[videoId] = newProject;
    saveProjects(projectsCache);

    return res.json({ success: true, project: newProject });

  } catch (globalErr) {
    console.error('Errore fatale globale:', globalErr);
    return res.status(500).json({ success: false, message: 'Errore interno del server.' });
  }
});

// ============================================================
// 2. ENDPOINT: GET /api/projects
// ============================================================
app.get('/api/projects', authMiddleware, (req, res) => {
  const list = Object.values(projectsCache).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json({ success: true, projects: list });
});

// ============================================================
// 3. ENDPOINT: GET /api/projects/:videoId
// ============================================================
app.get('/api/projects/:videoId', authMiddleware, (req, res) => {
  const { videoId } = req.params;
  const project = projectsCache[videoId];
  if (!project) {
    return res.status(404).json({ success: false, message: 'Progetto non trovato.' });
  }
  res.json({ success: true, project });
});

// ============================================================
// 4. ENDPOINT: POST /api/projects/:videoId/clips
// ============================================================
app.post('/api/projects/:videoId/clips', authMiddleware, (req, res) => {
  const { videoId } = req.params;
  const aiData = req.body;

  const project = projectsCache[videoId];
  if (!project) {
    return res.status(404).json({ success: false, message: 'Progetto non trovato.' });
  }

  const videoRating = aiData.videoRating || { score: 70, motivazione: 'Elaborato' };
  let rawClips = aiData.clips || [];

  const processedClips = rawClips.map((c) => {
    const cleanTitle = (c.titolo || 'clip').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const cmd = `yt-dlp -f "bestvideo+bestaudio" --merge-output-format mp4 --postprocessor-args "ffmpeg:-ss ${c.start_time} -to ${c.end_time}" -o "clip_${cleanTitle}.mp4" "https://www.youtube.com/watch?v=${videoId}"`;
    return {
      rank: c.rank || 1,
      start_time: c.start_time || '00:00',
      end_time: c.end_time || '00:15',
      titolo: c.titolo || 'Senza titolo',
      hook: c.hook || '',
      motivazione: c.motivazione || '',
      viral_score: c.viral_score || 50,
      ytDlpCommand: cmd,
    };
  });

  project.videoRating = videoRating;
  project.clips = processedClips;
  project.status = 'Analizzato';

  projectsCache[videoId] = project;
  saveProjects(projectsCache);

  res.json({ success: true, project });
});

// ============================================================
// 5. ENDPOINT: DELETE /api/projects/:videoId
// ============================================================
app.delete('/api/projects/:videoId', authMiddleware, (req, res) => {
  const { videoId } = req.params;
  if (!projectsCache[videoId]) {
    return res.status(404).json({ success: false, message: 'Progetto non trovato.' });
  }
  delete projectsCache[videoId];
  saveProjects(projectsCache);
  res.json({ success: true, message: 'Progetto eliminato.' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint non trovato.' });
});

app.listen(PORT, () => {
  console.log(`Server ClipHook attivo sulla porta ${PORT}`);
});
