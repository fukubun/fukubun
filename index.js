const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const mongoose = require('mongoose');
const User = require('./models/User');
const Post = require('./models/Post');
// ★ multer, sharp はもうローカル保存に使わないなら削除してOK
// const multer = require('multer');
// const sharp = require('sharp');
const Diary = require('./models/Diary');
const Shelf = require("./models/shelf");
const upload = require('./middleware/upload');

require('dotenv').config();

const app = express();

mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));


// -------------------------
// Helpers
// -------------------------
function formatProfileTime(date) {
  if (!date) return '';
  const now = new Date();
  const diff = (now - date) / 1000; // seconds
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return date.toLocaleDateString("ja-JP", { year: "numeric", day: "2-digit", month: "2-digit" });
}

function formatRelativeTime(date) {
  if (!date) return '';
  const now = new Date();
  const diff = (now - date) / 1000; // seconds
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

// -------------------------
// Layouts / View / Static
// -------------------------
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------
// Body / Session
// -------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'fukubun-secret',
  resave: false,
  saveUninitialized: false
}));

// -------------------------
// req.user middleware
// -------------------------
app.use(async (req, res, next) => {
  try {
    if (req.session && req.session.userId) {
      req.user = await User.findById(req.session.userId);
    } else {
      req.user = null;
    }
  } catch (e) {
    console.error('user load error', e);
    req.user = null;
  }
  next();
});

// -------------------------
// Password Gate (site-wide)
// -------------------------
app.use((req, res, next) => {
  // すでに通過済みならOK
  if (req.session.allowed) return next();

  // パスワード送信時
  if (req.path === "/gate" && req.method === "POST") {
    if (req.body.pass === process.env.SITE_PASS) {
      req.session.allowed = true;
      return res.redirect("/");
    }
    return res.render("gate", { error: "パスワードが違います" });
  }

  // gateページは表示OK
  if (req.path === "/gate") {
    return res.render("gate");
  }

  // それ以外はゲートへ
  return res.redirect("/gate");
});

// -------------------------
// Routes
// -------------------------

// Home / Login page
app.get('/', (req, res) => res.render('home'));
app.get('/login', (req, res) => res.render('home'));

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.render('home', { error: "ユーザーが存在しません" });
  const ok = await user.comparePassword(password);
  if (!ok) return res.render('home', { error: "パスワードが違います" });
  req.session.userId = user._id;
  res.redirect('/timeline');
});

// Signup
app.get('/signup', (req, res) => res.render('signup'));
app.post('/signup', async (req, res) => {
  const { name, username, password } = req.body;
  const exists = await User.findOne({ username });
  if (exists) return res.render('signup', { error: "このユーザー名はすでに使われています" });
  const user = new User({ name, username, password });
  await user.save();
  req.session.userId = user._id;
  res.redirect('/profile');
});

