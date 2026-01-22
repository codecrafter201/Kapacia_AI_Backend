'use strict';
const mongoose = require('mongoose');

const sessionChatSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  title: { type: String },
  isActive: { type: Boolean, default: true },
  messageCount: { type: Number, default: 0 }
}, { timestamps: true });

sessionChatSchema.index({ session: 1, user: 1 });
sessionChatSchema.index({ isActive: 1 });

mongoose.model('SessionChat', sessionChatSchema);
