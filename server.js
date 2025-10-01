require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const { configure, uploadBuffer } = require('./utils/cloudinary');
const User = require('./models/User');
const basicAuth = require('./middleware/basicAuth');
const ExcelJS = require('exceljs');
const axios = require('axios');

dayjs.extend(customParseFormat);

const app = express();
app.use(cors());
app.use(express.json());
const teamsList = require('./utils/teams');

app.get('/api/teams/validate/:code', (req, res) => {
  const { code } = req.params;
  const team = teamsList.find(t => t.codDirigente === code);
  if (!team) return res.status(404).json({ message: 'Código inválido' });
  res.json(team);
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Conectado a MongoDB Atlas en la base Futbol"))
  .catch(err => console.error("❌ Error al conectar:", err));

// Cloudinary config
configure({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// multer memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed'), false);
    cb(null, true);
  }
});

// regex validations
const nameRegex = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/;
const cedulaRegex = /^\d{10}$/;

app.post(
  '/api/users',
  upload.fields([
    { name: 'idImage', maxCount: 1 },
    { name: 'idBackImage', maxCount: 1 },
    { name: 'selfieImage', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { codDirigente, firstName, lastName, dob, cedula, numjugador } = req.body;

      if (!codDirigente) return res.status(400).json({ message: 'Código de dirigente requerido' });

      // Validar código
      const teamData = teamsList.find(t => t.codDirigente === codDirigente);
      if (!teamData) return res.status(400).json({ message: 'Código inválido' });

      // Validaciones básicas
      if (!firstName || !nameRegex.test(firstName)) return res.status(400).json({ message: 'Nombres inválidos' });
      if (!lastName || !nameRegex.test(lastName)) return res.status(400).json({ message: 'Apellidos inválidos' });
      if (!cedula || !cedulaRegex.test(cedula)) return res.status(400).json({ message: 'Cédula inválida' });
      if (!dob) return res.status(400).json({ message: 'Fecha requerida' });
      if (!numjugador || isNaN(numjugador) || numjugador < 1 || numjugador > 99) {
        return res.status(400).json({ message: 'Número de jugador debe ser entre 1 y 99' });
      }

      // Verificar cantidad máxima de jugadores
      const count = await User.countDocuments({ team: teamData.team });
      if (count >= 20) {
        return res.status(400).json({ message: 'Este equipo ya tiene 20 jugadores registrados' });
      }

      // Verificar número ya usado en ese equipo
      const existsNum = await User.findOne({ team: teamData.team, numjugador });
      if (existsNum) {
        return res.status(400).json({ message: `Número ${numjugador} ya registrado en ${teamData.team}` });
      }

      // Parse fecha
      let parsed = dayjs(dob, ['YYYY-MM-DD', 'DD/MM/YYYY'], true);
      if (!parsed.isValid()) return res.status(400).json({ message: 'Fecha inválida' });
      const age = dayjs().diff(parsed, 'year');

      // Subir imágenes
      if (!req.files['idImage'] || !req.files['idBackImage'] || !req.files['selfieImage']) {
        return res.status(400).json({ message: 'Todas las imágenes son obligatorias' });
      }

      const idResult = await uploadBuffer(req.files['idImage'][0].buffer, `cedula_${cedula}_${Date.now()}`);
      const idBackResult = await uploadBuffer(req.files['idBackImage'][0].buffer, `cedula_back_${cedula}_${Date.now()}`);
      const selfieResult = await uploadBuffer(req.files['selfieImage'][0].buffer, `selfie_${cedula}_${Date.now()}`);

      const user = new User({
        codDirigente,
        firstName,
        lastName,
        dob: parsed.toDate(),
        age,
        cedula,
        numjugador,
        idImageUrl: idResult.secure_url,
        idBackImageUrl: idBackResult.secure_url,
        selfieImageUrl: selfieResult.secure_url,
        team: teamData.team
      });

      await user.save();
      res.json({ message: 'Usuario registrado con éxito', userId: user._id });
    } catch (err) {
      console.error(err);
      if (err.code === 11000 && err.keyPattern?.cedula) {
      // Error de duplicado de cédula
        return res.status(409).json({
          message: 'Cédula ya registrada',
          field: 'cedula',
          detail: err.keyValue
        });
      }
      res.status(500).json({ message: 'Error en servidor', detail: err.message });
    }
  }
);

app.get('/api/users', async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).lean();
  res.json(users);
});

// Protected export endpoint
app.get('/api/users/export', basicAuth, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: 1 }).lean();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Usuarios');

    worksheet.columns = [
      { header: 'NOMBRES', key: 'firstName', width: 20 },
      { header: 'APELLIDOS', key: 'lastName', width: 20 },
      { header: 'EDAD', key: 'age', width: 10 },
      { header: 'FECHA_NACIMIENTO', key: 'dob', width: 15 },
      { header: 'CEDULA', key: 'cedula', width: 15 },
      { header: 'NUMERO_JUGADOR', key: 'numjugador', width: 15 },
      { header: 'EQUIPO', key: 'team', width: 20 },
      { header: 'FOTO_CEDULA_FRONTAL', key: 'idImage', width: 18 },
      { header: 'FOTO_CEDULA_TRASERA', key: 'idBackImage', width: 18 },
      { header: 'FOTO_SELFIE', key: 'selfieImage', width: 18 },
    ];

    // add rows
    users.forEach(u => {
      worksheet.addRow({
        firstName: u.firstName,
        lastName: u.lastName,
        age: `${u.age} AÑOS`,
        dob: dayjs(u.dob).format('DD/MM/YYYY'),
        cedula: u.cedula,
        numjugador: u.numjugador,
        team: u.team,
        idImage: '',
        idBackImage: '',
        selfieImage: ''
      });
    });

    // add images
    for (let i=0; i<users.length; i++) {
      const u = users[i];
      const rowNumber = i + 2;
      worksheet.getRow(rowNumber).height = 80;

      if (u.idImageUrl) {
        const resp = await axios.get(u.idImageUrl, { responseType: 'arraybuffer' });
        const buf = Buffer.from(resp.data);
        const ext = (u.idImageUrl.split('.').pop().split('?')[0] || 'png').toLowerCase();
        const imageId = workbook.addImage({ buffer: buf, extension: ext });
        worksheet.addImage(imageId, { tl: { col: 7, row: rowNumber -1 }, ext: { width: 120, height: 80 } });
      }
      if (u.idBackImageUrl) {
        const resp = await axios.get(u.idBackImageUrl, { responseType: 'arraybuffer' });
        const buf = Buffer.from(resp.data);
        const ext = (u.idBackImageUrl.split('.').pop().split('?')[0] || 'png').toLowerCase();
        const imageId3 = workbook.addImage({ buffer: buf, extension: ext });
        worksheet.addImage(imageId3, { tl: { col: 8, row: rowNumber -1 }, ext: { width: 120, height: 80 } });
      }

      if (u.selfieImageUrl) {
        const resp2 = await axios.get(u.selfieImageUrl, { responseType: 'arraybuffer' });
        const buf2 = Buffer.from(resp2.data);
        const ext2 = (u.selfieImageUrl.split('.').pop().split('?')[0] || 'png').toLowerCase();
        const imageId2 = workbook.addImage({ buffer: buf2, extension: ext2 });
        worksheet.addImage(imageId2, { tl: { col: 9, row: rowNumber -1 }, ext: { width: 120, height: 80 } });
      }
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=> console.log('Server listening on', PORT));
