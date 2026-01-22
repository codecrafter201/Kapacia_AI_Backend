'use strict';
const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
  settingKey: { type: String, required: true, unique: true },
  settingValue: { type: Object, required: true },
  description: { type: String },
  isSensitive: { type: Boolean, default: false },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: false, updatedAt: 'updated_at' } });

systemSettingsSchema.index({ settingKey: 1 });

mongoose.model('SystemSettings', systemSettingsSchema);
