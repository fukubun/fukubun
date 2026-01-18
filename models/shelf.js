const mongoose = require("mongoose");

const ShelfSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: String,
  authors: String,
  thumbnail: String,
  isbn: String,
  readingNote: { type: String, default: "" },
  review: { type: String, default: "" },

  // ★ 本を追加した日
  createdAt: { type: Date, default: Date.now },

  // ★ 最後に読んだ日
  lastReadAt: { type: Date, default: null },

  // ★ 累計読書時間（秒）
  totalReadingSeconds: { type: Number, default: 0 },

  // ★ 今日の読書時間（秒）
  todayReadingSeconds: { type: Number, default: 0 },

  // ★ 読書中かどうか（続きを読むに表示するため）
  isReading: { type: Boolean, default: false },

  // ★ 読了したかどうか（読了本棚に表示するため）
  isFinished: { type: Boolean, default: false },

  // ★ 読了日（読了ボタンを押した瞬間）
  finishedAt: { type: Date, default: null }
});

module.exports = mongoose.model("Shelf", ShelfSchema);