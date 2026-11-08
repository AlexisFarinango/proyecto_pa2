const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const AutorizacionPlantilla = require('../models/AutorizacionPlantilla');

// =============================
// Campos dinámicos de la plantilla
// =============================
const PLACEHOLDERS = [
  { key: 'REPRESENTANTE_NOMBRE', label: 'Nombre del representante', ejemplo: 'MARÍA FERNANDA LÓPEZ PÉREZ', obligatorio: true },
  { key: 'REPRESENTANTE_CEDULA', label: 'Cédula del representante', ejemplo: '1712345678', obligatorio: true },
  { key: 'PARENTESCO', label: 'Parentesco (Padre/Madre/Representante legal)', ejemplo: 'Madre' },
  { key: 'REPRESENTANTE_TELEFONO', label: 'Teléfono del representante', ejemplo: '0991234567' },
  { key: 'JUGADOR_NOMBRE', label: 'Nombre del jugador', ejemplo: 'JUAN CARLOS PÉREZ LÓPEZ', obligatorio: true },
  { key: 'JUGADOR_CEDULA', label: 'Cédula del jugador', ejemplo: '1750123456', obligatorio: true },
  { key: 'JUGADOR_EDAD', label: 'Edad del jugador', ejemplo: '16' },
  { key: 'EQUIPO', label: 'Equipo', ejemplo: 'DEPORTIVO EJEMPLO' },
  { key: 'SEGURO_MEDICO', label: 'Seguro médico [X] SÍ / [ ] NO', ejemplo: '[X] SÍ  /  [  ] NO' },
  { key: 'ASEGURADORA', label: 'Aseguradora / cobertura (NA si no tiene)', ejemplo: 'IESS (PÚBLICO)' },
  { key: 'FECHA', label: 'Fecha de firma', ejemplo: '7 de noviembre del 2026' },
];
const PLACEHOLDER_KEYS = PLACEHOLDERS.map(p => p.key);
const PARENTESCOS = ['Padre', 'Madre', 'Representante legal'];

const PLANTILLA_PREDETERMINADA = {
  titulo: 'AUTORIZACIÓN PARA PARTICIPACIÓN DE MENOR DE EDAD',
  destinatario: 'Señor\nEulis Espinoza\nPresidente de la Liga Barrial Bienestar Familiar\nPresente.-',
  // Un tabulador al inicio de una línea = un nivel de sangría
  cuerpo: [
    'Yo, {{REPRESENTANTE_NOMBRE}}, con cédula de ciudadanía No. {{REPRESENTANTE_CEDULA}}, en calidad de {{PARENTESCO}} representante legal del menor {{JUGADOR_NOMBRE}}, con cédula de identidad No. {{JUGADOR_CEDULA}}, de {{JUGADOR_EDAD}} años de edad, AUTORIZO de manera expresa, libre y voluntaria su inscripción y participación en el Séptimo Campeonato Masculino de Indorfútbol, organizado por la Liga a la que usted representa y que mi representado participe con el equipo {{EQUIPO}}, el cual se llevará a cabo en el periodo 2026-2027.',
    '',
    'Para el efecto, declaro, acepto y me comprometo a lo siguiente:',
    '1. Estado de Aptitud Física y Salud: Declaro bajo juramento que mi representado se encuentra en perfecto estado de salud física y mental, y que cuenta con la valoración médica correspondiente que lo faculta para la práctica de deportes de alta intensidad y contacto como el fútbol. Certifico que no padece preexistencias médicas, lesiones vigentes, condiciones cardíacas o alergias que pongan en riesgo su integridad durante el desarrollo del torneo.',
    '2. Conocimiento de Riesgos Inherentes: Reconozco que la práctica del fútbol profesional o amateur conlleva riesgos físicos naturales e inherentes al juego (como caídas, golpes accidentales, esguinces o fracturas). Asumo dichos riesgos como parte de la naturaleza deportiva de la actividad.',
    '3. Cumplimiento del Reglamento: Me comprometo a que mi representado acatará las bases del torneo, las reglas de juego, las decisiones arbitrales y las normas de comportamiento dictadas por el comité organizador, promoviendo el juego limpio.',
    '4. Protocolo de Emergencia y Gastos Médicos: En caso de que ocurra un accidente fortuito o emergencia médica durante los partidos, autorizo al personal asignado por la organización para que gestione los primeros auxilios y, de ser necesario, coordine el traslado inmediato de mi representado al centro de salud más cercano.',
    '\t• Información de Respaldo Médico:',
    '\t\t• El menor cuenta con seguro médico: {{SEGURO_MEDICO}}',
    '\t\t• Nombre de la Aseguradora / Cobertura (público o privado): {{ASEGURADORA}}',
    '5. Uso de Imagen: Autorizo a los organizadores del torneo a captar y utilizar imágenes, fotografías o videos de mi representado exclusivamente con fines informativos, periodísticos, estadísticos o de difusión en las plataformas y redes oficiales de la Liga.',
    'En señal de total conformidad, aceptación y corresponsabilidad de los términos expuestos en este instrumento, firmo la presente autorización en la ciudad de Quito, Ecuador.',
  ].join('\n'),
  ciudad: 'Quito',
  nota: 'Adjunto copia de cédula del representante en el formulario de inscripción.',
  despedida: 'Atentamente,',
};

