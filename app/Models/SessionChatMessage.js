'use strict';
const mongoose = require('mongoose');

const sessionChatMessageSchema = new mongoose.Schema({
  chat: { type: mongoose.Schema.Types.ObjectId, ref: 'SessionChat', required: true },
  
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  
  citations: { type: Array },
  
  modelName: { type: String },
  tokensUsed: { type: Number },
  responseTimeMs: { type: Number }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

sessionChatMessageSchema.index({ chat: 1 });
sessionChatMessageSchema.index({ role: 1 });

mongoose.model('SessionChatMessage', sessionChatMessageSchema);
