const mongoose = require('mongoose');

const EquipoSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  codigo: { type: String, trim: true }, // sin default null
  dirigenteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dirigente' },
}, { timestamps: true });

EquipoSchema.index(
  { codigo: 1 },
  { unique: true, partialFilterExpression: { codigo: { $type: 'string' } } }
);

module.exports = mongoose.model('Equipo', EquipoSchema);
