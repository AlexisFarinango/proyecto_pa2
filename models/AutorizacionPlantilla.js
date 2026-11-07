const mongoose = require('mongoose');

// Cada edición del administrador crea una NUEVA versión (las anteriores no se modifican),
// así las autorizaciones ya firmadas siempre conservan el texto con el que se firmaron.
const AutorizacionPlantillaSchema = new mongoose.Schema({
  version:      { type: Number, required: true, unique: true },
  titulo:       { type: String, default: '' },
  destinatario: { type: String, default: '' },
  cuerpo:       { type: String, required: true },
  ciudad:       { type: String, required: true },
  nota:         { type: String, default: '' },
  despedida:    { type: String, default: '' },
  activa:       { type: Boolean, default: false },
  createdAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('AutorizacionPlantilla', AutorizacionPlantillaSchema);