// -------------------------
// Timeline (user posts only)
// -------------------------
app.get('/timeline', async (req, res) => {
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

// -------------------------
// 投稿詳細ページ /timeline/post/:id
// -------------------------
app.get('/timeline/post/:id', async (req, res) => {
  if (!req.user) return res.redirect('/');

  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).send('投稿が見つかりません');

    // ★ 投稿者の最新アイコンを取得するための userMap を作る
    const users = await User.find({}, 'username icon');
    const userMap = {};
    users.forEach(u => { userMap[u.username] = u.icon });

    // ★ userMap を EJS に渡す
    res.render('timeline_detail', {
  post,
  user: req.user,
  userMap,
  from: req.query.from || null
});

  } catch (err) {
    console.error('detail error', err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// Post form (timeline)
// -------------------------
app.get('/post', (req, res) => {
  if (!req.user) return res.redirect('/');
  const from = req.query.from || "timeline";
  res.render('post', { from, user: req.user });
});

// -------------------------
// Create post (timeline)
// -------------------------
app.post('/post', upload.single('image'), async (req, res) => {
  if (!req.user) return res.redirect('/');

  const { message, redirect } = req.body;

  const postData = {
    user: req.user.name,
    username: req.user.username,
    userIcon: req.user.icon,
    message,
    likes: 0,
    likedUsers: [],
    comments: [],
    time: new Date()
  };

  try {
    if (req.file) {
      postData.image = req.file.path; // Cloudinary URL
    }

    await Post.create(postData);

    if (redirect === "profile") return res.redirect('/profile');
    return res.redirect('/timeline');

  } catch (err) {
    console.error('timeline post error', err);
    return res.status(500).send('投稿に失敗しました');
  }
});

// -------------------------
// Delete post (timeline)
// -------------------------
app.post('/delete/:id', async (req, res) => {
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

// -------------------------
// Like toggle (timeline)
// -------------------------
app.post('/like/:id', async (req, res) => {
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

    const html = `${isLiked
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="red" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>'}
      <span>${post.likes}</span>`;

    return res.json({ html });

  } catch (err) {
    console.error('like error', err);
    return res.status(500).json({ error: 'failed' });
  }
});

// -------------------------
// Profile & follow
// -------------------------
app.get('/profile', async (req, res) => {
  if (!req.user) return res.redirect('/');
  const rawPosts = await Post.find({ username: req.user.username }).sort({ time: -1 });
  const myPosts = rawPosts.map(p => ({ ...p._doc, id: p._id.toString(), time: formatProfileTime(p.time) }));
  const followingCount = Array.isArray(req.user.following) ? req.user.following.length : 0;
  const followerCount = await User.countDocuments({ following: req.user.username });
  res.render('profile', { user: req.user, posts: myPosts, followingCount, followerCount });
});

app.get('/profile/edit', (req, res) => {
  if (!req.user) return res.redirect('/');
  res.render('profile_edit', { user: req.user });
});

app.post('/profile/edit', upload.single('icon'), async (req, res) => {
  if (!req.user) return res.redirect('/');

  const { name, bio, resetIcon } = req.body;
  const updateData = { name, bio };

  if (resetIcon === "true") {
    // 初期アイコンに戻す
    updateData.icon = "/images/default_icon.svg";

  } else if (req.file) {
    // Cloudinary の URL がここに入る
    updateData.icon = req.file.path;
  }

  await User.updateOne({ _id: req.user._id }, updateData);
  res.redirect('/profile');
});

app.get('/profile/:username', async (req, res) => {
  if (!req.user) return res.redirect('/');
  const username = req.params.username;
  if (req.user.username === username) return res.redirect('/profile');

  const profileUser = await User.findOne({ username });
  if (!profileUser) return res.status(404).send("User not found");

  const rawPosts = await Post.find({ username }).sort({ time: -1 });
  const posts = rawPosts.map(p => ({ ...p._doc, id: p._id.toString(), time: formatProfileTime(p.time) }));

  const users = await User.find({}, 'username icon');
  const userMap = {};
  users.forEach(u => { userMap[u.username] = u.icon; });

  const followingCount = Array.isArray(profileUser.following) ? profileUser.following.length : 0;
  const followerCount = await User.countDocuments({ following: profileUser.username });

  res.render('profile_other', { user: req.user, profileUser, posts, userMap, followingCount, followerCount });
});

app.post('/follow/:username', async (req, res) => {
  if (!req.user) return res.redirect('/');
  const targetUsername = req.params.username;

  const currentUser = await User.findOne({ username: req.user.username });
  const targetUser = await User.findOne({ username: targetUsername });

  if (!targetUser || currentUser.username === targetUser.username) return res.redirect('/profile');

  const alreadyFollowing = Array.isArray(currentUser.following) && currentUser.following.includes(targetUsername);

  if (!alreadyFollowing) {
    currentUser.following = currentUser.following || [];
    currentUser.following.push(targetUsername);
    await currentUser.save();
  }

  res.redirect(`/profile/${targetUsername}`);
});

app.post('/unfollow/:username', async (req, res) => {
  if (!req.user) return res.redirect('/');
  const targetUsername = req.params.username;

  const currentUser = await User.findOne({ username: req.user.username });
  currentUser.following = (currentUser.following || []).filter(u => u !== targetUsername);
  await currentUser.save();

  res.redirect(`/profile/${targetUsername}`);
});

// -------------------------
// tokumei 一覧
// -------------------------
app.get('/tokumei', async (req, res) => {
  try {
    const match = {
      $or: [
        { kind: 'anonymous' },
        { kind: { $exists: false }, author: null }
      ]
    };

    const count = await Post.countDocuments(match);

    const docs = count > 0
      ? await Post.aggregate([
          { $match: match },
          { $sample: { size: count } },
          { $project: {
              _id: 1,
              time: 1,
              createdAt: 1,
              updatedAt: 1,
              title: 1,
              message: 1,
              image: 1,
              likes: 1,
              saved: 1,
              kind: 1,
              owner: 1   // ← ここで確実に owner を残す
          }}
        ])
      : [];

    const posts = docs.map(p => ({
      id: p._id,
      time: (p.time || p.createdAt || p.updatedAt)
        ? new Date(p.time || p.createdAt || p.updatedAt).toLocaleString('ja-JP', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
          })
        : '',
      title: p.title || '',
      message: p.message || '',
      image: p.image || null,
      likes: p.likes || 0,
      saved: !!p.saved,
      kind: p.kind || null,

      // 🔥 ログイン必須前提なので、owner === user._id なら削除可能
      deletable: !!(req.user && p.owner && String(p.owner) === String(req.user._id))
    }));

    res.render('tokumei', { posts, user: req.user, page: "blog" });
  } catch (err) {
    console.error('tokumei render error', err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei_post: 新規匿名投稿画面と投稿処理
// -------------------------

// Cloudinary 用の upload を使う
// ※ すでに index.js の上部で
// const upload = require('./middleware/upload');
// を読み込んでいる前提

// GET: 新規投稿フォーム（tokumei 用）
app.get('/tokumei_post', (req, res) => {
  res.render('tokumei_post', { from: 'tokumei', user: req.user });
});

// POST: 画像付き匿名投稿の受け取り
app.post('/tokumei_post', upload.single('image'), async (req, res) => {
  try {
    const { title, message, redirect } = req.body || {};
    let imagePath = null;

    if (req.file) {
      // Cloudinary の URL がここに入る
      imagePath = req.file.path;
    }

    if (!req.user) {
      return res.status(403).send('ログインが必要です');
    }

    const newPost = new Post({
      user: req.user._id,   // 内部的には紐づけておく
      username: null,       // 表示しない
      title: title || null,
      message: message || '',
      image: imagePath,
      kind: 'anonymous',
      time: new Date(),
      owner: req.user._id   // 削除判定で使う
    });

    await newPost.save();

    const dest = redirect === 'profile' ? '/profile' : '/tokumei';
    res.redirect(dest);

  } catch (err) {
    console.error('tokumei_post create error', err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei 本文（ブログ詳細）
// -------------------------
app.get('/tokumei/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const from = req.query.from;   // ← ここで受け取る
    if (!post) {
      return res.status(404).send('投稿が見つかりません');
    }

    // ★ 閲覧履歴に追加（ログイン時のみ）
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          viewedPosts: {
            post: post._id,
            viewedAt: new Date()
          }
        }
      });
    }

    res.render('tokumei_detail', { 
      post,
      user: req.user,
      from: from || "tokumei"   // ★ これが正しい
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei 削除
// -------------------------
app.post('/tokumei/delete', async (req, res) => {
  try {
    const postId = req.body.postId;
    if (!postId) return res.redirect('/tokumei');

    if (!req.user) {
      return res.status(403).send('ログインが必要です');
    }

    // 🔥 owner がログインユーザーと一致するものだけ削除
    await Post.findOneAndDelete({
      _id: postId,
      owner: req.user._id
    }).exec();

    res.redirect('/tokumei');
  } catch (err) {
    console.error('tokumei delete error', err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei_novel 一覧（ブログと同じ仕組み）
// -------------------------
app.get('/tokumei_novel', async (req, res) => {
  try {
    const match = { kind: 'novel' };

    const count = await Post.countDocuments(match);

    const docs = count > 0
      ? await Post.aggregate([
          { $match: match },
          { $sample: { size: count } },   // ★ ランダム化（ブログと同じ）
          { $project: {
              _id: 1,
              time: 1,
              createdAt: 1,
              updatedAt: 1,
              title: 1,
              message: 1,
              image: 1,
              likes: 1,
              saved: 1,
              kind: 1,
              owner: 1   // ★ 削除判定に必要
          }}
        ])
      : [];

    const novels = docs.map(n => ({
      id: n._id,
      time: (n.time || n.createdAt || n.updatedAt)
        ? new Date(n.time || n.createdAt || n.updatedAt).toLocaleString('ja-JP', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
          })
        : '',
      title: n.title || '',
      message: n.message || '',
      image: n.image || null,
      likes: n.likes || 0,
      saved: !!n.saved,
      kind: n.kind || null,

      // ★ ブログと同じ削除判定
      deletable: !!(req.user && n.owner && String(n.owner) === String(req.user._id))
    }));

   res.render('tokumei_novel', { novels, user: req.user, page: "novel" });

  } catch (err) {
    console.error('tokumei_novel render error', err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei_novel 削除
// -------------------------
app.post('/tokumei_novel/delete', async (req, res) => {
  try {
    const { postId } = req.body;

    const novel = await Post.findById(postId);

    if (!novel) {
      return res.status(404).send('小説が見つかりません');
    }

    // ★ 自分の投稿かチェック
    if (!req.user || String(novel.owner) !== String(req.user._id)) {
      return res.status(403).send('削除権限がありません');
    }

    await Post.findByIdAndDelete(postId);

    res.redirect('/tokumei_novel');

  } catch (err) {
    console.error(err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei_novel_post
// -------------------------
app.get('/tokumei_novel_post', (req, res) => {
  res.render('tokumei_novel_post', { from: 'tokumei_novel', user: req.user });
});

// ★ Cloudinary 対応版（uploadTokumei → upload に変更）
app.post('/tokumei_novel_post', upload.single('image'), async (req, res) => {
  try {
    const { title, message, redirect } = req.body || {};
    let imagePath = null;

    if (req.file) {
      // Cloudinary の URL がここに入る
      imagePath = req.file.path;
    }

    if (!req.user) {
      return res.status(403).send('ログインが必要です');
    }

    const newNovel = new Post({
      user: req.user._id,
      username: null,
      title: title || null,
      message: message || '',
      image: imagePath,
      kind: 'novel',
      time: new Date(),
      owner: req.user._id
    });

    await newNovel.save();

    res.redirect('/tokumei_novel');
  } catch (err) {
    console.error('tokumei_novel_post error', err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei_novel 詳細ページ
// -------------------------
app.get('/tokumei_novel/:id', async (req, res) => {
  try {
    const novel = await Post.findById(req.params.id);
    const from = req.query.from;   // ★ 追加

    if (!novel) {
      return res.status(404).send('小説が見つかりません');
    }

    // ★ 閲覧履歴に追加（ログイン時のみ）
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        $push: {
          viewedPosts: {
            post: novel._id,
            viewedAt: new Date()
          }
        }
      });
    }

    res.render('tokumei_novel_detail', { 
      post: novel,
      novel,
      user: req.user,
      from: from || "tokumei_novel"   // ★ 修正ポイント
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei_save（保存）
// -------------------------
app.post('/tokumei_save', async (req, res) => {
  try {
    if (!req.user) return res.status(403).send('ログインが必要です');

    const postId = req.body.postId;

    await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { savedPosts: postId } }
    );

    const backURL = req.get('Referer') || '/tokumei';
    res.redirect(backURL);

  } catch (err) {
    console.error('tokumei_save error', err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei_save（解除）
// -------------------------
app.post('/tokumei_save/remove', async (req, res) => {
  try {
    if (!req.user) return res.status(403).send('ログインが必要です');

    const postId = req.body.postId;

    await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { savedPosts: postId } }
    );

    const backURL = req.get('Referer') || '/tokumei';
    res.redirect(backURL);

  } catch (err) {
    console.error('tokumei_save remove error', err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei_save 一覧（ブログ・小説統合）
// -------------------------
app.get('/tokumei_save', async (req, res) => {
  try {
    if (!req.user) return res.redirect('/login');

    const ids = req.user.savedPosts || [];

    const docs = await Post.find({ _id: { $in: ids } });

    // 時間整形（tokumei と同じ）
    const posts = docs.map(p => ({
      id: p._id,
      time: p.time
        ? new Date(p.time).toLocaleString('ja-JP', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
          })
        : '',
      title: p.title || '',
      message: p.message || '',
      image: p.image || null,
      kind: p.kind || null
    }));

    res.render('tokumei_save', { posts, user: req.user, page: "save" });

  } catch (err) {
    console.error('tokumei_save render error', err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei_log
// -------------------------
app.get('/tokumei_log', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const user = await User.findById(req.user._id)
    .populate('viewedPosts.post')
    .lean();

  const viewed = user.viewedPosts || [];

  const posts = viewed
  .sort((a, b) => b.viewedAt - a.viewedAt)
  .map(v => ({
    id: v.post._id,
    title: v.post.title,
    message: v.post.message,
    image: v.post.image,
    kind: v.post.kind,   // ★ これを追加
    time: v.viewedAt.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }),
    deletable: true
  }));

  res.render('tokumei_log', { posts, user: req.user, page: "log" });
});

// -------------------------
// tokumei_log 削除
// -------------------------
app.post('/tokumei_log/delete', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const postId = req.body.postId;

  const user = await User.findById(req.user._id);

  // ★ viewedPosts から最初に一致した1件だけ削除
  const index = user.viewedPosts.findIndex(v => String(v.post) === String(postId));

  if (index !== -1) {
    user.viewedPosts.splice(index, 1); // ← 1件だけ削除
    await user.save();
  }

  res.redirect('/tokumei_log');
});

// -------------------------
// tokumei_log 全削除
// -------------------------
app.post('/tokumei_log/clear', async (req, res) => {
  try {
    if (!req.user) return res.status(403).send('ログインが必要です');

    await User.findByIdAndUpdate(
      req.user._id,
      { $set: { viewedPosts: [] } }   // ★ 正しいフィールド名
    );

    res.redirect('/tokumei_log');

  } catch (err) {
    console.error('tokumei_log clear error', err);
    res.status(500).send('サーバーエラー');
  }
});

// -------------------------
// tokumei_log 本文
// -------------------------
app.get('/tokumei_log/:id', async (req, res) => {
  const post = await Post.findById(req.params.id).lean();
  if (!post) return res.redirect('/tokumei_log');

  res.render('tokumei_detail', { 
    post,
    user: req.user,
    from: "tokumei_log"
  });
});

// -------------------------
// tokumei_review（評価済み一覧表示）
// -------------------------
app.get('/tokumei_review', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const user = await User.findById(req.user._id)
    .populate('reviews.post')
    .lean();

  const reviews = (user.reviews || []).map(r => ({
    id: r.post?._id,
    title: r.post?.title,
    message: r.post?.message,
    image: r.post?.image,
    kind: r.post?.kind,   // ← EJS が必要としている
    rating: r.rating,
    time: r.reviewedAt?.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }),
    deletable: true
  }));

  res.render('tokumei_review', {
    reviews,
    user: req.user,
    page: 'review'
  });
});

// -------------------------
// tokumei_review 評価
// -------------------------
app.post('/tokumei_review', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const { postId, rating, redirect } = req.body;

  // ★ すでに評価済みか確認
  const existing = await User.findOne({
    _id: req.user._id,
    "reviews.post": postId
  });

  if (existing) {
    // ★ 既存の評価を上書き
    await User.updateOne(
      { _id: req.user._id, "reviews.post": postId },
      {
        $set: {
          "reviews.$.rating": rating,
          "reviews.$.reviewedAt": new Date()
        }
      }
    );
  } else {
    // ★ 新規追加（今まで通り）
    await User.findByIdAndUpdate(req.user._id, {
      $push: {
        reviews: {
          post: postId,
          rating,
          reviewedAt: new Date()
        }
      }
    });
  }

  res.redirect('/' + redirect);
});


// -------------------------
// diary（みんなの日記一覧）
// -------------------------
app.get('/diary', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const date = req.query.date;

  let query = {
  isPublic: true   // ← 自分の投稿も含まれる
};

if (date) {
  query.date = date;
}

  const diariesFromDb = await Diary.find(query)
    .sort({ createdAt: -1 });

  // ★ createdAt を JST に変換して jstTime を作る
 const diaries = diariesFromDb.map(d => {
  const obj = d.toObject();

  // createdAt → JST
  const created = new Date(d.createdAt);
  const jst = new Date(created.getTime() + 9 * 60 * 60 * 1000);

  // ★ JST の時刻
  obj.jstTime = jst.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  });

  // ★ JST の日本語日付（年・月・日・曜日）
  obj.jstDate = jst.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',   // 「1月」「2月」
    day: 'numeric',
    weekday: 'short' // 「月」「火」「水」
  });

  return obj;
});

  res.render('diary', {
    diaries,
    date,
    user: req.user
  });
});

// -------------------------
// diary_post（新規投稿ページ）
// -------------------------
app.get('/diary_post', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.render('diary_post', {
    error: null,
    title: "",
    content: "",
    date: "",
    isPublic: false,
    from: req.query.from || null   // ★ これを追加
  });
});

// -------------------------
// diary_post（新規投稿処理）
// -------------------------
app.post('/diary_post', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const { title, content, date, isPublic } = req.body;

  // ★ 本文が空ならエラー返す
  if (!content || content.trim() === "") {
    return res.render("diary_post", {
      error: "本文を入力してください。",
      title,
      content,
      date,
      isPublic: isPublic === "on"
    });
  }

  // ★ 日本語 → YYYY-MM-DD に変換
  const isoDate = date
    .replace("年", "-")
    .replace("月", "-")
    .replace("日", "");

  // ★ その日付の日記がすでにあるかチェック
  const exists = await Diary.findOne({
    user: req.user._id,
    date: isoDate
  });

  if (exists) {
    return res.render("diary_post", {
      error: "その日付の日記はすでに投稿されています。",
      title,
      content,
      date,
      isPublic: isPublic === "on"
    });
  }

  await Diary.create({
    user: req.user._id,
    title,
    content,
    date: isoDate,
    isPublic: isPublic === "on"
  });

  res.redirect('/diary');
});

// -------------------------
// diary_calendar（みんなの公開日記カレンダー）
// -------------------------
app.get('/diary_calendar', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const date = req.query.date || null;

  // ★ 公開日記だけ取得
  const diaries = await Diary.find({ isPublic: true }).select("date");

  // ★ 投稿数マップを作る
  const diaryCountMap = {};   // ← 日付ごとの投稿数
  const diaryDates = [];

  diaries.forEach(d => {
    if (!d.date) return;

    const key = d.date; // すでに YYYY-MM-DD

    diaryCountMap[key] = (diaryCountMap[key] || 0) + 1;
    diaryDates.push(key);
  });

  res.render("diary_calendar", {
    diaryDates,
    diaryCountMap,   // ← ★ 追加（これが重要）
    date,
    user: req.user,
    activeTab: "all"
  });
});

// -------------------------
// diary_delete
// -------------------------
app.post('/diary_delete', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  await Diary.deleteOne({
    _id: req.body.postId,
    user: req.user._id   // ★ 本人の投稿だけ削除
  });

  res.redirect('/diary');
});

// -------------------------
// diary 詳細（公開 or 自分の投稿のみ閲覧可）
// -------------------------
app.get('/diary/:id', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  // ★ user 条件を外す（ここが最重要）
  const diary = await Diary.findById(req.params.id);

  if (!diary) {
    return res.status(404).send("日記が見つかりません");
  }

  const isOwner = String(diary.user) === String(req.user._id);

  // ★ 公開日記 or 自分の投稿 なら閲覧OK
  if (!isOwner && !diary.isPublic) {
    return res.status(404).send("日記が見つかりません");
  }

  res.render('diary_detail', {
  diary,
  user: req.user,   // ★ これを追加
  from: req.query.from || null
});
});

// -------------------------
// diary_edit（編集ページ表示）
// -------------------------
app.get('/diary_edit/:id', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const diary = await Diary.findOne({
    _id: req.params.id,
    user: req.user._id
  });

  if (!diary) return res.redirect('/diary');

  res.render("diary_edit", { diary });
});

// -------------------------
// diary_edit（編集内容保存）
// -------------------------
app.post('/diary_edit', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const { postId, title, content, isPublic } = req.body;

  await Diary.updateOne(
    { _id: postId, user: req.user._id },
    { 
      title,
      content,
      isPublic: isPublic === "on"   // ← ★ これが超重要
    }
  );

  res.redirect(`/diary/${postId}`);
});

// -------------------------
// diary_my（自分の日記カレンダー）
// -------------------------
app.get('/diary_my', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const date = req.query.date || null;   // ★ これを追加

  const diaries = await Diary.find({ user: req.user._id }).select("_id date");

  // ★ YYYY-MM-DD → postId のマップ
  const diaryMap = {};
  const diaryDates = [];

  diaries.forEach(d => {
    if (!d.date) return;
    const dt = new Date(d.date);
    if (isNaN(dt)) return;

    const key = dt.toISOString().slice(0, 10); // "2026-01-14"
    diaryMap[key] = d._id.toString();
    diaryDates.push(key);
  });

 res.render('diary_my', {
  diaries,
  diaryDates,
  diaryMap,
  date,
  user: req.user,
  activeTab: "my"   // ★ 追加
});
});

// -------------------------
// reads（本棚トップ）
// -------------------------
app.get('/reads', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const books = await Shelf.find({ userId: req.user._id }).lean();

  // ★ 読書中の本
  const readingBooks = books.filter(b => b.isReading);

  // ★ 最近読んだ本（lastReadAt の新しい順に 3 冊）
  const recentBooks = books
    .filter(b => b.lastReadAt)                 // 読んだことがある本だけ
    .sort((a, b) => new Date(b.lastReadAt) - new Date(a.lastReadAt))
    .slice(0, 3);                               // 3 冊だけ

  res.render('reads', {
    user: req.user,
    books,
    readingBooks,
    recentBooks   // ★ 追加
  });
});

// -------------------------
// reads_shelf（本棚一覧ページ）
// -------------------------
app.get('/reads_shelf', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const books = await Shelf.find({ userId: req.user._id }).lean();

  res.render('reads_shelf', {
    user: req.user,
    books,
  });
});


// -------------------------
// 本追加
// -------------------------
app.post("/books/add", async (req, res) => {
  const { isbn } = req.body;

  const exists = await Shelf.findOne({ userId: req.user._id, isbn });
  if (exists) {
    return res.status(409).json({ error: "already_exists" });
  }

  const api = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&country=JP`
  );
  const data = await api.json();

  if (!data.items || data.items.length === 0) {
    return res.status(404).json({ error: "本が見つかりません" });
  }

  const book = data.items[0].volumeInfo;

  await Shelf.create({
    userId: req.user._id,
    title: book.title,
    authors: book.authors?.join(", ") || "",
    thumbnail: book.imageLinks?.thumbnail || "",
    isbn
  });

  res.json({ success: true });
});

// -------------------------
// 本のメモページ
// -------------------------
app.get('/shelf/:id', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const book = await Shelf.findOne({
    _id: req.params.id,
    userId: req.user._id
  }).lean();

  if (!book) return res.status(404).send("Not found");

  res.render('shelf_note', { user: req.user, book, query: req.query });
});

// -------------------------
// メモ保存
// -------------------------
app.post('/shelf/:id/save', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const { readingNote, review } = req.body;

  await Shelf.updateOne(
    { _id: req.params.id, userId: req.user._id },
    { readingNote, review }
  );

  res.redirect(`/shelf/${req.params.id}`);
});


// -------------------------
// 最終読書日を更新
// -------------------------
app.post("/shelf/:id/updateLastRead", async (req, res) => {
  if (!req.user) return res.sendStatus(401);

  await Shelf.updateOne(
    { _id: req.params.id, userId: req.user._id },
    { lastReadAt: new Date() }
  );

  res.sendStatus(200);
});


// -------------------------
// 読書時間を加算（今日の分 + 累計）
// -------------------------
app.post("/shelf/:id/addReadingTime", async (req, res) => {
  if (!req.user) return res.sendStatus(401);

  const { seconds } = req.body;

  const book = await Shelf.findOne({
    _id: req.params.id,
    userId: req.user._id
  });

  if (!book) return res.sendStatus(404);

  const now = new Date();
  const last = book.lastReadAt ? new Date(book.lastReadAt) : null;

  const isDifferentDay =
    !last ||
    now.getFullYear() !== last.getFullYear() ||
    now.getMonth() !== last.getMonth() ||
    now.getDate() !== last.getDate();

  if (isDifferentDay) {
    book.todayReadingSeconds = 0;
  }

  book.totalReadingSeconds = (book.totalReadingSeconds || 0) + seconds;
  book.todayReadingSeconds = (book.todayReadingSeconds || 0) + seconds;
  book.lastReadAt = now;

  await book.save();

  res.sendStatus(200);
});


// -------------------------
// 読書中フラグ（続きを読む用）
// -------------------------
app.post("/shelf/:id/setReadingState", async (req, res) => {
  if (!req.user) return res.sendStatus(401);

  const { isReading } = req.body;

  await Shelf.updateOne(
    { _id: req.params.id, userId: req.user._id },
    { isReading }
  );

  res.sendStatus(200);
});

// -------------------------
// 読了（読了本棚に移動）
// -------------------------
app.post("/shelf/:id/finish", async (req, res) => {
  if (!req.user) return res.sendStatus(401);

  await Shelf.updateOne(
    { _id: req.params.id, userId: req.user._id },
    {
      isReading: false,
      isFinished: true,
      finishedAt: new Date(),   // ★ 読了日を記録
      lastReadAt: new Date()
    }
  );

  res.sendStatus(200);
});

// -------------------------
// Logout / home
// -------------------------
app.get('/home', (req, res) => res.render('home'));

// -------------------------
// Start server
// -------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});