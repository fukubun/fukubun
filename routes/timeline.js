// routes/timeline.js
const express = require('express');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const Post = require('../models/Post');
const User = require('../models/User');

const router = express.Router();

// --- アップロード設定（index.js と同じ設定をコピー） ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('画像ファイルのみ許可されています'), false);
  }
});

// --- ヘルパー（index.js と同じ挙動を保つ） ---
function formatRelativeTime(date) {
  if (!date) return '';
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function formatProfileTime(date) {
  if (!date) return '';
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return date.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// =========================
// GET /timeline
// =========================
router.get('/', async (req, res) => {
  if (!req.user) return res.redirect('/');

  try {
    const rawPosts = await Post.find({ username: { $ne: null } }).sort({ time: -1 });
    const formattedPosts = rawPosts.map(p => ({
      ...p._doc,
      id: p._id.toString(),
      time: formatRelativeTime(p.time)
    }));

    const users = await User.find({}, 'username icon');
    const userMap = {};
    users.forEach(u => { userMap[u.username] = u.icon; });

    res.render('timeline', { posts: formattedPosts, user: req.user, userMap });
  } catch (err) {
    console.error('timeline list error', err);
    res.status(500).send('サーバーエラー');
  }
});

// =========================
// GET /timeline/post
// =========================
router.get('/post', (req, res) => {
  if (!req.user) return res.redirect('/');
  const from = req.query.from || "timeline";
  res.render('post', { from, user: req.user });
});

// =========================
// POST /timeline/post
// =========================
router.post('/post', upload.single('image'), async (req, res) => {
  if (!req.user) return res.redirect('/');

  const { message, redirect } = req.body;
  const postData = {
    user: req.user.name,
    username: req.user.username,
    userIcon: req.user.icon,
    message,
    likes: 0,
    likedUsers: [],
    time: new Date()
  };

  try {
    if (req.file) {
      const inputPath = req.file.path; // public/uploads/xxxx
      const outputName = `post-${Date.now()}-${req.file.filename}.png`;
      const outputPath = `public/uploads/${outputName}`;

      await sharp(inputPath)
        .resize(800, 800, { fit: 'cover' })
        .png()
        .toFile(outputPath);

      postData.image = `/uploads/${outputName}`;
    }

    await Post.create(postData);

    if (redirect === "profile") return res.redirect('/profile');
    return res.redirect('/timeline');
  } catch (err) {
    console.error('timeline post error', err);
    return res.status(500).send('投稿に失敗しました');
  }
});

// =========================
// POST /timeline/delete/:id
// =========================
router.post('/delete/:id', async (req, res) => {
  const id = req.params.id;
  let redirectTo = req.body && req.body.redirect ? String(req.body.redirect) : '/timeline';

  try {
    if (redirectTo === 'profile') redirectTo = '/profile';
    else if (redirectTo === 'timeline') redirectTo = '/timeline';
    if (!redirectTo.startsWith('/')) redirectTo = '/' + redirectTo;

    const allowed = ['/timeline', '/profile'];
    if (req.user && req.user.username) allowed.push(`/users/${req.user.username}`);
    if (!allowed.includes(redirectTo)) redirectTo = '/timeline';
  } catch (e) {
    console.error('redirect normalization error', e);
    redirectTo = '/timeline';
  }

  if (!req.user || !req.user.username) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ success: false, message: '認証が必要です' });
    }
    return res.redirect('/login');
  }

  try {
    const deleted = await Post.findOneAndDelete({ _id: id, username: req.user.username });
    if (!deleted) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(404).json({ success: false, message: '投稿が見つかりません' });
      }
      return res.status(404).send('投稿が見つかりません');
    }

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true });
    }
    return res.redirect(redirectTo);
  } catch (err) {
    console.error('delete error:', err);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ success: false, message: '削除に失敗しました' });
    }
    return res.status(500).send('削除に失敗しました');
  }
});

// =========================
// POST /timeline/like/:id
// =========================
router.post('/like/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "not logged in" });

  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "not found" });

    const username = req.user.username;

    if (Array.isArray(post.likedUsers) && post.likedUsers.includes(username)) {
      post.likedUsers = post.likedUsers.filter(u => u !== username);
      post.likes = Math.max(0, (post.likes || 0) - 1);
    } else {
      post.likedUsers = post.likedUsers || [];
      post.likedUsers.push(username);
      post.likes = (post.likes || 0) + 1;
    }

    await post.save();

    const isLiked = Array.isArray(post.likedUsers) && post.likedUsers.includes(username);

    const html = `
      ${isLiked
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="red" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>'
      }
      <span>${post.likes}</span>
    `;

    return res.json({ html });
  } catch (err) {
    console.error('like error', err);
    return res.status(500).json({ error: 'failed' });
  }
});

module.exports = router;