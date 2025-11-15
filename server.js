require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const { configure, uploadBuffer } = require('./utils/cloudinary');
const User = require('./models/User');
const Dirigente = require('./models/Dirigente');
const Equipo = require('./models/Equipo');
const basicAuth = require('./middleware/basicAuth');
const ExcelJS = require('exceljs');
const axios = require('axios');
const puppeteer = require('puppeteer');
const PDFDocument = require('pdfkit');
const { Request, Response } = require ('express');
const path = require('path');
const fs   = require('fs');

const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType,
  TableLayoutType,
  ImageRun,
  TextRun,
} = require('docx');

// Colores de marca (ajústalos si quieres)
const COLOR_PRIMARY = '#c62828'; // rojo del escudo
const COLOR_SECOND  = '#0b2a6d'; // azul del balón
const COLOR_TEXT    = '#222';


// Carga el logo (binario) una vez
let LOGO_BUFFER = null;
try {
  LOGO_BUFFER = fs.readFileSync(path.join(__dirname, 'assets', 'logo-liga.png'));
} catch (e) {
  console.warn('⚠️ No se encontró assets/logo-liga.png, el PDF saldrá sin logo/agua.');
}

// Dibuja marca de agua centrada
function drawWatermark(doc) {
  if (!LOGO_BUFFER) return;
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const maxW = Math.min(320, pageW * 0.45);

  doc.save();
  doc.opacity(0.06);
  // centrada
  doc.image(LOGO_BUFFER, (pageW - maxW) / 2, (pageH - maxW) / 2, { width: maxW });
  doc.restore();
}

function drawHeader(doc) {
  const startY = doc.page.margins.top - 6; // un pelín arriba
  const logoW  = LOGO_BUFFER ? 52 : 0;

  // línea base de título arranca a la derecha del logo
  const titleX = doc.page.margins.left + (logoW ? logoW + 12 : 0);
  const titleW = doc.page.width - doc.page.margins.left - doc.page.margins.right - (logoW ? logoW + 12 : 0);

  if (LOGO_BUFFER) {
    doc.image(LOGO_BUFFER, doc.page.margins.left, startY - 4, { width: logoW, align: 'left' });
  }

  doc.save();
  doc.fillColor(COLOR_PRIMARY).font('Helvetica-Bold').fontSize(14)
     .text('Liga Deportiva Bienestar Familiar de Calderón', titleX, startY, { width: titleW, align: 'left' });

  doc.fillColor(COLOR_TEXT).font('Helvetica').fontSize(10)
     .text('Acuerdo ministerial N. 0184 | 15 agosto 2023', titleX, startY + 20, { width: titleW, align: 'left' });

  doc.fillColor(COLOR_SECOND).font('Helvetica-Bold').fontSize(11)
     .text('Nómina de jugadores – 6º campeonato de indorfútbol masculino', titleX, startY + 36, { width: titleW, align: 'left' });
  doc.restore();

  // línea divisoria
  const lineY = startY + 56;
  doc.save();
  doc.moveTo(doc.page.margins.left, lineY)
     .lineTo(doc.page.width - doc.page.margins.right, lineY)
     .lineWidth(1)
     .strokeColor('#e0e0e0')
     .stroke();
  doc.restore();

  // devuelve el Y recomendado para comenzar contenido
  return lineY + 12;
}



dayjs.extend(customParseFormat);

const app = express();
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://proyecto-pa-hwva.vercel.app',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Vary', 'Origin'); // evita cachear CORS incorrecto
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200); // responde preflight aquí mismo
  next();
});

// Manejo de preflight OPTIONS
app.options("*", (req, res) => {
  res.sendStatus(200);
});

//app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // <- agrega esto

