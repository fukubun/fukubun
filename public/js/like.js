console.log("like.js loaded");

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".like-btn");
  if (!btn) return;

  const postId = btn.dataset.id;

  const res = await fetch(`/like/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  const data = await res.json();

  // アイコン切り替え
  btn.innerHTML = data.html;
});