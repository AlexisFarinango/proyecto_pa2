const mongoose = require('mongoose');

const EquipoSchema = new mongoose.Schema({
  nombre:      { type: String, required: true, unique: true, trim: true },
  codigo:      { type: String, unique: true, sparse: true, default: null }, // <- NO required
  dirigenteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dirigente', required: true }
}, { timestamps: true });

module.exports = mongoose.model('Equipo', EquipoSchema);