// Cloudinary config
configure({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// multer memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    // Campos que SOLO permiten imágenes
    const onlyImages = ['idImage', 'idBackImage', 'selfieImage'];

    if (onlyImages.includes(file.fieldname)) {
      if (file.mimetype.startsWith('image/')) return cb(null, true);
      return cb(new Error(`El campo "${file.fieldname}" solo permite imágenes`), false);
    }

    // Campo autorización: imagen o PDF
    if (file.fieldname === 'autorizacion') {
      const okImage = file.mimetype.startsWith('image/');
      const okPdf = file.mimetype === 'application/pdf';
      if (okImage || okPdf) return cb(null, true);
      return cb(new Error('La autorización solo permite imagen o PDF'), false);
    }

    // Si llega algún otro campo no esperado
    return cb(new Error(`Campo de archivo no permitido: ${file.fieldname}`), false);
  },
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas en la base Futbol'))
  .catch((err) => console.error('❌ Error al conectar:', err));

app.get('/api/teams/validate/:code', (req, res) => {
  const { code } = req.params;
  const team = teamsList.find((t) => t.codDirigente === code);
  if (!team) return res.status(404).json({ message: 'Código inválido' });
  res.json(team);
});

// regex validations
const nameRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/;
const identRegex = /^[A-Za-z0-9\-]+$/;

app.post(
  '/api/users',
  upload.fields([
    { name: 'idImage', maxCount: 1 },
    { name: 'idBackImage', maxCount: 1 },
    { name: 'selfieImage', maxCount: 1 },
    { name: 'autorizacion', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { codDirigente, firstName, lastName, dob, identificacion, numjugador } = req.body;

      if (!codDirigente) return res.status(400).json({ message: 'Código de dirigente requerido' });

      // Validar código en BD
      const equipo = await Equipo.findOne({ codigo: codDirigente });
      if (!equipo) return res.status(400).json({ message: 'Código inválido' });

      // Validaciones básicas
      if (!firstName || !nameRegex.test(firstName)) return res.status(400).json({ message: 'Nombres inválidos' });
      if (!lastName || !nameRegex.test(lastName)) return res.status(400).json({ message: 'Apellidos inválidos' });
      if (!identificacion || !identRegex.test(identificacion)) return res.status(400).json({ message: 'Identificación inválida' });
      if (!dob) return res.status(400).json({ message: 'Fecha requerida' });
      if (!numjugador || isNaN(numjugador) || numjugador < 1 || numjugador > 99) {
        return res.status(400).json({ message: 'Número de jugador debe ser entre 1 y 99' });
      }

      // Verificar cantidad máxima de jugadores
      const count = await User.countDocuments({ team: equipo.nombre });
      if (count >= 20) return res.status(400).json({ message: 'Este equipo ya tiene 20 jugadores registrados' });

      // Verificar número ya usado en ese equipo
      const existsNum = await User.findOne({ team: equipo.nombre, numjugador });
      if (existsNum) return res.status(400).json({ message: `Número ${numjugador} ya registrado en ${equipo.nombre}` });

      // Parse fecha
      let parsed = dayjs(dob, ['YYYY-MM-DD', 'DD/MM/YYYY'], true);
      if (!parsed.isValid()) return res.status(400).json({ message: 'Fecha inválida' });
      const age = dayjs().diff(parsed, 'year');

      if (age < 14) return res.status(400).json({ message: 'No se permiten registros menores de 14 años' });

      // Subir imágenes
      if (!req.files['idImage'] || !req.files['idBackImage'] || !req.files['selfieImage']) {
        return res.status(400).json({ message: 'Todas las imágenes de identificación y selfie son obligatorias' });
      }

      const idResult = await uploadBuffer(
        req.files['idImage'][0].buffer,
        `id_front_${identificacion}_${Date.now()}`
      );
      const idBackResult = await uploadBuffer(
        req.files['idBackImage'][0].buffer,
        `id_back_${identificacion}_${Date.now()}`
      );
      const selfieResult = await uploadBuffer(
        req.files['selfieImage'][0].buffer,
        `selfie_${identificacion}_${Date.now()}`
      );

      let autorizacionUrl = null;
      const requiereAut = age >= 14 && age < 18;
      if (requiereAut) {
        if (!req.files['autorizacion']) return res.status(400).json({ message: 'Autorización requerida (14-17 años)' });
        const autRes = await uploadBuffer(
          req.files['autorizacion'][0].buffer,
          `aut_${identificacion}_${Date.now()}`
        );
        autorizacionUrl = autRes.secure_url;
      }

      const user = new User({
        codDirigente,
        firstName,
        lastName,
        dob: parsed.toDate(),
        age,
        identificacion,
        numjugador,
        idImageUrl: idResult.secure_url,
        idBackImageUrl: idBackResult.secure_url,
        selfieImageUrl: selfieResult.secure_url,
        autorizacionUrl,
        team: equipo.nombre,
      });

      await user.save();
      res.json({ message: 'Usuario registrado con éxito', userId: user._id });
    } catch (err) {
      console.error(err);
      if (err.code === 11000 && err.keyPattern?.identificacion) {
        // Error de duplicado de cédula
        return res.status(409).json({
          message: 'Identificación ya registrada',
          field: 'identificacion',
          detail: err.keyValue,
        });
      }
      res.status(500).json({ message: 'Error en servidor', detail: err.message });
    }
  }
);

app.get('/api/equipos/:codigo/jugadores', async (req, res) => {
  try {
    const equipo = await Equipo.findOne({ codigo: req.params.codigo });
    if (!equipo) return res.status(404).json({ message: 'Código inválido' });
    const jugadores = await User.find({ team: equipo.nombre }).select(
      '_id firstName lastName dob age identificacion numjugador team'
    ); // sin fotos
    res.json({ equipo: equipo.nombre, jugadores });
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo jugadores', error: error.message });
  }
});

// Login Dirigente (simple)
app.post('/api/dirigentes/login', async (req, res) => {
  const { usuario, password } = req.body;
  try {
    if (usuario === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
      return res.json({ role: 'admin' });
    }
    const dirigente = await Dirigente.findOne({ usuario, password });
    if (!dirigente) return res.status(401).json({ message: 'Credenciales incorrectas' });
    return res.json({ role: 'dirigente', dirigenteId: dirigente._id, equipo: dirigente.nombre });
  } catch {
    res.status(500).json({ message: 'Error en login' });
  }
});

// Jugadores por dirigente
app.get('/api/dirigentes/:id/jugadores', async (req, res) => {
  try {
    const dirigente = await Dirigente.findById(req.params.id).lean();
    if (!dirigente) return res.status(404).json({ message: 'Dirigente no encontrado' });
    const jugadores = await User.find({ team: dirigente.nombre }).sort({ lastName: 1 }).lean();
    res.json(jugadores);
  } catch (err) {
    res.status(500).json({ message: 'Error obteniendo jugadores' });
  }
});

// Editar jugador (solo campos enviados; imágenes opcionales)
app.put(
  '/api/jugadores/:id',
  upload.fields([
    { name: 'idImage', maxCount: 1 },
    { name: 'idBackImage', maxCount: 1 },
    { name: 'selfieImage', maxCount: 1 },
    { name: 'autorizacion', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const jugador = await User.findById(req.params.id);
      if (!jugador) return res.status(404).json({ message: 'Jugador no encontrado' });

      const up = req.body;
      const maybeSet = (k) => {
        if (up[k] !== undefined && up[k] !== jugador[k]) jugador[k] = up[k];
      };

      // Validaciones mínimas si llegan
      const nameRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/;
      if (up.firstName && !nameRegex.test(up.firstName)) return res.status(400).json({ message: 'Nombres inválidos' });
      if (up.lastName && !nameRegex.test(up.lastName)) return res.status(400).json({ message: 'Apellidos inválidos' });

      if (up.identificacion) {
        const identRegex = /^[A-Za-z0-9\-]+$/;
        if (!identRegex.test(up.identificacion)) return res.status(400).json({ message: 'Identificación inválida' });
        // unicidad
        const dup = await User.findOne({ identificacion: up.identificacion, _id: { $ne: jugador._id } });
        if (dup) return res.status(409).json({ message: 'Identificación ya registrada' });
      }

      if (up.numjugador) {
        const n = Number(up.numjugador);
        if (isNaN(n) || n < 1 || n > 99) return res.status(400).json({ message: 'Número inválido (1-99)' });
        const dupNum = await User.findOne({ team: jugador.team, numjugador: n, _id: { $ne: jugador._id } });
        if (dupNum) return res.status(400).json({ message: `Número ${n} ya registrado en ${jugador.team}` });
      }

      if (up.dob) {
        const parsed = dayjs(up.dob, ['YYYY-MM-DD', 'DD/MM/YYYY'], true);
        if (!parsed.isValid()) return res.status(400).json({ message: 'Fecha inválida' });
        jugador.dob = parsed.toDate();
        jugador.age = dayjs().diff(parsed, 'year');
        if (jugador.age < 14) return res.status(400).json({ message: 'No se permiten menores de 14 años' });

        const requiereAut = jugador.age >= 14 && jugador.age < 18;
        if (requiereAut) {
          const vieneNuevaAut = !!(req.files && req.files['autorizacion']);
          if (!jugador.autorizacionUrl && !vieneNuevaAut) {
            return res.status(400).json({ message: 'Autorización requerida (14-17 años)' });
          }
        } else {
          jugador.autorizacionUrl = null;
        }
      }

      maybeSet('firstName');
      maybeSet('lastName');
      if (up.numjugador) jugador.numjugador = Number(up.numjugador);
      maybeSet('identificacion');

      // Subidas condicionales
      const doUpload = async (field, name) => {
        if (req.files[field]) {
          const respUp = await uploadBuffer(
            req.files[field][0].buffer,
            `${name}_${jugador.identificacion}_${Date.now()}`
          );
          jugador[`${field}Url`] = respUp.secure_url;
        }
      };

      await doUpload('idImage', 'id_front_edit');
      await doUpload('idBackImage', 'id_back_edit');
      await doUpload('selfieImage', 'selfie_edit');
      await doUpload('autorizacion', 'aut_edit');

      await jugador.save();
      res.json({ message: 'Jugador actualizado correctamente', jugador });
    } catch (err) {
      res.status(500).json({ message: 'Error editando jugador', error: err.message });
    }
  }
);

// Eliminar jugador
app.delete('/api/jugadores/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Jugador eliminado correctamente' });
  } catch {
    res.status(500).json({ message: 'Error eliminando jugador' });
  }
});

