const mongoose = require("mongoose");

const articleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    url: { type: String, required: true, unique: true },
    author: { type: String },
    publishedAt: { type: Date },
    excerpt: { type: String },
    content: { type: String },
    references: [
      {
        title: { type: String },
        url: { type: String },
      },
    ],
    source: { type: String, default: "beyondchats" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Article", articleSchema);