const CAMPOS_PLANTILLA = ['titulo', 'destinatario', 'cuerpo', 'ciudad', 'nota', 'despedida'];
const LIMITES = { titulo: 150, destinatario: 400, cuerpo: 4000, ciudad: 60, nota: 300, despedida: 100 };

const TZ = 'America/Guayaquil';

function fechaLarga(date = new Date()) {
  const parts = new Intl.DateTimeFormat('es-EC', {
    timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric',
  }).formatToParts(date);
  const g = (t) => parts.find(p => p.type === t)?.value;
  return `${g('day')} de ${g('month')} del ${g('year')}`;
}

function fechaHora(date = new Date()) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

// Devuelve la plantilla activa; si no existe ninguna crea la versión 1 con el formato predeterminado
async function obtenerPlantillaActiva() {
  let p = await AutorizacionPlantilla.findOne({ activa: true }).sort({ version: -1 }).lean();
  if (p) return p;
  const ultima = await AutorizacionPlantilla.findOne().sort({ version: -1 }).lean();
  if (ultima) {
    await AutorizacionPlantilla.updateOne({ _id: ultima._id }, { activa: true });
    return { ...ultima, activa: true };
  }
  try {
    const creada = await AutorizacionPlantilla.create({ ...PLANTILLA_PREDETERMINADA, version: 1, activa: true });
    return creada.toObject();
  } catch (e) {
    // Otra petición la creó al mismo tiempo
    if (e.code === 11000) return AutorizacionPlantilla.findOne({ version: 1 }).lean();
    throw e;
  }
}

async function obtenerPlantillaParaFirma(version) {
  const v = Number(version);
  if (Number.isInteger(v) && v > 0) {
    const p = await AutorizacionPlantilla.findOne({ version: v }).lean();
    if (p) return p;
  }
  return obtenerPlantillaActiva();
}

