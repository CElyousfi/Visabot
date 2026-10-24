chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'offscreenPlay') { const a = document.getElementById('a'); a.currentTime = 0; a.play().catch(() => {}); }
});
