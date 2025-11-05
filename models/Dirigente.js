const mongoose = require('mongoose');

const DirigenteSchema = new mongoose.Schema({
  usuario: { type: String, required: true, unique: true,trim: true},
  password: { type: String, required: true, trim: true },     // (MVP: plano; si quieres, luego hash)
  nombre:   { type: String, required: true, trim: true},

}, { timestamps: true });

module.exports = mongoose.model('Dirigente', DirigenteSchema);
