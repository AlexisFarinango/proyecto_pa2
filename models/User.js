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
  team:      { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
