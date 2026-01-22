const mongoose = require('mongoose');

const fileChunkSchema = new mongoose.Schema({
  file: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
  chunkIndex: { type: Number, required: true },
  content: { type: String, required: true },
  pageNumber: { type: Number },
  sectionTitle: { type: String },
  tokenCount: { type: Number }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

fileChunkSchema.index({ file: 1, chunkIndex: 1 }, { unique: true });

mongoose.model('FileChunk', fileChunkSchema);