const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  name: String,
  username: String,
  password: String,
  bio: String,

  following: [String],

  savedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],

  // ★ 閲覧履歴（tokumei_log）
  viewedPosts: [{
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
    viewedAt: { type: Date, default: Date.now }
  }],

  // ★ 評価（tokumei_review）
  reviews: [{
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
    rating: { type: String, enum: ['bad', 'good', 'great'] },
    reviewedAt: { type: Date, default: Date.now }
  }],

  icon: {
    type: String,
    default: "/images/default_icon.svg"
  }
});

// パスワードハッシュ
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// パスワード比較
userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);