// Convierte URL de Cloudinary a versión PNG optimizada
// Fuerza PNG sRGB, quita perfiles/metadata y limita tamaño para evitar archivos gigantes
function toCloudinaryPng(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('res.cloudinary.com')) return url;

    const parts = u.pathname.split('/');
    const upIdx = parts.indexOf('upload');
    if (upIdx === -1) return url;

    const after = parts.slice(upIdx + 1);
    const hasOps = after.length && after[0] && !after[0].startsWith('v');

    const transform = 'f_png,fl_force_strip,q_auto:good,w_800';
    if (hasOps) {
      if (!after[0].includes('f_png')) after[0] = `${transform},${after[0]}`;
    } else {
      after.unshift(transform);
    }
    u.pathname = [...parts.slice(0, upIdx + 1), ...after].join('/');
    return u.toString();
  } catch {
    return url;
  }
}

// Fuerza formato (jpg/png) y tamaño razonable para Excel
function toCloudinaryFormat(url, target = 'jpg', width = 800) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('res.cloudinary.com')) return url;

    const parts = u.pathname.split('/');
    const upIdx = parts.indexOf('upload');
    if (upIdx === -1) return url;

    const after = parts.slice(upIdx + 1);
    const hasOps = after.length && after[0] && !after[0].startsWith('v');

    // quita metadatos y ajusta ancho para que el xlsx no pese demasiado
    const transform = `f_${target},fl_force_strip,q_auto:good,w_${width},c_limit`;

    if (hasOps) {
      after[0] = `${transform},${after[0]}`;
    } else {
      after.unshift(transform);
    }
    u.pathname = [...parts.slice(0, upIdx + 1), ...after].join('/');
    return u.toString();
  } catch {
    return url;
  }
}


