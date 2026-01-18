const mongoose = require('mongoose');

const DiarySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String },
  content: { type: String, required: true },
  time: { type: String },     // 表示用の時刻（任意）
  date: { type: String },     // YYYY-MM-DD（検索用）
  isPublic: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });      // ★ createdAt / updatedAt を自動生成

module.exports = mongoose.model('Diary', DiarySchema);