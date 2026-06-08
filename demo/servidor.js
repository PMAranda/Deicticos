const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3000;

// roomCode → { pdfBuffer, currentSlide, totalSlides, teacher: ws|null, students: Set<ws> }
const rooms = new Map();

function generateCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 7).toUpperCase();
  } while (rooms.has(code));
  return code;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.bin':  'application/octet-stream',
  '.task': 'application/octet-stream',
};

// ── HTTP ─────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const urlObj   = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // PDF download: GET /pdf/:code
  if (req.method === 'GET' && pathname.startsWith('/pdf/')) {
    const code = pathname.slice(5);
    const room = rooms.get(code);
    if (!room?.pdfBuffer) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Sala o PDF no encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type':   'application/pdf',
      'Content-Length': room.pdfBuffer.length,
      'Cache-Control':  'no-store',
    });
    res.end(room.pdfBuffer);
    return;
  }

  // PDF upload: POST /subir-pdf/:code
  if (req.method === 'POST' && pathname.startsWith('/subir-pdf/')) {
    const code = pathname.slice(11);
    const room = rooms.get(code);
    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Sala no encontrada' }));
      return;
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const totalSlides = parseInt(req.headers['x-total-slides'] || '0', 10);
      room.pdfBuffer    = Buffer.concat(chunks);
      room.totalSlides  = totalSlides;
      room.currentSlide = 1;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));

      if (room.teacher?.readyState === 1) {
        room.teacher.send(JSON.stringify({ type: 'PDF_READY', totalSlides }));
      }
      broadcast(room, { type: 'PDF_UPDATED', totalSlides });
    });
    req.on('error', () => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Error al recibir el archivo' }));
    });
    return;
  }

  // Archivos estáticos.
  // /js/, /src/ y /node_modules/ (para CDN WASM de MediaPipe) se sirven desde la raíz del proyecto.
  const PROJECT_ROOT = path.join(__dirname, '..');
  const SHARED_PREFIXES = ['/js/', '/src/', '/node_modules/'];
  const isShared = SHARED_PREFIXES.some(p => pathname === p || pathname.startsWith(p));
  const baseDir  = isShared ? PROJECT_ROOT : __dirname;

  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(baseDir, filePath);

  // Protección path traversal
  if (!filePath.startsWith(baseDir) && !filePath.startsWith(PROJECT_ROOT)) {
    res.writeHead(403);
    res.end('Prohibido');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No encontrado: ' + pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
    });
    res.end(data);
  });
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

function broadcast(room, data, exclude = null) {
  const payload = JSON.stringify(data);
  room.students.forEach(ws => {
    if (ws !== exclude && ws.readyState === 1) ws.send(payload);
  });
}

wss.on('connection', ws => {
  ws.roomCode = null;
  ws.role     = null;

  ws.on('message', rawData => {
    let msg;
    try { msg = JSON.parse(rawData.toString()); } catch { return; }

    switch (msg.type) {

      case 'CREATE_ROOM': {
        const code = generateCode();
        rooms.set(code, {
          pdfBuffer:    null,
          currentSlide: 1,
          totalSlides:  0,
          teacher:      ws,
          students:     new Set(),
        });
        ws.roomCode = code;
        ws.role     = 'teacher';
        ws.send(JSON.stringify({ type: 'ROOM_CREATED', code }));
        console.log(`[sala] creada: ${code}`);
        break;
      }

      case 'SLIDE_CHANGE': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.teacher !== ws) return;
        room.currentSlide = msg.slide;
        broadcast(room, { type: 'SLIDE_CHANGE', slide: msg.slide });
        break;
      }

      case 'JOIN_ROOM': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Sala no encontrada. Verifica el código.' }));
          return;
        }
        if (!room.pdfBuffer) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'El profesor aún no ha subido la presentación. Intenta en unos segundos.' }));
          return;
        }
        ws.roomCode = code;
        ws.role     = 'student';
        room.students.add(ws);

        ws.send(JSON.stringify({
          type:         'JOINED',
          currentSlide: room.currentSlide,
          totalSlides:  room.totalSlides,
          code,
        }));

        if (room.teacher?.readyState === 1) {
          room.teacher.send(JSON.stringify({ type: 'STUDENT_COUNT', count: room.students.size }));
        }
        console.log(`[sala] ${code} — alumno conectado (total: ${room.students.size})`);
        break;
      }

      case 'POINTER_MOVE':
      case 'POINTER_STOP':
      case 'SLIDE_DESCRIPTION':
      case 'OLLAMA_STATUS': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.teacher !== ws) return;
        broadcast(room, msg);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (ws.role === 'teacher') {
      broadcast(room, { type: 'TEACHER_DISCONNECTED', message: 'El profesor ha cerrado la sesión.' });
      rooms.delete(ws.roomCode);
      console.log(`[sala] ${ws.roomCode} eliminada (profesor desconectado)`);
    } else if (ws.role === 'student') {
      room.students.delete(ws);
      if (room.teacher?.readyState === 1) {
        room.teacher.send(JSON.stringify({ type: 'STUDENT_COUNT', count: room.students.size }));
      }
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  Servidor demo listo en http://localhost:${PORT}`);
  console.log(`  Inicio   : http://localhost:${PORT}`);
  console.log(`  Profesor : http://localhost:${PORT}/profesor.html`);
  console.log(`  Alumno   : http://localhost:${PORT}/alumno.html\n`);
});