async function fetchImageBuffer(url) {
  const safeUrl = toCloudinaryPng(url);
  const resp = await axios.get(safeUrl, {
    responseType: 'arraybuffer',
    timeout: 20000,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  const buf = Buffer.from(resp.data);

  const isPng  = buf.length > 8 && buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47;
  const isJpeg = buf.length > 3 && buf[0]===0xFF && buf[1]===0xD8;
  if (!isPng && !isJpeg) throw new Error('Imagen no PNG/JPEG válida');
  return buf;
}

function toCloudinaryThumb(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('res.cloudinary.com')) return url;
    const parts = u.pathname.split('/');
    const upIdx = parts.indexOf('upload');
    if (upIdx === -1) return url;

    const after = parts.slice(upIdx + 1);
    const hasOps = after.length && after[0] && !after[0].startsWith('v');

    // JPG pequeño y sin metadatos (mejor para PDF)
    const transform = 'f_jpg,fl_force_strip,q_auto:eco,w_300,h_200,c_fit';

    if (hasOps) {
      if (!after[0].includes('f_')) after[0] = `${transform},${after[0]}`;
    } else {
      after.unshift(transform);
    }
    u.pathname = [...parts.slice(0, upIdx + 1), ...after].join('/');
    return u.toString();
  } catch { return url; }
}