// Normaliza y valida lo que envía el administrador. Devuelve { plantilla } o { error }
function validarPlantilla(input = {}) {
  const plantilla = {};
  for (const campo of CAMPOS_PLANTILLA) {
    const v = typeof input[campo] === 'string' ? input[campo].replace(/\r\n/g, '\n').trim() : '';
    if (v.length > LIMITES[campo]) {
      return { error: `El campo "${campo}" supera el máximo de ${LIMITES[campo]} caracteres` };
    }
    plantilla[campo] = v;
  }
  if (!plantilla.cuerpo) return { error: 'El cuerpo de la autorización es obligatorio' };
  if (!plantilla.ciudad) return { error: 'La ciudad es obligatoria' };

  const todos = CAMPOS_PLANTILLA.map(c => plantilla[c]).join('\n');
  const usados = [...todos.matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)].map(m => m[1]);
  const desconocidos = [...new Set(usados.filter(k => !PLACEHOLDER_KEYS.includes(k)))];
  if (desconocidos.length) {
    return { error: `Campos no reconocidos: ${desconocidos.map(k => `{{${k}}}`).join(', ')}` };
  }
  const faltantes = PLACEHOLDERS.filter(p => p.obligatorio && !plantilla.cuerpo.includes(`{{${p.key}}}`));
  if (faltantes.length) {
    return { error: `El cuerpo debe incluir: ${faltantes.map(p => `{{${p.key}}}`).join(', ')}` };
  }
  return { plantilla };
}

// Convierte un texto con {{CAMPOS}} en segmentos [{ text, bold }] (los valores van en negrita)
function segmentar(texto, datos) {
  const segs = [];
  const re = /\{\{\s*([A-Z_]+)\s*\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(texto))) {
    if (m.index > last) segs.push({ text: texto.slice(last, m.index), bold: false });
    const val = datos[m[1]];
    segs.push(val !== undefined && val !== null && val !== ''
      ? { text: String(val), bold: true }
      : { text: m[0], bold: false });
    last = re.lastIndex;
  }
  if (last < texto.length) segs.push({ text: texto.slice(last), bold: false });
  return segs;
}

// =============================
// Generación del PDF
// =============================
// Versión reducida del logo (el original pesa ~1.6MB y haría pesado cada PDF)
let LOGO = null;
for (const nombre of ['logo-liga-autorizacion.png', 'logo-liga.png']) {
  try {
    LOGO = fs.readFileSync(path.join(__dirname, '..', 'assets', nombre));
    break;
  } catch { /* probar el siguiente */ }
}

// Firma de muestra para la vista previa del administrador
const FIRMA_EJEMPLO_SVG =
  'M 5 45 C 15 10, 25 10, 30 35 S 45 60, 55 30 S 70 5, 80 35 C 85 50, 95 50, 105 25 ' +
  'C 110 15, 120 15, 118 35 C 116 50, 130 45, 140 30 L 150 40 C 160 50, 175 30, 190 28';

const PAGE = { w: 595.28, h: 841.89, mx: 72, top: 60, bottom: 70 };
const COLOR_TEXTO = rgb(0.1, 0.1, 0.1);
const COLOR_GRIS = rgb(0.42, 0.42, 0.42);

