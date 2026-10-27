export function initMusic() {
  const music = document.getElementById('music');
  const button = document.getElementById('musicButton');
  const state = document.getElementById('musicState');
  let musicRequested = false;
  function update(playing, text) {
    button.classList.toggle('is-playing', playing);
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute('aria-label', playing ? '暂停《偏爱》' : '播放《偏爱》');
    document.getElementById('musicIcon').textContent = playing ? 'Ⅱ' : '▶';
    state.textContent = text;
  }
  function play() {
    if (music.error) music.load();
    music.play().catch(error => {
      if (error.name !== 'AbortError') update(false, '暂时无法播放，点击重试');
    });
  }
  music.addEventListener('play', () => update(true, '正在缓冲'));
  music.addEventListener('playing', () => update(true, '播放中 · 点击暂停'));
  music.addEventListener('pause', () => update(false, '已暂停 · 点击播放'));
  music.addEventListener('waiting', () => update(!music.paused, '正在缓冲'));
  music.addEventListener('error', () => update(false, '音乐未能加载，点击重试'));
  button.addEventListener('click', () => {
    musicRequested = true;
    if (music.paused) play(); else music.pause();
  });
  return {
    onHeart() { if (!musicRequested) { musicRequested = true; play(); } },
    setVolume(volume) { music.volume = volume / 100; }
  };
}