app.get('/api/jugadores/reporte-pdf/:idDirigente', async (req, res) => {
  try {
    const dir = await Dirigente.findById(req.params.idDirigente).lean();
    if (!dir) return res.status(404).json({ message: 'Dirigente no encontrado' });

    const equipoNombre = dir.nombre;
    const jugadores = await User.find({ team: equipoNombre }).sort({ lastName: 1 }).lean();

    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte_${equipoNombre}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 54, left: 36, right: 36, bottom: 36 },
    });
    doc.pipe(res);

    // ===== Página 1: marca de agua + encabezado institucional =====
    drawWatermark(doc);
    let y = drawHeader(doc); // posición inicial bajo el header institucional

    // ===== Título del equipo SOLO en la primera página =====
    doc.save();
    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLOR_TEXT)
       .text(`Equipo: ${equipoNombre}`, doc.page.margins.left, y, { align: 'center' });
    doc.restore();
    const GAP_AFTER_TEAM_TITLE = 28;
    y += GAP_AFTER_TEAM_TITLE;

    // ===== Definición de tabla =====
    const cols = [
      { key: 'firstName',       title: 'Nombres',        w: 80 },
      { key: 'lastName',        title: 'Apellidos',      w: 70 },
      { key: 'age',             title: 'Edad',           w: 30 },
      { key: 'dob',             title: 'Fecha Nac.',     w: 60 },
      { key: 'identificacion',  title: 'Identificación', w: 75 },
      { key: 'numjugador',      title: 'Número',         w: 40 },
      { key: 'team',            title: 'Equipo',         w: 75 },
      { key: 'selfie',          title: 'Selfie',         w: 62 },
    ];
    const colGap   = 6;
    const startX   = doc.page.margins.left;
    const tableW   = cols.reduce((acc, c) => acc + c.w, 0) + colGap * (cols.length - 1);
    const tableRX  = startX + tableW;

    // ===== Helper: dibuja encabezado de la tabla =====
    function drawTableHeaderRow() {
      doc.save();
      doc.rect(startX - 2, y - 2, tableW + 4, 18).fill('#f5f5f5');
      doc.fillColor('#111').font('Helvetica-Bold').fontSize(9);
      let x = startX;
      cols.forEach(c => {
        doc.text(c.title, x, y, { width: c.w });
        x += c.w + colGap;
      });
      doc.restore();

      y += 16;
      doc.moveTo(startX, y).lineTo(tableRX, y).strokeColor('#d9d9d9').lineWidth(0.7).stroke();
      y += 6;
    }

    // ===== Helpers de salto de página =====
    // Base: nueva página con marca de agua + encabezado institucional
    function newPageBase() {
      doc.addPage();
      drawWatermark(doc);
      y = drawHeader(doc);
      // OJO: aquí NO imprimimos nombre de equipo (solo va en la primera página)
    }
    // Cuando sí continuarán filas de la tabla
    function newPageForRows() {
      newPageBase();
      drawTableHeaderRow();
      doc.font('Helvetica').fontSize(9).fillColor(COLOR_TEXT);
    }
    // Cuando NO habrá filas (ej: pasamos directo a la declaratoria/firmas)
    function newPageForDeclaration() {
      newPageBase();
      doc.font('Helvetica').fontSize(9).fillColor(COLOR_TEXT);
    }

    // ===== Encabezado de la tabla de la primera página =====
    drawTableHeaderRow();
    doc.font('Helvetica').fontSize(9).fillColor(COLOR_TEXT);

    // ===== Filas =====
    for (const j of jugadores) {
      // Si no cabe una fila con imagen (alto aprox 130), saltamos de página con encabezado de tabla
      if (y > doc.page.height - doc.page.margins.bottom - 130) {
        newPageForRows();
      }

      let x = startX;
      const fecha = j.dob ? new Date(j.dob).toISOString().slice(0,10).split('-').reverse().join('/') : '';
      const row = {
        firstName:       j.firstName || '',
        lastName:        j.lastName || '',
        age:             (j.age ?? '').toString(),
        dob:             fecha,
        identificacion:  j.identificacion || '',
        numjugador:      (j.numjugador ?? '').toString(),
        team:            j.team || '',
      };

      // texto (hasta Equipo)
      cols.slice(0, 7).forEach(c => {
        doc.text(row[c.key] ?? '', x, y, { width: c.w });
        x += c.w + colGap;
      });

      // Selfie
      const selfieCol = cols[7];
      let selfieDrawnHeight = 0;
      try {
        if (j.selfieImageUrl) {
          const thumbUrl = toCloudinaryThumb(j.selfieImageUrl);
          const buf      = await fetchImageBuffer(thumbUrl);
          const imgW     = Math.min(selfieCol.w, 58);
          const imgH     = 42;
          doc.image(buf, x, y - 2, { fit: [imgW, imgH], width: imgW, height: imgH });
          selfieDrawnHeight = imgH;
        } else {
          doc.text('Sin imagen', x, y, { width: selfieCol.w });
        }
      } catch {
        doc.text('Sin imagen', x, y, { width: selfieCol.w });
      }

      const rowHeight = Math.max(14, selfieDrawnHeight ? selfieDrawnHeight + 4 : 14);
      y += rowHeight;

      doc.moveTo(startX, y).lineTo(tableRX, y).strokeColor('#eeeeee').lineWidth(0.5).stroke();
      y += 4;
    }

    // ===== Declaración y firmas =====
    y += 22;
    const MIN_ROOM = 180; // espacio mínimo requerido para toda la sección de declaración+firmas
    if (y > doc.page.height - doc.page.margins.bottom - MIN_ROOM) {
      // Si no alcanza el espacio, nueva página SOLO para la declaración (sin encabezados de tabla)
      newPageForDeclaration();
    }

    doc.fontSize(10).fillColor(COLOR_TEXT).font('Helvetica');

    // Declaratoria (con posición y ancho fijo)
    doc.text(
      'Declaro bajo juramento que he revisado cuidadosamente la información listada en este documento y que ésta ' +
      'corresponde a los datos y documentos presentados por cada jugador. Me responsabilizo de informar de inmediato ' +
      'cualquier cambio o corrección que se deba realizar y entiendo que el uso de información falsa o incompleta ' +
      'puede acarrear sanciones por parte de la organización del torneo.',
      startX, y,
      { align: 'justify', width: tableW }
    );

    // espacio bajo la declaratoria
    const GAP_AFTER_DECLARATION = 70;
    doc.y = doc.y + GAP_AFTER_DECLARATION;

    // Firma centrada
    doc.text('_______________________________', startX, doc.y, { width: tableW, align: 'center' });
    doc.text('Firma del Dirigente',           startX, undefined, { width: tableW, align: 'center' });

    // Campos de nombre/identificación
    doc.moveDown(1.2);
    doc.text('Nombre del Dirigente: _______________________________', startX, undefined, { width: tableW, align: 'center' });
    doc.text('Identificación del Dirigente: ________________________', startX, undefined, { width: tableW, align: 'center' });

    doc.end();
  } catch (err) {
    console.error('Error PDF:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error generando PDF', error: err.message });
    } else {
      try { res.end(); } catch {}
    }
  }
});



