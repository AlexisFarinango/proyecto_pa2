// models/FixtureFecha.js
const mongoose = require('mongoose');

const PartidoSchema = new mongoose.Schema(
  {
    // Referencias a tus equipos existentes
    equipo1: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Equipo',
      required: true,
    },
    equipo2: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Equipo',
      required: true,
    },

    // Fecha específica de ese partido
    fechaPartido: {
      type: Date,
      required: false, // o simplemente elimina esta línea
      default: null,
    },

    // Listas de valores adicionales por equipo
    valor_adicional_eq1: [
      { type: String },
    ],
    valor_adicional_eq2: [
      { type: String },
    ],
  },
  { _id: true }
);

const FixtureFechaSchema = new mongoose.Schema(
  {
    // 1, 2, 3, ... 15
    numeroFecha: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },

    // "Primera Fecha", "Segunda Fecha", etc.
    titulo: {
      type: String,
      required: true,
    },

    // Fecha general de la jornada (opcional)
    fechaCabecera: {
      type: Date,
      required: false,
      default: null,
    },

    // Partidos dinámicos (pueden ser 8, 4, 2...)
    partidos: [PartidoSchema],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('FixtureFecha', FixtureFechaSchema);
