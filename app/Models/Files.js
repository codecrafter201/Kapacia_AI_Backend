const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema(
  {
    case: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileSizeBytes: { type: Number, required: true },
    mimeType: { type: String, required: true },
    storageKey: { type: String },

    pageCount: { type: Number },

    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: "uploaded_at", updatedAt: false } }
);

mongoose.model("File", fileSchema);