app.get('/api/jugadores/reporte/:idDirigente', async (req, res) => {
  try {
    const dir = await Dirigente.findById(req.params.idDirigente).lean();
    if (!dir) return res.status(404).json({ message: 'Dirigente no encontrado' });

    const equipoNombre = dir.nombre;
    const jugadores = await User.find({ team: equipoNombre }).sort({ lastName: 1 }).lean();

    const headerCell = (text) =>
      new TableCell({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text, bold: true })],
          }),
        ],
      });

    const textCell = (text) =>
      new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: String(text ?? ''), size: 20 })], // ~10pt
          }),
        ],
      });

    const imageCell = (paragraph) =>
      new TableCell({ children: [paragraph] });

    // ---- cabecera ----
    const headerRow = new TableRow({
      children: [
        headerCell('Nombres'),
        headerCell('Apellidos'),
        headerCell('Edad'),
        headerCell('Fecha Nac.'),
        headerCell('Identificación'),
        headerCell('Número'),
        headerCell('Equipo'),
        headerCell('Selfie'),
      ],
    });

    const rows = [headerRow];

    // ---- filas de datos + imágenes ----
    for (const j of jugadores) {
      let selfiePara = new Paragraph({
        children: [new TextRun({ text: 'Sin imagen', size: 20 })],
      });

      try {
        if (j.selfieImageUrl) {
          const buf = await fetchImageBuffer(j.selfieImageUrl);
          selfiePara = new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: buf,
                transformation: { width: 120, height: 80 },
              }),
            ],
          });
        }
      } catch (e) {
        console.warn('No se pudo incrustar Selfie:', j.selfieImageUrl, e?.message);
      }

      rows.push(
        new TableRow({
          children: [
            textCell(j.firstName),
            textCell(j.lastName),
            textCell(j.age),
            textCell(j.dob ? String(j.dob).slice(0,10).split('-').reverse().join('/') : ''),
            textCell(j.identificacion),
            textCell(j.numjugador),
            textCell(j.team),
            imageCell(selfiePara),
          ],
        })
      );
    }

    const tabla = new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.AUTOFIT,
    });

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },     // A4
              margin: { top: 720, right: 720, bottom: 720, left: 720 }, // 0.5"
            },
          },
          children: [
            new Paragraph({
              text: equipoNombre,
              alignment: AlignmentType.CENTER,
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph({
              text: 'Listado de Jugadores',
              alignment: AlignmentType.CENTER,
              heading: HeadingLevel.HEADING_2,
            }),
            tabla,
            new Paragraph({ text: '', spacing: { before: 600 } }),
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              children: [
                new TextRun({
                  text:
                    'Declaro bajo juramento que he revisado cuidadosamente la información listada en este documento y que ésta ' +
                    'corresponde a los datos y documentos presentados por cada jugador. Me responsabilizo de informar de inmediato ' +
                    'cualquier cambio o corrección que se deba realizar y entiendo que el uso de información falsa o incompleta ' +
                    'puede acarrear sanciones por parte de la organización del torneo.',
                }),
              ],
            }),
            new Paragraph({ text: '', spacing: { before: 800 } }),
            new Paragraph({ text: '_______________________________', alignment: AlignmentType.CENTER }),
            new Paragraph({ text: 'Firma del Dirigente', alignment: AlignmentType.CENTER }),
            new Paragraph({ text: '', spacing: { before: 300 } }),
            new Paragraph({ text: 'Nombre del Dirigente: _______________________________', alignment: AlignmentType.CENTER }),
            new Paragraph({ text: 'Identificación del Dirigente: ________________________', alignment: AlignmentType.CENTER }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte_${equipoNombre}.docx"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error generando reporte', error: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).lean();
  res.json(users);
});

