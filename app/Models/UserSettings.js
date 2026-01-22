'use strict';
const mongoose = require('mongoose');

const userSettingsSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
  defaultLanguage: { type: String, enum: ['english', 'mandarin'], default: 'english' },
  piiMaskingEnabled: { type: Boolean, default: true },
  noteFramework: { type: String, enum: ['SOAP', 'DAP'], default: 'SOAP' },
  timezone: { type: String, default: 'Asia/Singapore' }
}, { timestamps: true });

mongoose.model('UserSettings', userSettingsSchema);
