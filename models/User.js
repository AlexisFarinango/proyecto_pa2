const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  codDirigente: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName:  { type: String, required: true },
  dob:       { type: Date, required: true },
  age:       { type: Number, required: true },
  identificacion:    { type: String, required: true, unique: true },
  numjugador:{ type: Number, required: true },
  idImageUrl:    { type: String, required: true },
  idBackImageUrl: { type: String, required: true },
  selfieImageUrl:{ type: String, required: true },
  autorizacionUrl: { type: String, default: null },
  // Datos del representante (solo jugadores de 14 a 17 años con autorización digital)
  representante: {
    nombre:         { type: String },
    cedula:         { type: String },
    parentesco:     { type: String },
    telefono:       { type: String },
    cedulaImageUrl: { type: String }, // copia de la cédula del representante
    fotoImageUrl:   { type: String }, // foto del representante sosteniendo su cédula
    firmaUrl:       { type: String }
  },
  // Seguro médico del menor declarado en la autorización
  seguroMedico: {
    tiene:       { type: Boolean },
    aseguradora: { type: String } // "NA (No Aplica)" cuando no tiene
  },
  // Evidencia de la firma electrónica
  autorizacionInfo: {
    plantillaVersion: { type: Number },
    firmadoEn:        { type: Date },
    ip:               { type: String },
    userAgent:        { type: String },
    codigo:           { type: String }
  },
  team:      { type: String, required: true },
  eliminado: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