// Protected export endpoint
app.get('/api/users/export', basicAuth, async (req, res) => {
  try {
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setTimeout(5 * 60 * 1000); 
    const users = await User.find().sort({ createdAt: 1 }).lean();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Usuarios');

    worksheet.columns = [
      { header: 'NOMBRES', key: 'firstName', width: 20 },
      { header: 'APELLIDOS', key: 'lastName', width: 20 },
      { header: 'EDAD', key: 'age', width: 10 },
      { header: 'FECHA_NACIMIENTO', key: 'dob', width: 15 },
      { header: 'IDENTIFICACION', key: 'identificacion', width: 18 },
      { header: 'NUMERO_JUGADOR', key: 'numjugador', width: 15 },
      { header: 'EQUIPO', key: 'team', width: 20 },
      { header: 'FOTO_CEDULA_FRONTAL', key: 'idImage', width: 18 },
      { header: 'FOTO_CEDULA_TRASERA', key: 'idBackImage', width: 18 },
      { header: 'FOTO_SELFIE', key: 'selfieImage', width: 18 },
    ];

    // add rows
    users.forEach((u) => {
      worksheet.addRow({
        firstName: u.firstName,
        lastName: u.lastName,
        age: `${u.age} AÑOS`,
        dob: new Date(u.dob).toISOString().slice(0,10).split('-').reverse().join('/'),
        identificacion: u.identificacion,
        numjugador: u.numjugador,
        team: u.team,
        idImage: '',
        idBackImage: '',
        selfieImage: '',
      });
    });

    // add images
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const rowNumber = i + 2;
      worksheet.getRow(rowNumber).height = 80;

      const fetchBuf = async (origUrl) => {
        const safe = toCloudinaryFormat(origUrl, 'jpg', 800); // ← fuerza JPG
        const resp = await axios.get(safe, { responseType: 'arraybuffer' });
        return Buffer.from(resp.data);
      };

      try {
        if (u.idImageUrl) {
          const buf = await fetchBuf(u.idImageUrl);
          const imageId = workbook.addImage({ buffer: buf, extension: 'jpeg' });
          worksheet.addImage(imageId, { tl: { col: 7, row: rowNumber - 1 }, ext: { width: 120, height: 80 } });
        }
      } catch (e) { /* opcional: log */ }

      try {
        if (u.idBackImageUrl) {
          const buf = await fetchBuf(u.idBackImageUrl);
          const imageId3 = workbook.addImage({ buffer: buf, extension: 'jpeg' });
          worksheet.addImage(imageId3, { tl: { col: 8, row: rowNumber - 1 }, ext: { width: 120, height: 80 } });
        }
      } catch (e) { /* opcional: log */ }

      try {
        if (u.selfieImageUrl) {
          const buf2 = await fetchBuf(u.selfieImageUrl);
          const imageId2 = workbook.addImage({ buffer: buf2, extension: 'jpeg' });
          worksheet.addImage(imageId2, { tl: { col: 9, row: rowNumber - 1 }, ext: { width: 120, height: 80 } });
        }
      } catch (e) { /* opcional: log */ }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="usuarios_Futbol.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error exportando', detail: err.message });
  }
});

// Validar código de equipo (público)
app.get('/api/equipos/validate/:codigo', async (req, res) => {
  try {
    const equipo = await Equipo.findOne({ codigo: req.params.codigo });
    if (!equipo) return res.status(404).json({ message: 'Código inválido' });
    res.json({ nombre: equipo.nombre, codigo: equipo.codigo, dirigenteId: equipo.dirigenteId });
  } catch (e) {
    res.status(500).json({ message: 'Error validando código' });
  }
});

// Ping de login admin (usa el mismo Basic Auth del Excel)
app.get('/api/admin/session', basicAuth, (req, res) => {
  res.json({ ok: true, who: 'admin' });
});

/** DIRIGENTES CRUD */
// DIRIGENTES
app.get('/api/admin/dirigentes', basicAuth, async (req, res) => {
  const list = await Dirigente.find().lean();
  res.json(list);
});

app.post('/api/admin/dirigentes', basicAuth, async (req, res) => {
  try {
    const { usuario, password, nombre } = req.body;
    // console.log('POST /dirigentes body:', req.body); // opcional para debug

    if (!usuario || !password || !nombre) {
      return res.status(400).json({ message: 'Faltan campos' });
    }

    // opcional: evita duplicados de usuario/equipo
    const existsUser = await Dirigente.findOne({ usuario });
    if (existsUser) return res.status(409).json({ message: 'Usuario ya existe' });

    const dir = await Dirigente.create({ usuario, password, nombre });

    let equipo = await Equipo.findOne({ nombre });
    if (!equipo) {
      equipo = await Equipo.create({ nombre, dirigenteId: dir._id }); // ← sin codigo:null
    } else {
      equipo.dirigenteId = dir._id;
      await equipo.save();
    }

    res.json({ message: 'Dirigente creado', dirigente: dir });
  } catch (e) {
    console.error('Error creando dirigente:', e);
    res.status(500).json({ message: 'Error creando dirigente', detail: e.message });
  }
});


