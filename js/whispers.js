import {WhisperStore, MAX_WHISPER_LENGTH, WHISPER_STORAGE_KEY} from './whisper-store.js';
import {createBackup, readBackup, MAX_BACKUP_BYTES} from './whisper-backup.js';

export function initWhispers(root) {
  let storage;
  try { storage = window.localStorage; } catch { /* 在禁用存储时仍允许本页记录。 */ }
  const store = new WhisperStore(storage);
  root.classList.add('whispers');
  root.innerHTML = `
    <p class="whispers-boundary">当前浏览器原型 · 未同步 · 未加密</p>
    <p class="whispers-explain">把没说出口的话，先放在这里。“留给自己”只是分类；使用同一浏览器的人可能看到保存的内容。</p>
    <div class="whispers-storage">
      <label class="whispers-check"><input id="whisperPersist" type="checkbox">在此浏览器保存（未加密）</label>
      <p id="whisperStorageHint"></p>
      <button class="whispers-text-button" id="whisperReload" type="button">重新读取</button>
    </div>
    <p id="whisperStatus" class="whispers-status" role="status" aria-live="polite"></p>
    <form id="whisperForm" class="whispers-form">
      <label for="whisperText" id="whisperFormLabel">写一条心里话</label>
      <textarea id="whisperText" name="text" rows="4" maxlength="1000" required placeholder="今天，有什么想悄悄记下的？" aria-describedby="whisperCounter"></textarea>
      <div class="whispers-form-meta"><span id="whisperCounter">0 / 1000</span><span>没有自动发送</span></div>
      <div class="whispers-form-actions">
        <label class="whispers-audience" for="whisperAudience">这句话
          <select id="whisperAudience" name="audience"><option value="personal">留给自己</option><option value="shared">想对你说（未发送）</option></select>
        </label>
        <div class="whispers-buttons"><button type="button" id="whisperCancel" hidden>取消编辑</button><button type="submit" id="whisperSubmit" class="whispers-primary">记在本页</button></div>
      </div>
    </form>
    <div class="whispers-list-head"><h3>留下的话 <span id="whisperCount">0</span></h3><label for="whisperFilter" class="whispers-filter-label">查看<select id="whisperFilter"><option value="all">全部</option><option value="personal">留给自己</option><option value="shared">想对你说</option></select></label></div>
    <div id="whisperList" class="whispers-list"></div>
    <details class="whispers-backup" id="whisperBackup">
      <summary>备份与换设备</summary>
      <p>导出全部已记录的心里话，包括“留给自己”和“想对你说”。文件未加密，请自己妥善保管；输入框里的草稿和首页设定不包含在内。</p>
      <div class="whispers-backup-actions"><button id="whisperExport" type="button">导出全部记录</button><button id="whisperChooseFile" type="button">选择备份文件</button></div>
      <input id="whisperImportFile" type="file" accept=".json,application/json" hidden>
      <p id="whisperBackupStatus" class="whispers-status"></p>
      <p class="whispers-backup-hint">换设备时，自己将文件带到另一台设备，在这里选择导入。仅在本页读取，不上传，也不会发给对方。</p>
      <section id="whisperImportPreview" class="whispers-import-preview" aria-labelledby="whisperImportTitle" tabindex="-1" hidden>
        <h4 id="whisperImportTitle">确认要带回来的话</h4>
        <p id="whisperImportInfo"></p><p id="whisperImportSummary" role="status"></p>
        <ul id="whisperImportSamples" aria-label="备份内容预览，最多三条"></ul>
        <p>只合并新记录；完全重复的跳过，同一条的不同版本两份都保留。现有记录不会被覆盖。</p>
        <div class="whispers-backup-actions"><button id="whisperImportConfirm" type="button" class="whispers-primary">确认合并</button><button id="whisperImportCancel" type="button">取消导入</button></div>
      </section>
    </details>
    <div class="whispers-return"><button id="whisperDone" type="button">回到星空</button><span>关闭面板后，草稿暂留本页</span></div>`;

  const find = id => root.querySelector(`#${id}`);
  const form = find('whisperForm');
  const input = find('whisperText');
  const audience = find('whisperAudience');
  const filter = find('whisperFilter');
  const persist = find('whisperPersist');
  const status = find('whisperStatus');
  let editingId = null;
  let editingOriginal = null;
  let pendingImport = null;
  let fileReadVersion = 0;

  function dirtyEditor() {
    return editingOriginal ? input.value !== editingOriginal.text || audience.value !== editingOriginal.audience : Boolean(input.value.trim());
  }

  function beforeLeave(event) {
    event.preventDefault();
    event.returnValue = true;
  }

  function updateLeaveGuard() {
    window.removeEventListener('beforeunload', beforeLeave);
    if (dirtyEditor() || (!store.persistent && store.notes.length)) window.addEventListener('beforeunload', beforeLeave);
  }

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('is-error', error);
    find('whisperBackupStatus').textContent = text;
    find('whisperBackupStatus').classList.toggle('is-error', error);
  }

  function resetEditor() {
    editingId = null;
    editingOriginal = null;
    form.reset();
    find('whisperFormLabel').textContent = '写一条心里话';
    find('whisperCancel').hidden = true;
    updateEditor();
  }

  function updateEditor() {
    find('whisperCounter').textContent = `${input.value.length} / ${MAX_WHISPER_LENGTH}`;
    find('whisperSubmit').textContent = editingId ? '保存修改' : (store.persistent ? '保存在此浏览器' : '记在本页');
    updateLeaveGuard();
  }

  function showImportSummary() {
    if (!pendingImport) return;
    const plan = store.previewImport(pendingImport.notes);
    find('whisperImportSummary').textContent = `将新增 ${plan.added} 条，跳过重复 ${plan.duplicates} 条，其中不同版本保留两份 ${plan.conflicts} 条。` +
      (store.persistent ? '确认后保存在当前浏览器。' : '确认后只留在本页，刷新会丢失；可自行勾选在此浏览器保存。');
    find('whisperImportConfirm').disabled = plan.added === 0;
  }

  function render() {
    persist.checked = store.persistent;
    find('whisperStorageHint').textContent = store.persistent ?
      '本机副本已开启；清除浏览器数据会丢失。不会传给对方。' :
      '默认只留在当前页面；刷新或关闭后会丢失。勾选后才保存本机副本。';
    updateEditor();
    const notes = store.notes;
    find('whisperExport').disabled = notes.length === 0;
    if (pendingImport) {
      try { showImportSummary(); }
      catch (error) { find('whisperImportSummary').textContent = error.message; find('whisperImportConfirm').disabled = true; }
    }
    const visible = notes.filter(note => filter.value === 'all' || note.audience === filter.value);
    find('whisperCount').textContent = filter.value === 'all' ? `${notes.length}` : `${visible.length} / ${notes.length}`;
    const list = find('whisperList');
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'whispers-empty';
      empty.textContent = notes.length ? '这一类还没有留下的话。' : '还没有心里话。慢慢写，不着急。';
      list.append(empty);
    }
    for (const note of visible) {
      const article = document.createElement('article');
      article.className = 'whispers-note';
      const meta = document.createElement('div');
      meta.className = 'whispers-note-meta';
      const badge = document.createElement('span');
      badge.textContent = note.audience === 'shared' ? '想对你说 · 未发送' : '留给自己 · 本地记录';
      const time = document.createElement('time');
      time.dateTime = note.updatedAt;
      time.textContent = new Intl.DateTimeFormat('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}).format(new Date(note.updatedAt));
      meta.append(badge, time);
      const text = document.createElement('p');
      text.className = 'whispers-note-text';
      text.textContent = note.text;
      const actions = document.createElement('div');
      actions.className = 'whispers-note-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = '编辑';
      edit.setAttribute('aria-label', '编辑这条心里话');
      edit.addEventListener('click', () => {
        if (editingId === note.id) { input.focus(); return; }
        if (dirtyEditor() && !window.confirm('编辑另一条会替换输入框里尚未保存的文字，继续吗？')) return;
        editingId = note.id;
        editingOriginal = {text: note.text, audience: note.audience};
        input.value = note.text;
        audience.value = note.audience;
        find('whisperFormLabel').textContent = '修改这条心里话';
        find('whisperCancel').hidden = false;
        updateEditor();
        input.focus();
        input.scrollIntoView({block: 'nearest'});
        message('正在编辑，保存后才会替换原内容。');
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', '删除这条心里话');
      remove.addEventListener('click', () => {
        if (!window.confirm('删除这条心里话？删除后无法在心网中恢复。')) return;
        try {
          store.remove(note.id);
          if (editingId === note.id) resetEditor();
          render();
          message(store.persistent ? '已从当前浏览器的心里话副本中删除。' : '已从本页删除。');
        } catch (error) { message(error.message, true); }
      });
      actions.append(edit, remove);
      article.append(meta, text, actions);
      list.append(article);
    }
  }

  input.addEventListener('input', updateEditor);
  audience.addEventListener('change', updateEditor);
  filter.addEventListener('change', render);
  find('whisperCancel').addEventListener('click', () => {
    if (dirtyEditor() && !window.confirm('放弃这次尚未保存的修改？原来的心里话会保留。')) return;
    resetEditor();
    message('已取消编辑，原来的内容没有改变。');
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const shared = audience.value === 'shared';
      if (editingId) store.update(editingId, input.value, audience.value);
      else store.add(input.value, audience.value);
      resetEditor();
      render();
      message((store.persistent ? '已保存在当前浏览器，未加密。' : '已记在本页，刷新或关闭后会丢失。') + (shared ? '尚未发送给对方。' : ''));
    } catch (error) { message(error.message, true); }
  });
  persist.addEventListener('change', () => {
    try {
      store.setPersistent(persist.checked);
      message(store.persistent ? '已保存本机副本。同一浏览器使用者可能查看这些未加密内容。' : '已移除本机副本，现有内容暂留本页；刷新或关闭后会丢失。');
    } catch (error) { message(error.message, true); }
    render();
  });
  find('whisperReload').addEventListener('click', () => {
    if (!window.confirm('重新读取会替换本页记录并清空输入框。请先复制尚未保存在浏览器的文字。继续吗？')) return;
    try {
      store.reload();
      resetEditor();
      render();
      message(store.persistent ? '已重新读取当前浏览器的副本。' : '当前浏览器没有保存的副本，已回到空白页面记录。');
    } catch (error) { message(error.message, true); }
  });
  find('whisperExport').addEventListener('click', () => {
    let url;
    try {
      const notes = store.notes;
      if (!notes.length) return;
      url = URL.createObjectURL(new Blob([createBackup(notes)], {type: 'application/json;charset=utf-8'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = `心网-心里话-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      message(`已发起 ${notes.length} 条记录的备份下载，请确认浏览器已保存文件。备份未加密，草稿不包含在内。`);
    } catch { message('无法生成备份，现有记录没有改变。请先复制文字保留。', true); }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 30000); }
  });

  function clearImport() {
    fileReadVersion++;
    pendingImport = null;
    find('whisperImportPreview').hidden = true;
    find('whisperImportFile').value = '';
  }

  find('whisperChooseFile').addEventListener('click', () => find('whisperImportFile').click());
  find('whisperDone').addEventListener('click', () => root.closest('dialog')?.close());
  find('whisperImportFile').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    clearImport();
    const version = fileReadVersion;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 2 MB。本次没有导入。');
      const contents = await file.text();
      if (version !== fileReadVersion) return;
      const backup = readBackup(contents);
      store.previewImport(backup.notes);
      pendingImport = backup;
      const personal = backup.notes.filter(note => note.audience === 'personal').length;
      find('whisperImportInfo').textContent = `${file.name} · 共 ${backup.notes.length} 条：留给自己 ${personal} 条，想对你说 ${backup.notes.length - personal} 条。`;
      const samples = find('whisperImportSamples');
      samples.replaceChildren();
      for (const note of backup.notes.slice(0, 3)) {
        const sample = document.createElement('li');
        sample.textContent = note.text.length > 100 ? note.text.slice(0, 100) + '…' : note.text;
        samples.append(sample);
      }
      showImportSummary();
      find('whisperImportPreview').hidden = false;
      find('whisperImportPreview').focus();
      message('已读取备份预览。确认合并前，现有记录不会改变。');
    } catch (error) {
      if (version !== fileReadVersion) return;
      clearImport();
      message(error.message || '无法读取这个文件，现有记录没有改变。', true);
    }
  });
  find('whisperImportConfirm').addEventListener('click', () => {
    if (!pendingImport) return;
    try {
      const result = store.importNotes(pendingImport.notes);
      clearImport();
      render();
      message(`已合并 ${result.added} 条，跳过重复 ${result.duplicates} 条。` +
        (store.persistent ? '已保存到当前浏览器，未加密。' : '暂留本页，刷新或关闭后会丢失。') + '输入框里的草稿仍保留。');
      find('whisperChooseFile').focus();
    } catch (error) { message(error.message, true); }
  });
  find('whisperImportCancel').addEventListener('click', () => {
    clearImport();
    message('已取消导入，现有记录和草稿没有改变。');
    find('whisperChooseFile').focus();
  });
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === WHISPER_STORAGE_KEY) {
      message('另一页面可能修改了心里话副本。本页未自动替换，请先保留正在输入的文字，再重新读取。', true);
    }
  });
  render();
  if (store.storageIssue) message(store.storageIssue.message, true);
  return store;
}
