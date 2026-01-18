const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  // 投稿者情報（既存フィールドを維持）
  user: { type: String, default: null },
  username: { type: String, default: null },

  // コンテンツ
title: { type: String, default: null },
  message: { type: String, default: '' },
  image: { type: String, default: null },

  // メタ情報
  time: { type: Date, default: Date.now },
  likes: { type: Number, default: 0 },
  likedUsers: { type: [String], default: [] },

  // 投稿種別
  kind: { type: String, enum: ['timeline', 'anonymous', 'novel'], default: 'timeline' },

  // 🔥 追加：匿名投稿でも内部でユーザーと紐づけるための owner
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false }
}, {
  timestamps: true
});

// id を _id の代わりに使う
postSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  }
});

module.exports = mongoose.model('Post', postSchema);