app.put('/api/admin/dirigentes/:id', basicAuth, async (req, res) => {
  try {
    const { usuario, password, nombre } = req.body;
    const d = await Dirigente.findById(req.params.id);
    if (!d) return res.status(404).json({ message: 'No encontrado' });
    if (usuario) d.usuario = usuario;
    if (password) d.password = password;
    if (nombre) d.nombre = nombre;
    await d.save();

    // asegurar vinculación de equipo
    let equipo = await Equipo.findOne({ nombre });
    if (!equipo) {
      equipo = await Equipo.create({ nombre, dirigenteId: dir._id }); // ← sin codigo:null
    } else {
      equipo.dirigenteId = dir._id;
      await equipo.save();
    }
    res.json({ message: 'Dirigente editado' });
  } catch (e) {
    res.status(500).json({ message: 'Error editando dirigente', detail: e.message });
  }
});

app.delete('/api/admin/dirigentes/:id', basicAuth, async (req, res) => {
  try {
    const d = await Dirigente.findByIdAndDelete(req.params.id);
    if (!d) return res.status(404).json({ message: 'No encontrado' });
    // liberar equipo (no lo borramos, solo dejamos dirigenteId nulo)
    await Equipo.updateMany({ dirigenteId: d._id }, { $unset: { dirigenteId: 1 } });
    res.json({ message: 'Dirigente eliminado' });
  } catch (e) {
    res.status(500).json({ message: 'Error eliminando dirigente', detail: e.message });
  }
});

// EQUIPOS
app.get('/api/admin/equipos', basicAuth, async (req, res) => {
  const data = await Equipo.find().populate('dirigenteId').lean();
  res.json(
    data.map((e) => ({
      _id: e._id,
      nombre: e.nombre,
      codigo: e.codigo || null,
      dirigente: e.dirigenteId ? { _id: e.dirigenteId._id, usuario: e.dirigenteId.usuario } : null,
    }))
  );
});

// POST agrega código a un equipo sin código
app.post('/api/admin/equipos', basicAuth, async (req, res) => {
  try {
    const { equipoId, codigo } = req.body;
    const eq = await Equipo.findById(equipoId);
    if (!eq) return res.status(404).json({ message: 'Equipo no encontrado' });
    if (eq.codigo) return res.status(400).json({ message: 'Este equipo ya tiene código' });

    // colisión de código
    const dup = await Equipo.findOne({ codigo });
    if (dup) return res.status(400).json({ message: 'Código ya está asignado a otro equipo' });

    eq.codigo = codigo;
    await eq.save();
    res.json({ message: 'Código asignado' });
  } catch (e) {
    res.status(500).json({ message: 'Error asignando código', detail: e.message });
  }
});

// PUT editar equipo (si cambia a un nombre con código existente, bloquear)
app.put('/api/admin/equipos/:id', basicAuth, async (req, res) => {
  try {
    const { nombre, codigo } = req.body;
    const eq = await Equipo.findById(req.params.id);
    if (!eq) return res.status(404).json({ message: 'No encontrado' });

    if (nombre && nombre !== eq.nombre) {
      const dupN = await Equipo.findOne({ nombre, _id: { $ne: eq._id } });
      if (dupN) return res.status(400).json({ message: 'Ya existe un equipo con ese nombre' });
      eq.nombre = nombre;
    }

    if (codigo !== undefined) {
      // si seteas un código, verifica que no exista en otro
      if (codigo === null || codigo === '') {
        eq.codigo = null;
        await Equipo.updateOne({ _id: eq._id }, { $unset: { codigo: 1 } });
      } else {
        const dup = await Equipo.findOne({ codigo, _id: { $ne: eq._id } });
        if (dup) return res
          .status(400)
          .json({ message: 'Este equipo ya se encuentra agregado con su código, elimina el otro registro' });
        eq.codigo = codigo;
      }
    }

    await eq.save();
    res.json({ message: 'Equipo editado' });
  } catch (e) {
    res.status(500).json({ message: 'Error editando equipo', detail: e.message });
  }
});

app.delete('/api/admin/equipos/:id', basicAuth, async (req, res) => {
  try {
    await Equipo.findByIdAndDelete(req.params.id);
    res.json({ message: 'Equipo eliminado' });
  } catch (e) {
    res.status(500).json({ message: 'Error eliminando equipo', detail: e.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('Server listening on', PORT));
