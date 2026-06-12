/**
 * ============================================================
 * CLIPHOOK SERVER — DEFINITIVO & FIXATO
 * ============================================================
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { YoutubeTranscript } = require('youtube-transcript');

const PORT = process.env.PORT || 3000;

// Token statico di autenticazione privato per l'app
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'K9xW2mQpL8nRjT4wYbA6cXeZsDuF3hGiN7oV1tW0_CLIPHOOK_PRIVATE';

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'projects.json');

// Assicura l'esistenza del finto database locale
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({}), 'utf8');
}

function loadProjects() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

function saveProjects(projects) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(projects, null, 2), 'utf8');
  } catch (e) {
    console.error("Errore salvataggio DB:", e);
  }
}

const projectsCache = loadProjects();

const app = express();
app.use(cors());
app.use(express.json());

// Middleware Autenticazione con Token per bloccare gli accessi non autorizzati
function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Token non valido o mancante.' });
  }
  next();
}

// Utility per estrarre l'ID unico del video di YouTube
function extractVideoId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// ============================================================
// 1. ENDPOINT: POST /api/fetch-video (Estrae dati e testo)
// ============================================================
app.post('/api/fetch-video', authMiddleware, async (req, res) => {
  const { url } = req.body;
  const videoId = extractVideoId(url);

  if (!videoId) {
    return res.status(400).json({ success: false, error: 'InvalidURL', message: 'URL di YouTube non valido.' });
  }

  // Se il progetto esiste già nella cronologia, lo restituisce subito per non perdere tempo
  if (projectsCache[videoId]) {
    return res.json({ success: true, fromCache: true, project: projectsCache[videoId] });
  }

  try {
    // Generazione automatica sicura di Titolo provvisorio e Copertina reale HD
    const videoTitle = `Video YouTube (${videoId})`; 
    const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`; 

    console.log(`Estrazione testo per il video: ${videoId}`);
    
    // Estrazione automatica dei sottotitoli/trascrizione
    const transcriptData = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'it' }).catch(async () => {
      // Se fallisce in italiano, prova a prendere la lingua originale o di default del video
      return await YoutubeTranscript.fetchTranscript(videoId);
    });

    if (!transcriptData || transcriptData.length === 0) {
      throw new Error("Trascrizione vuota o non disponibile");
    }

    // Formatta tutto il testo accorpando i timestamp in minuti e secondi per facilitare la lettura all'AI
    let formattedTranscript = "";
    transcriptData.forEach(item => {
      const startSec = Math.floor(item.offset / 1000) || Math.floor(item.start);
      const min = Math.floor(startSec / 60).toString().padStart(2, '0');
      const sec = Math.floor(startSec % 60).toString().padStart(2, '0');
      formattedTranscript += `[${min}:${sec}] ${item.text}\n`;
    });

    // COSTRUZIONE DEL PROMPT STRATEGICO AVANZATO PER IL TUO SMARTPHONE
    const aiPrompt = `Sei un esperto di video virali e un ingegnere dei contenuti stile Opus Clip.
Analizza la trascrizione testuale di questo video di YouTube per estrarre le 5 clip (Shorts/TikTok) con il più alto potenziale di viralità.

Per ogni clip devi identificare:
1. Un titolo accattivante ed emotivo.
2. L'Hook (il gancio iniziale, la frase d'impatto dei primi 3 secondi).
3. Il tempo esatto di INIZIO e FINE (Formato MM:SS) basandoti sui timestamp forniti nel testo.
4. Un "Viral Score" da 1 a 100 con la motivazione strategica.

Inoltre, dai un voto globale al video ("video_rating") spiegando se l'argomento è forte o debole per i social.

RISPONDI ESCLUSIVAMENTE IN FORMATO JSON PURO. Non scrivere introduzioni, commenti o saluti prima o dopo. Il tuo output deve essere solo ed esclusivamente il JSON strutturato esattamente così:

{
  "video_rating": { "score": 85, "motivazione": "Spiegazione globale dell video..." },
  "clips": [
    {
      "rank": 1,
      "start_time": "MM:SS",
      "end_time": "MM:SS",
      "hook": "La primissima frase che si sente nella clip",
      "titolo": "Titolo della clip",
      "viral_score": 95,
      "motivazione": "Perché questa parte funzionerà un sacco nei primi secondi"
    }
  ]
}

Ecco il titolo del video: ${videoTitle}
Ecco la trascrizione con i timestamp da analizzare:
${formattedTranscript}`;

    // Salva il nuovo progetto creato nel database locale temporaneo
    const newProject = {
      videoId,
      title: videoTitle,
      thumbnail: thumbnailUrl,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      status: 'Pronto per AI',
      aiPrompt: aiPrompt,
      clips: null,
      videoRating: null,
      createdAt: new Date().toISOString()
    };

    projectsCache[videoId] = newProject;
    saveProjects(projectsCache);

    res.json({ success: true, fromCache: false, project: newProject });

  } catch (error) {
    console.error('Errore durante il fetch del video:', error);
    res.status(500).json({
      success: false,
      error: 'FetchError',
      message: 'Impossibile estrarre la trascrizione da questo video. Assicurati che abbia i sottotitoli abilitati su YouTube.',
      details: error.message
    });
  }
});

// ============================================================
// 2. ENDPOINT: GET /api/projects (Mostra l'HUB dei vecchi progetti)
// ============================================================
app.get('/api/projects', authMiddleware, (req, res) => {
  const list = Object.values(projectsCache).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, projects: list });
});

// ============================================================
// 3. ENDPOINT: GET /api/projects/:videoId (Dettaglio singolo video)
// ============================================================
app.get('/api/projects/:videoId', authMiddleware, (req, res) => {
  const { videoId } = req.params;
  const project = projectsCache[videoId];
  if (!project) {
    return res.status(404).json({ success: false, error: 'NotFound', message: 'Progetto non trovato.' });
  }
  res.json({ success: true, project });
});

// ============================================================
// 4. ENDPOINT: POST /api/projects/:videoId/clips (Incolla risposta AI)
// ============================================================
app.post('/api/projects/:videoId/clips', authMiddleware, (req, res) => {
  const { videoId } = req.params;
  const { video_rating, clips } = req.body;

  const project = projectsCache[videoId];
  if (!project) {
    return res.status(404).json({ success: false, error: 'NotFound', message: 'Progetto non trovato.' });
  }

  if (!clips || !video_rating) {
    return res.status(400).json({ success: false, error: 'InvalidData', message: 'Dati JSON dell\'AI non validi o incompleti.' });
  }

  // Genera i comandi automatici yt-dlp pronti all'uso per il PC
  const enrichedClips = clips.map(clip => {
    return {
      ...clip,
      ytDlpCommand: `yt-dlp -f "bestvideo+bestaudio" --external-downloader ffmpeg --external-downloader-args "ffmpeg_i:-ss ${clip.start_time} -to ${clip.end_time}" -o "clip_${clip.rank}_${videoId}.mp4" "${project.url}"`
    };
  });

  project.videoRating = video_rating;
  project.clips = enrichedClips;
  project.status = 'Completato';

  projectsCache[videoId] = project;
  saveProjects(projectsCache);

  res.json({ success: true, project });
});

// ============================================================
// 5. ENDPOINT: DELETE /api/projects/:videoId (Elimina dalla cronologia)
// ============================================================
app.delete('/api/projects/:videoId', authMiddleware, (req, res) => {
  const { videoId } = req.params;
  if (!projectsCache[videoId]) {
    return res.status(404).json({ success: false, error: 'NotFound', message: 'Progetto non trovato.' });
  }
  delete projectsCache[videoId];
  saveProjects(projectsCache);
  res.json({ success: true, message: 'Progetto eliminato.' });
});

// Gestione rotte non valide ed errori globali per evitare crash su server gratuiti
app.use((req, res) => res.status(404).json({ success: false, error: 'NotFound', message: 'Endpoint non trovato.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, error: 'ServerError', message: 'Errore interno.' });
});

app.listen(PORT, () => console.log(`ClipHook Server attivo sulla porta ${PORT}`));