async function generarPdfAutorizacion({ plantilla, datos, firmaPng = null, firmaEjemplo = false, evidencia = null }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Autorización - ${datos.JUGADOR_NOMBRE || ''}`.trim());
  pdf.setAuthor(datos.REPRESENTANTE_NOMBRE || '');
  pdf.setProducer('Sistema de inscripción - Liga Barrial Bienestar Familiar');

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const size = 11.5;
  const lh = size * 1.55;
  const maxW = PAGE.w - PAGE.mx * 2;

  // Reemplaza caracteres que la fuente estándar no puede dibujar (emojis, etc.)
  const cache = new Map();
  const limpiar = (t, font) => {
    let out = '';
    for (const ch of t.replace(/\t/g, ' ')) {
      const k = `${font === bold ? 'b' : 'r'}${ch}`;
      if (!cache.has(k)) {
        try { font.encodeText(ch); cache.set(k, ch); } catch { cache.set(k, '?'); }
      }
      out += cache.get(k);
    }
    return out;
  };

  let page = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.top;
  const reservaPie = evidencia || firmaEjemplo ? 40 : 0;

  const asegurar = (alto) => {
    if (y - alto < PAGE.bottom + reservaPie) {
      page = pdf.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - PAGE.top;
    }
  };

  const textoSimple = (texto, { font = regular, s = size, align = 'left', color = COLOR_TEXTO } = {}) => {
    const t = limpiar(texto, font);
    const w = font.widthOfTextAtSize(t, s);
    asegurar(s * 1.55);
    let x = PAGE.mx;
    if (align === 'right') x = PAGE.w - PAGE.mx - w;
    if (align === 'center') x = (PAGE.w - w) / 2;
    page.drawText(t, { x, y: y - s, size: s, font, color });
    y -= s * 1.55;
  };

  // Párrafo justificado con mezcla de texto normal y negrita (sangria en puntos desde el margen)
  const parrafo = (segs, sangria = 0) => {
    const anchoLinea = maxW - sangria;
    const palabras = [];
    let cur = null;
    for (const seg of segs) {
      const font = seg.bold ? bold : regular;
      for (const p of seg.text.split(/(\s+)/)) {
        if (!p) continue;
        if (/^\s+$/.test(p)) { if (cur) { palabras.push(cur); cur = null; } continue; }
        if (!cur) cur = { piezas: [], width: 0 };
        const t = limpiar(p, font);
        const w = font.widthOfTextAtSize(t, size);
        cur.piezas.push({ t, font, w });
        cur.width += w;
      }
    }
    if (cur) palabras.push(cur);
    if (!palabras.length) return;

    const espacio = regular.widthOfTextAtSize(' ', size);
    const lineas = [];
    let linea = { palabras: [], width: 0 };
    for (const pal of palabras) {
      const nuevo = linea.palabras.length ? linea.width + espacio + pal.width : pal.width;
      if (nuevo > anchoLinea && linea.palabras.length) {
        lineas.push(linea);
        linea = { palabras: [pal], width: pal.width };
      } else {
        linea.palabras.push(pal);
        linea.width = nuevo;
      }
    }
    lineas.push(linea);

    lineas.forEach((ln, i) => {
      asegurar(lh);
      const ultima = i === lineas.length - 1;
      let gap = espacio;
      if (!ultima && ln.palabras.length > 1) {
        const extra = (anchoLinea - ln.width) / (ln.palabras.length - 1);
        if (extra < espacio * 4) gap = espacio + extra;
      }
      let x = PAGE.mx + sangria;
      for (const pal of ln.palabras) {
        for (const pz of pal.piezas) {
          page.drawText(pz.t, { x, y: y - size, size, font: pz.font, color: COLOR_TEXTO });
          x += pz.w;
        }
        x += gap;
      }
      y -= lh;
    });
  };

  const bloqueTexto = (texto) => {
    const parrafos = texto.split(/\n\s*\n/);
    parrafos.forEach((par, i) => {
      // Un salto de línea simple dentro del párrafo se respeta como línea nueva.
      // Cada tabulador (o 4 espacios) al inicio de la línea agrega un nivel de sangría.
      par.split('\n').forEach(linea => {
        if (!linea.trim()) { y -= lh; return; }
        const inicio = linea.match(/^[\t ]*/)[0];
        const niveles = (inicio.match(/\t/g) || []).length + Math.floor(inicio.replace(/\t/g, '').length / 4);
        parrafo(segmentar(linea.trim(), datos), Math.min(niveles, 6) * 22);
      });
      if (i < parrafos.length - 1) y -= lh * 0.6;
    });
  };

  // ---- Logo
  if (LOGO) {
    try {
      const img = await pdf.embedPng(LOGO);
      const w = 58;
      const h = (img.height / img.width) * w;
      page.drawImage(img, { x: (PAGE.w - w) / 2, y: y - h, width: w, height: h });
      y -= h + 14;
    } catch { /* logo inválido */ }
  }

  // ---- Título
  if (plantilla.titulo) {
    textoSimple(plantilla.titulo, { font: bold, s: 13, align: 'center' });
    y -= 12;
  }

  // ---- Destinatario (negrita, una línea por renglón)
  if (plantilla.destinatario) {
    plantilla.destinatario.split('\n').forEach(l => {
      const segs = segmentar(l.trim(), datos);
      textoSimple(segs.map(s => s.text).join(''), { font: bold, s: size });
    });
    y -= lh;
  }

  // ---- Cuerpo
  bloqueTexto(plantilla.cuerpo);
  y -= lh * 0.6;

  // ---- Ciudad y fecha
  textoSimple(`${plantilla.ciudad}, ${datos.FECHA || ''}`, { align: 'right' });
  y -= lh * 0.6;

  // ---- Nota
  if (plantilla.nota) {
    const segs = segmentar(plantilla.nota, datos).map(s => ({ ...s, bold: true }));
    parrafo(segs);
    y -= lh * 0.4;
  }

  // ---- Despedida
  if (plantilla.despedida) textoSimple(plantilla.despedida);

  // ---- Bloque de firma
  asegurar(150);
  const firmaAlto = 70;
  const firmaAncho = 200;
  y -= 6;
  const firmaBase = y - firmaAlto;
  if (firmaPng) {
    const img = await pdf.embedPng(firmaPng);
    const escala = Math.min(firmaAncho / img.width, firmaAlto / img.height);
    const w = img.width * escala;
    const h = img.height * escala;
    page.drawImage(img, { x: PAGE.mx, y: firmaBase, width: w, height: h });
  } else if (firmaEjemplo) {
    page.drawSvgPath(FIRMA_EJEMPLO_SVG, {
      x: PAGE.mx + 5, y: firmaBase + 62, borderColor: rgb(0.05, 0.2, 0.55), borderWidth: 1.6,
    });
  }
  y = firmaBase - 4;
  page.drawLine({
    start: { x: PAGE.mx, y }, end: { x: PAGE.mx + 220, y },
    thickness: 1, color: COLOR_TEXTO,
  });
  y -= 4;
  const filaFirma = (label, valor) => {
    const l = limpiar(label, bold);
    page.drawText(l, { x: PAGE.mx, y: y - size, size, font: bold, color: COLOR_TEXTO });
    const lw = bold.widthOfTextAtSize(l, size);
    page.drawText(limpiar(valor || '', regular), { x: PAGE.mx + lw + 4, y: y - size, size, font: regular, color: COLOR_TEXTO });
    y -= size * 1.4;
  };
  filaFirma('NOMBRE:', datos.REPRESENTANTE_NOMBRE);
  filaFirma('C.I.:', datos.REPRESENTANTE_CEDULA);
  filaFirma('TELÉFONO:', datos.REPRESENTANTE_TELEFONO);
  filaFirma('PARENTESCO:', datos.PARENTESCO);

  // ---- Pie con evidencia de la firma electrónica
  const pie = (lineas, color = COLOR_GRIS) => {
    let py = PAGE.bottom - 18;
    page.drawLine({
      start: { x: PAGE.mx, y: py + 14 }, end: { x: PAGE.w - PAGE.mx, y: py + 14 },
      thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
    });
    for (const l of lineas) {
      page.drawText(limpiar(l, regular), { x: PAGE.mx, y: py, size: 7.5, font: regular, color });
      py -= 10;
    }
  };
  if (evidencia) {
    pie([
      `Documento firmado electrónicamente por el representante en el sistema de inscripción el ${evidencia.fechaHora} (hora de Ecuador).`,
      `IP: ${evidencia.ip || 'N/D'}  ·  Formato v${plantilla.version || '-'}  ·  Código de verificación: ${evidencia.codigo}`,
    ]);
  } else if (firmaEjemplo) {
    pie(['VISTA PREVIA CON DATOS DE EJEMPLO - DOCUMENTO SIN VALIDEZ'], rgb(0.78, 0.16, 0.16));
  }

  return Buffer.from(await pdf.save());
}

function datosEjemplo() {
  const d = {};
  PLACEHOLDERS.forEach(p => { d[p.key] = p.ejemplo; });
  d.FECHA = fechaLarga();
  return d;
}

// =============================
// Datos del representante enviados en el registro / edición
// =============================
const nameRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]+$/;
const identRegex = /^[A-Za-z0-9\-]+$/;
const telRegex = /^\+?[0-9]{7,15}$/;

const esPng = (buf) => buf && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;

// Detecta el tipo REAL por contenido (no por mimetype, que en iPhone puede venir vacío)
function tipoPorContenido(buf) {
  if (!buf || buf.length < 12) return null;
  const ascii = (i, n) => buf.toString('latin1', i, i + n);
  if (ascii(0, 5) === '%PDF-') return 'pdf';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'imagen';                 // JPEG
  if (esPng(buf)) return 'imagen';                                          // PNG
  if (ascii(0, 3) === 'GIF') return 'imagen';                               // GIF
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'imagen';    // WEBP
  if (ascii(0, 2) === 'BM') return 'imagen';                                // BMP
  if (ascii(4, 4) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(ascii(8, 4))) {
    return 'imagen';                                                        // HEIC/HEIF (iPhone)
  }
  return null;
}

// Valida los datos del representante. Devuelve { datos } o { error }
function validarRepresentante(body = {}, files = {}, identificacionJugador = '') {
  const nombre = String(body.representanteNombre || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const cedula = String(body.representanteCedula || '').trim().toUpperCase();
  const telefono = String(body.representanteTelefono || '').replace(/[\s-]/g, '');
  const parentesco = String(body.representanteParentesco || '').trim();

  if (!nombre || nombre.length < 5 || nombre.length > 120 || !nameRegex.test(nombre)) {
    return { error: 'Nombre del representante inválido (nombres y apellidos completos)' };
  }
  if (!cedula || cedula.length < 5 || cedula.length > 20 || !identRegex.test(cedula)) {
    return { error: 'Cédula del representante inválida' };
  }
  if (identificacionJugador && cedula === String(identificacionJugador).toUpperCase()) {
    return { error: 'La cédula del representante no puede ser la misma del jugador' };
  }
  if (!PARENTESCOS.includes(parentesco)) {
    return { error: 'Seleccione el parentesco del representante' };
  }
  if (!telRegex.test(telefono)) {
    return { error: 'Teléfono del representante inválido (7 a 15 dígitos)' };
  }
  // Seguro médico del menor: SI exige el nombre de la aseguradora; NO se completa con "NA (No Aplica)"
  const seguroMedico = String(body.seguroMedico || '').trim().toUpperCase();
  if (!['SI', 'NO'].includes(seguroMedico)) {
    return { error: 'Indique si el menor cuenta con seguro médico (SÍ / NO)' };
  }
  const aseguradora = seguroMedico === 'SI'
    ? String(body.aseguradora || '').trim().replace(/\s+/g, ' ').toUpperCase()
    : ASEGURADORA_NA;
  if (seguroMedico === 'SI' && (aseguradora.length < 2 || aseguradora.length > 120)) {
    return { error: 'Ingrese el nombre de la aseguradora / cobertura del menor' };
  }
  if (String(body.aceptaAutorizacion) !== 'true') {
    return { error: 'El representante debe aceptar los términos de la autorización' };
  }
  const firma = files?.firmaRepresentante?.[0];
  if (!firma || !esPng(firma.buffer)) {
    return { error: 'La firma del representante es obligatoria' };
  }
  const cedulaRep = files?.representanteCedulaImage?.[0];
  if (!cedulaRep) {
    return { error: 'La cédula del representante (imagen o PDF) es obligatoria' };
  }
  if (!tipoPorContenido(cedulaRep.buffer)) {
    return { error: 'La cédula del representante debe ser una imagen o un PDF válido' };
  }
  if (!files?.representanteFotoImage?.[0]) {
    return { error: 'La foto del representante con su cédula es obligatoria' };
  }
  return {
    datos: { nombre, cedula, telefono, parentesco },
    seguro: { tiene: seguroMedico === 'SI', aseguradora },
  };
}

const ASEGURADORA_NA = 'NA (No Aplica)';
const textoSeguro = (tiene) => (tiene ? '[X] SÍ  /  [  ] NO' : '[  ] SÍ  /  [X] NO');

function ipDe(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0] : req.socket?.remoteAddress || '').trim();
}

// Genera el PDF firmado, sube todos los archivos a Cloudinary y devuelve lo que se guarda en el jugador
async function firmarAutorizacion({ req, rep, seguro, jugador, uploadBuffer }) {
  const plantilla = await obtenerPlantillaParaFirma(req.body.plantillaVersion);
  const ahora = new Date();
  const firmaBuf = req.files.firmaRepresentante[0].buffer;

  const datos = {
    REPRESENTANTE_NOMBRE: rep.nombre,
    REPRESENTANTE_CEDULA: rep.cedula,
    REPRESENTANTE_TELEFONO: rep.telefono,
    PARENTESCO: rep.parentesco,
    JUGADOR_NOMBRE: `${jugador.firstName} ${jugador.lastName}`.trim(),
    JUGADOR_CEDULA: jugador.identificacion,
    JUGADOR_EDAD: String(jugador.age),
    EQUIPO: jugador.team,
    SEGURO_MEDICO: textoSeguro(seguro.tiene),
    ASEGURADORA: seguro.aseguradora,
    FECHA: fechaLarga(ahora),
  };

  const codigo = crypto
    .createHash('sha256')
    .update(JSON.stringify({ datos, v: plantilla.version, t: ahora.toISOString() }))
    .update(firmaBuf)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  const ip = ipDe(req);

  const pdfBuf = await generarPdfAutorizacion({
    plantilla, datos, firmaPng: firmaBuf,
    evidencia: { fechaHora: fechaHora(ahora), ip, codigo },
  });

  const base = `${jugador.identificacion}_${Date.now()}`;
  const cedulaBuf = req.files.representanteCedulaImage[0].buffer;
  const cedulaEsPdf = tipoPorContenido(cedulaBuf) === 'pdf';
  const [autRes, firmaRes, cedRes, fotoRes] = await Promise.all([
    // Extensión .pdf en el public_id para que la URL abra directo como PDF
    uploadBuffer(pdfBuf, `aut_digital_${base}.pdf`, 'raw'),
    uploadBuffer(firmaBuf, `firma_rep_${base}`),
    cedulaEsPdf
      ? uploadBuffer(cedulaBuf, `cedula_rep_${base}.pdf`, 'raw')
      : uploadBuffer(cedulaBuf, `cedula_rep_${base}`),
    uploadBuffer(req.files.representanteFotoImage[0].buffer, `foto_rep_${base}`),
  ]);

  return {
    autorizacionUrl: autRes.secure_url,
    representante: {
      ...rep,
      cedulaImageUrl: cedRes.secure_url,
      fotoImageUrl: fotoRes.secure_url,
      firmaUrl: firmaRes.secure_url,
    },
    seguroMedico: { tiene: seguro.tiene, aseguradora: seguro.aseguradora },
    autorizacionInfo: {
      plantillaVersion: plantilla.version,
      firmadoEn: ahora,
      ip,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      codigo,
    },
  };
}

const CAMPOS_ARCHIVO_REPRESENTANTE = ['firmaRepresentante', 'representanteCedulaImage', 'representanteFotoImage'];

module.exports = {
  PLACEHOLDERS,
  PARENTESCOS,
  PLANTILLA_PREDETERMINADA,
  CAMPOS_PLANTILLA,
  CAMPOS_ARCHIVO_REPRESENTANTE,
  obtenerPlantillaActiva,
  validarPlantilla,
  generarPdfAutorizacion,
  datosEjemplo,
  validarRepresentante,
  firmarAutorizacion,
};
