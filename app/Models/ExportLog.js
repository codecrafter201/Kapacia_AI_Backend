'use strict';
const mongoose = require('mongoose');

const exportLogSchema = new mongoose.Schema({
  exportType: {
    type: String,
    enum: ['session', 'case', 'timeline_summary'],
    required: true
  },

  case: { type: mongoose.Schema.Types.ObjectId, ref: 'Case' },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  timelineSummary: { type: mongoose.Schema.Types.ObjectId, ref: 'TimelineSummary' },

  exportFormat: { type: String, enum: ['pdf', 'docx', 'json'], required: true },
  fileName: { type: String, required: true },
  fileUrl: { type: String },
  fileSizeBytes: { type: Number },

  includeAudio: { type: Boolean, default: false },
  includeTranscript: { type: Boolean, default: true },
  includeNotes: { type: Boolean, default: true },
  includeFiles: { type: Boolean, default: false },
  includeChatHistory: { type: Boolean, default: false },

  expiresAt: { type: Date, required: true },
  downloaded: { type: Boolean, default: false },
  downloadedAt: { type: Date },

  exportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: { createdAt: 'exported_at', updatedAt: false } });

mongoose.model('ExportLog', exportLogSchema);
