chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'offscreenPlay') return false;
  const a = document.getElementById('a');
  a.currentTime = 0;
  a.play().then(() => reply({ played: true }), (e) => reply({ played: false, error: String(e) }));
  return true;
});
