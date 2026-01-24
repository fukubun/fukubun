const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  // 投稿者情報
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

  // 匿名投稿でも内部でユーザーと紐づけるための owner
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },

  // ★ コメント一覧（今回の本命）
  comments: [
    {
      user: { type: String, required: true },        // 表示名
      username: { type: String, required: true },    // @ユーザー名
      userIcon: { type: String, default: null },     // アイコン
      message: { type: String, required: true },     // コメント本文
      time: { type: Date, default: Date.now }        // コメント時間
    }
  ]
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