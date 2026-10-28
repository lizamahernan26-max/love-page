import {OnlineApi} from './online-api.js';
import {createBackup, readBackup, MAX_BACKUP_BYTES} from './whisper-backup.js';

const byId = id => document.getElementById(id);
const dateText = value => new Intl.DateTimeFormat('zh-CN', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}).format(new Date(value));
const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');

export function initOnlineSpace({initLocal, onProfile}) {
  const api = new OnlineApi();
  const entry = new URLSearchParams(location.hash.slice(1));
  let deviceCode = entry.get('enter');
  let setupCode = entry.get('setup');
  if (entry.has('enter') || entry.has('setup')) history.replaceState(null, '', location.pathname + location.search);
  let editing = null, pendingId = null, pendingImport = null, signature = '', profileSignature = '';
  let refreshing = false, busy = false;
  let fileVersion = 0;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('xinwang-session') : null;
  const controller = {api, get enabled() {return api.enabled;}, get user() {return api.user;}, get couple() {return api.couple;},
    saveProfile: value => api.saveProfile(value)};

  function message(text, error = false, id = 'onlineStatus') {
    const node = byId(id); node.textContent = text; node.classList.toggle('is-error', error);
  }
  function dirty() {
    if (!byId('onlineText')) return false;
    return editing ? byId('onlineText').value !== editing.text || byId('onlineAudience').value !== editing.audience : Boolean(byId('onlineText').value.trim());
  }
  function beforeLeave(event) {event.preventDefault(); event.returnValue = true;}
  function updateEditor() {
    byId('onlineCounter').textContent = `${byId('onlineText').value.length} / 1000`;
    byId('onlineSubmit').textContent = editing ? '保存修改' : byId('onlineAudience').value === 'shared' ? '发布给两人' : '保存为仅本人可见';
    byId('onlineCancel').hidden = !editing;
    window.removeEventListener('beforeunload', beforeLeave);
    if (dirty()) window.addEventListener('beforeunload', beforeLeave);
  }
  function resetEditor() {
    editing = null; pendingId = null;
    byId('onlineForm').reset(); byId('onlineFormLabel').textContent = '写下此刻的心里话'; updateEditor();
  }
  function renderAccount() {
    const signed = Boolean(api.user);
    if (api.user?.passwordless && deviceCode) deviceCode = null;
    byId('onlineSignedOut').hidden = signed || Boolean(deviceCode);
    byId('onlineSignedIn').hidden = !signed;
    byId('onlineDeviceEntry').hidden = !deviceCode;
    byId('onlineDeviceEnter').disabled = signed;
    byId('onlinePasswordSection').hidden = Boolean(api.user?.passwordless);
    byId('onlineDeviceHint').hidden = !api.user?.passwordless;
    byId('onlineSessionDuration').textContent = api.user?.passwordless ? '这部手机会自动识别你的身份。活跃使用时续期，连续 90 天未使用需用恢复码进入；退出、清除网站数据或更换浏览器也需要恢复码。' : '登录状态最长保留 14 天。退出后本页记录和草稿会清空。';
    byId('onlineLoginGate').hidden = signed;
    byId('onlineMemberContent').hidden = !signed;
    byId('onlineTag').textContent = signed ? '已登录' : '双人';
    byId('onlineAccountState').textContent = signed ? api.user.passwordless ? `欢迎回来，${api.user.displayName} · 这部手机已识别你的身份` : `当前账号：${api.user.displayName}（${api.user.username}）` : deviceCode ? '这是属于你的专属入口，无需注册或输入密码。' : '首页可直接使用。收到专属邀请链接后，可免输账号密码进入心里话。';
    byId('onlineRegisterToggle').hidden = !api.setupRequired && !api.slotsAvailable;
    byId('onlineRegisterTitle').textContent = api.setupRequired ? '创建第一个账号' : '使用邀请码创建第二个账号';
    if (api.setupRequired) {byId('onlineRegisterForm').hidden = false; byId('onlineLoginForm').hidden = true;}
    byId('onlineRegisterToggle').textContent = byId('onlineRegisterForm').hidden ? '创建账号／使用邀请码' : '已有账号，去登录';
    byId('onlineInviteField').hidden = api.setupRequired;
    byId('onlineRegisterInvite').required = !api.setupRequired;
    byId('onlineSetupField').hidden = !api.setupKeyRequired;
    byId('onlineSetupKey').required = Boolean(api.setupKeyRequired);
    byId('onlineUnpaired').hidden = !signed || Boolean(api.couple);
    byId('onlinePaired').hidden = !signed || !api.couple || api.user?.passwordless;
    byId('onlinePairState').textContent = api.couple ? `已与 ${api.couple.partner.displayName} 绑定。共享记录会出现在两人的设备上。` : '还未绑定。仅本人可见的记录已经可以使用。';
    byId('onlineSharedOption').disabled = !api.couple;
    if (!api.couple && !editing) byId('onlineAudience').value = 'personal';
    byId('onlineSessionHint').textContent = api.user ? `正在使用 ${api.user.displayName} 的空间 · ${api.couple ? '已绑定' : '未绑定'}` : '';
    byId('onlineBoundary').textContent = api.transport === 'https' ? '后端权限隔离 · HTTPS 传输 · 尚未端到端加密' : '本机开发测试 · HTTP 未加密 · 真实使用需部署 HTTPS';
    syncProfile(); renderNotes(); updateEditor();
  }
  function syncProfile() {
    const profile = api.couple?.profile || null;
    const key = JSON.stringify([api.user?.id, profile]);
    if (key === profileSignature) return;
    profileSignature = key;
    onProfile(profile);
    byId('settingsScope').textContent = api.couple ? '姓名与纪念日同步到两人的设备；音乐音量只影响本设备。' : '双人版需要先登录并绑定，才能保存共同姓名与纪念日。';
  }
  function renderNotes() {
    const filter = byId('onlineFilter').value;
    const visible = api.notes.filter(note => filter === 'all' || note.audience === filter);
    byId('onlineCount').textContent = `${visible.length}`;
    byId('onlineExport').disabled = !api.notes.some(note => note.own);
    const nextSignature = JSON.stringify([api.user?.id, filter, visible]);
    if (nextSignature === signature) return;
    signature = nextSignature;
    const list = byId('onlineList'); list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p'); empty.className = 'whispers-empty';
      empty.textContent = '这里还没有记录。只写下你愿意留下的话。'; list.append(empty);
    }
    for (const note of visible) {
      const article = document.createElement('article'); article.className = 'whispers-note'; article.dataset.noteId = note.id;
      const meta = document.createElement('div'); meta.className = 'whispers-note-meta';
      const label = document.createElement('span');
      label.textContent = `${note.authorName} · ` + (note.audience === 'personal' ? '仅本人可见' : note.sharedWithPartner ? '两人共享' : '往期共享 · 现仅本人可见');
      const time = document.createElement('time'); time.dateTime = note.updatedAt; time.textContent = dateText(note.updatedAt);
      meta.append(label, time);
      const text = document.createElement('p'); text.className = 'whispers-note-text'; text.textContent = note.text;
      article.append(meta, text);
      if (note.own) {
        const actions = document.createElement('div'); actions.className = 'whispers-note-actions';
        const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '编辑'; edit.setAttribute('aria-label','编辑自己的心里话');
        edit.addEventListener('click', () => {
          if (busy) return;
          if (editing?.id === note.id) {byId('onlineText').focus(); return;}
          if (dirty() && !confirm('切换编辑会替换尚未保存的草稿，继续吗？')) return;
          editing = {...note, pairId: api.couple?.id}; pendingId = null;
          byId('onlineText').value = note.text; byId('onlineAudience').value = note.audience;
          byId('onlineFormLabel').textContent = '修改自己的心里话'; updateEditor(); byId('onlineText').focus();
        });
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.setAttribute('aria-label','删除自己的心里话');
        remove.addEventListener('click', () => act(async () => {
          if (!confirm('删除这条心里话？服务器删除后无法在心网中恢复。')) return;
          await api.request(`notes/${note.id}`, 'DELETE', {version: note.version});
          if (editing?.id === note.id) resetEditor();
          await refreshAfter('这条记录已从服务器删除。');
        }));
        actions.append(edit, remove); article.append(actions);
      }
      list.append(article);
    }
  }
  async function act(action, statusId = 'onlineStatus') {
    if (busy) return;
    busy = true;
    byId('onlineText').readOnly = true; byId('onlineAudience').disabled = true;
    document.querySelectorAll('[data-online-mutation]').forEach(button => {button.disabled = true;});
    try {await action();}
    catch (error) {message(error.message, true, statusId);}
    finally {busy = false; byId('onlineText').readOnly = false; byId('onlineAudience').disabled = false; document.querySelectorAll('[data-online-mutation]').forEach(button => {button.disabled = false;});}
  }
  async function refresh() {
    if (refreshing || !api.user) return;
    refreshing = true;
    try {
      await api.refreshNotes(); byId('onlineSync').textContent = `刚刚同步 · ${dateText(Date.now())}`;
    } catch (error) {byId('onlineSync').textContent = error.message; throw error;}
    finally {refreshing = false;}
  }
  async function refreshAfter(text) {
    try {await refresh(); message(text);}
    catch {message(text + '列表暂时无法刷新，请稍后点“立即同步”。');}
  }
  function authChanged() {channel?.postMessage('changed');}

  controller.ready = (async () => {
    let info;
    try { info = await api.request('status'); }
    catch {
      byId('onlineTag').textContent = '未连接';
      byId('whisperContent').hidden = false;
      byId('whisperContent').textContent = location.hostname.endsWith('.github.io') ? '此地址目前只展示星空页面，双人服务尚未连接，不能保存或同步心里话。请使用完成部署后的正式双人网址；此页面不会读取旧私密记录。' : '暂时无法确认服务，尚未读取任何记录。请启动心网双人版后刷新；原有本地数据没有改变。';
      return;
    }
    if (!info.online) {byId('whisperContent').hidden = false; initLocal(); return;}
    api.enabled = true; api.transport = info.transport;
    document.querySelector('.page').classList.add('has-online-space');
    byId('onlineEntry').hidden = false;
    byId('onlineWhisperContent').hidden = false;
    byId('onlineWhisperContent').innerHTML = `
      <p id="onlineBoundary" class="whispers-boundary"></p>
      <p class="whispers-explain">“仅本人可见”由服务器按作者账号限制读取。两人共享内容在绑定后可见；只有作者能修改和删除。服务器维护者仍有数据库访问能力。</p>
      <div id="onlineLoginGate" class="online-login-gate"><p>登录后，才会读取你自己的记录。</p><button type="button" id="onlineGoAccount">登录／创建账号</button></div>
      <div id="onlineMemberContent" hidden>
        <p id="onlineSessionHint" class="online-session-hint"></p>
        <div class="online-sync"><span id="onlineSync">连接中…</span><button type="button" id="onlineRefresh">立即同步</button></div>
        <p id="onlineStatus" class="whispers-status" role="status"></p>
        <form id="onlineForm" class="whispers-form">
          <label id="onlineFormLabel" for="onlineText">写下此刻的心里话</label>
          <textarea id="onlineText" rows="4" maxlength="1000" required placeholder="先想好，这句话想留给谁。" aria-describedby="onlineCounter"></textarea>
          <div class="whispers-form-meta"><span id="onlineCounter">0 / 1000</span><span>保存成功后才进入服务器</span></div>
          <div class="whispers-form-actions"><label class="whispers-audience" for="onlineAudience">可见范围<select id="onlineAudience"><option value="personal">仅本人可见</option><option id="onlineSharedOption" value="shared">两人共享</option></select></label><div class="whispers-buttons"><button type="button" id="onlineCancel" hidden>取消编辑</button><button type="submit" id="onlineSubmit" class="whispers-primary" data-online-mutation>保存为仅本人可见</button></div></div>
        </form>
        <div class="whispers-list-head"><h3>留下的话 <span id="onlineCount">0</span></h3><label class="whispers-filter-label" for="onlineFilter">查看<select id="onlineFilter"><option value="all">全部可见</option><option value="personal">仅本人可见</option><option value="shared">共享记录</option></select></label></div>
        <div id="onlineList" class="whispers-list"></div>
        <details class="whispers-backup"><summary>备份与迁移旧记录</summary><p>导出只包含你自己写的记录，文件未加密。旧备份导入时，全部先存成“仅本人可见”，不会自动发布给对方。旧版本留在浏览器中的副本不受账号隔离保护，请自行备份和整理。</p>
          <div class="whispers-backup-actions"><button type="button" id="onlineExport">导出我的记录</button><button type="button" id="onlineChooseBackup">选择旧备份</button></div>
          <input id="onlineBackupFile" type="file" accept=".json,application/json" hidden>
          <section id="onlineImportPreview" class="whispers-import-preview" hidden><h4>导入前确认</h4><p id="onlineImportInfo"></p><ul id="onlineImportSamples"></ul><p>确认后文件内容才会发送到当前服务器。所有内容归当前账号，仅本人可见。</p><div class="whispers-backup-actions"><button type="button" id="onlineImportConfirm" data-online-mutation>全部作为私密记录导入</button><button type="button" id="onlineImportCancel">取消</button></div></section>
        </details>
      </div>
      <div class="whispers-return"><button type="button" id="onlineDone">回到星空</button><span>草稿只暂留本页</span></div>`;
    api.addEventListener('change', renderAccount);
    api.addEventListener('notes', renderNotes);
    api.addEventListener('profile', () => {renderAccount();});
    api.addEventListener('identitychange', () => {
      resetEditor(); pendingImport = null; byId('onlineImportPreview').hidden = true;
      fileVersion++;
      byId('onlineInviteResult').hidden = true; byId('onlineInviteCode').value = '';
      byId('onlineQuickResult').hidden = true; byId('onlineQuickLink').value = '';
      byId('onlineRecoveryResult').hidden = true; byId('onlineRecoveryCode').value = '';
      byId('onlineImportInfo').textContent = ''; byId('onlineImportSamples').replaceChildren();
      byId('onlineJoinCode').value = ''; byId('onlineRegisterInvite').value = ''; byId('onlineSetupKey').value = '';
      byId('onlineList').replaceChildren(); signature = ''; message('');
      byId('onlineRegisterForm').hidden = true; byId('onlineLoginForm').hidden = false;
      byId('onlineAccountStatus').textContent = '';
      byId('accountDialog').querySelectorAll('input[type=password]').forEach(input => {input.value = '';});
    });
    api.addEventListener('sessionchange', () => {api.loadSession().catch(() => {});});
    byId('onlineDone').addEventListener('click', () => byId('whispersDialog').close());
    byId('onlineGoAccount').addEventListener('click', () => {byId('whispersDialog').close(); byId('accountDialog').showModal();});
    byId('onlineRefresh').addEventListener('click', () => {refresh().catch(error => message(error.message, true));});
    byId('onlineFilter').addEventListener('change', renderNotes);
    byId('onlineText').addEventListener('input', () => {pendingId = null; updateEditor();});
    byId('onlineAudience').addEventListener('change', () => {pendingId = null; updateEditor();});
    byId('onlineCancel').addEventListener('click', () => {if (!dirty() || confirm('放弃这次尚未保存的修改？')) resetEditor();});
    byId('onlineForm').addEventListener('submit', event => {
      event.preventDefault();
      act(async () => {
        const text = byId('onlineText').value, audience = byId('onlineAudience').value;
        if (editing && audience === 'shared' && (editing.audience === 'personal' || editing.pairId !== api.couple?.id || !editing.sharedWithPartner) && !confirm('这会把内容发布给当前绑定的对方，确定吗？')) return;
        const scope = audience === 'shared' ? {expectedCoupleId: api.couple?.id} : {};
        if (editing) await api.request(`notes/${editing.id}`, 'PATCH', {text, audience, version: editing.version, ...scope});
        else {pendingId ||= requestId(); await api.request('notes', 'POST', {text, audience, requestId: pendingId, ...scope});}
        resetEditor();
        await refreshAfter(audience === 'personal' ? '已保存在服务器，仅你的账号可读取。' : '已发布到两人共享空间；对方联网后会同步。');
      });
    });
    byId('onlineRegisterToggle').addEventListener('click', () => {
      byId('onlineRegisterForm').hidden = !byId('onlineRegisterForm').hidden;
      byId('onlineLoginForm').hidden = !byId('onlineRegisterForm').hidden;
      byId('onlineRegisterToggle').textContent = byId('onlineRegisterForm').hidden ? '创建账号／使用邀请码' : '已有账号，去登录';
    });
    for (const [formId, action] of [['onlineLoginForm','login'],['onlineRegisterForm','register']]) {
      byId(formId).addEventListener('submit', event => {
        event.preventDefault();
        act(async () => {
          const form = byId(formId), values = Object.fromEntries(new FormData(form));
          if (action === 'register' && values.password !== values.passwordAgain) throw new Error('两次密码不一致。');
          delete values.passwordAgain;
          if (action === 'register') {if (api.setupRequired) delete values.inviteCode; if (!api.setupKeyRequired) delete values.setupKey;}
          await api.authenticate(action, values);
          setupCode = null;
          form.querySelectorAll('input[type=password]').forEach(input => {input.value = '';});
          byId('onlineRegisterInvite').value = ''; byId('onlineSetupKey').value = '';
          authChanged(); await refresh(); message('已进入自己的账号。', false, 'onlineAccountStatus');
        }, 'onlineAccountStatus');
      });
    }
    byId('onlineLogout').addEventListener('click', () => act(async () => {
      if (dirty() && !confirm('退出会清空当前未保存的草稿，确定退出吗？')) return;
      await api.request('auth/logout', 'POST', {}); api.clear(); authChanged(); await api.loadSession();
      message('已退出，当前页面的账号记录与草稿已清空。', false, 'onlineAccountStatus');
    }, 'onlineAccountStatus'));
    byId('onlineCreateInvite').addEventListener('click', () => act(async () => {
      const result = await api.request('couple/invite', 'POST', {});
      byId('onlineInviteCode').value = result.code; byId('onlineInviteResult').hidden = false;
      byId('onlineInviteExpiry').textContent = `24 小时内有效 · ${dateText(result.expiresAt)} 到期。再次生成会使旧码失效。`;
    }, 'onlineAccountStatus'));
    byId('onlineQuickInvite').addEventListener('click', () => act(async () => {
      const result = await api.request('couple/invite', 'POST', {});
      byId('onlineQuickLink').value = `${location.origin}/#enter=${result.code}`;
      byId('onlineQuickResult').hidden = false;
      message('专属链接已生成，24 小时有效且仅能使用一次。请私下发给她；重新生成会使旧邀请失效。', false, 'onlineAccountStatus');
    }, 'onlineAccountStatus'));
    async function enterDevice(action, code) {
      const session = await api.authenticate(action, {code});
      deviceCode = null;
      byId('onlineDeviceEntry').hidden = true;
      byId('onlineRecoveryInput').value = '';
      byId('onlineRecoveryCode').value = session.recoveryCode;
      byId('onlineRecoveryResult').hidden = false;
      authChanged(); await refresh();
      message('已经进入你的空间。请先保存下方恢复码，再去写心里话；它只在本次进入后显示。', false, 'onlineAccountStatus');
    }
    byId('onlineDeviceEnter').addEventListener('click', () => act(() => enterDevice('device-enter',deviceCode), 'onlineAccountStatus'));
    byId('onlineRecoveryForm').addEventListener('submit', event => {
      event.preventDefault(); act(() => enterDevice('device-recover',byId('onlineRecoveryInput').value.trim()), 'onlineAccountStatus');
    });
    byId('onlineRecoveryHide').addEventListener('click', () => {
      if (!confirm('请确认已经单独保存恢复码。收起后，本页不会再次显示；换手机或退出后需要它恢复身份。')) return;
      byId('onlineRecoveryCode').value = ''; byId('onlineRecoveryResult').hidden = true;
    });
    byId('onlineRecoveryRenew').addEventListener('click', () => act(async () => {
      if (!confirm('生成新恢复码后，旧码立即失效。请在本次生成后单独保存新码。')) return;
      const result = await api.request('auth/device-backup', 'POST', {});
      byId('onlineRecoveryCode').value = result.recoveryCode; byId('onlineRecoveryResult').hidden = false;
      message('请保存新恢复码。旧码已失效。', false, 'onlineAccountStatus');
    }, 'onlineAccountStatus'));
    byId('onlineJoinForm').addEventListener('submit', event => {
      event.preventDefault(); act(async () => {
        await api.request('couple/join', 'POST', {code: byId('onlineJoinCode').value.trim()});
        byId('onlineJoinCode').value = ''; await api.loadSession(); await refresh(); message('已完成双人绑定。', false, 'onlineAccountStatus');
      }, 'onlineAccountStatus');
    });
    byId('onlineLeaveForm').addEventListener('submit', event => {
      event.preventDefault(); act(async () => {
        if (!confirm('解除后双方各自保留自己写的记录，对方不再能读取共享内容。确定解除吗？')) return;
        await api.request('couple/leave', 'POST', {password: byId('onlineLeavePassword').value, coupleId: api.couple?.id});
        byId('onlineLeavePassword').value = ''; await api.loadSession(); await refresh(); message('已解除绑定，自己写的记录仍保留。', false, 'onlineAccountStatus');
      }, 'onlineAccountStatus');
    });
    byId('onlinePasswordForm').addEventListener('submit', event => {
      event.preventDefault(); act(async () => {
        const values = Object.fromEntries(new FormData(byId('onlinePasswordForm')));
        if (values.newPassword !== values.passwordAgain) throw new Error('两次新密码不一致。');
        delete values.passwordAgain;
        const result = await api.request('auth/password', 'POST', values);
        api.csrf = result.csrfToken; byId('onlinePasswordForm').reset(); authChanged();
        message('密码已修改，其他设备的旧会话已退出。', false, 'onlineAccountStatus');
      }, 'onlineAccountStatus');
    });
    byId('onlineExport').addEventListener('click', () => {
      const raw = createBackup(api.notes.filter(note => note.own));
      const url = URL.createObjectURL(new Blob([raw], {type:'application/json;charset=utf-8'}));
      const link = document.createElement('a'); link.href = url; link.download = `心网-我的记录-${new Date().toISOString().slice(0,10)}.json`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      message('已发起自己所写记录的备份下载，文件未加密，请妥善保管。');
    });
    byId('onlineChooseBackup').addEventListener('click', () => byId('onlineBackupFile').click());
    byId('onlineBackupFile').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      pendingImport = null; byId('onlineImportPreview').hidden = true;
      const version = ++fileVersion;
      const owner = api.user?.id;
      try {
        if (file.size > MAX_BACKUP_BYTES) throw new Error('备份最大为 2 MB。');
        const backup = readBackup(await file.text());
        if (owner !== api.user?.id || version !== fileVersion) return;
        pendingImport = backup.notes;
        byId('onlineImportInfo').textContent = `${file.name} · 共 ${backup.notes.length} 条，全部先作为仅本人可见导入。重复导入会跳过。`;
        byId('onlineImportSamples').replaceChildren();
        for (const note of backup.notes.slice(0,3)) {const item = document.createElement('li'); item.textContent = note.text.slice(0,100); byId('onlineImportSamples').append(item);}
        byId('onlineImportPreview').hidden = false;
      } catch (error) {if (owner === api.user?.id && version === fileVersion) message(error.message, true);}
      finally {event.target.value = '';}
    });
    byId('onlineImportCancel').addEventListener('click', () => {fileVersion++; pendingImport = null; byId('onlineImportPreview').hidden = true;});
    byId('onlineImportConfirm').addEventListener('click', () => act(async () => {
      if (!pendingImport) return;
      const result = await api.request('notes/import', 'POST', {notes: pendingImport});
      pendingImport = null; byId('onlineImportPreview').hidden = true;
      await refreshAfter(`已导入 ${result.added} 条私密记录，跳过 ${result.duplicates} 条重复记录。草稿仍保留。`);
    }));
    async function resume() {
      if (document.hidden) return;
      byId('onlineMemberContent').hidden = true;
      try {await api.loadSession(); await refresh();}
      catch (error) {byId('onlineSync').textContent = error.message;}
    }
    channel?.addEventListener('message', () => {api.clear(); resume();});
    window.addEventListener('focus', resume); window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    setInterval(() => {if (!document.hidden && api.user) refresh().catch(() => {});}, 5000);
    byId('whispersDialog').addEventListener('toggle', () => {if (byId('whispersDialog').open) refresh().catch(() => {});});
    await api.loadSession(); renderAccount(); await refresh();
    if (deviceCode && !byId('accountDialog').open) byId('accountDialog').showModal();
    if (setupCode && api.setupRequired && !api.user) {
      byId('onlineSetupKey').value = setupCode; setupCode = null;
      if (!byId('accountDialog').open) byId('accountDialog').showModal();
    }
  })().catch(error => {
    if (api.enabled && byId('onlineStatus')) message(error.message, true);
  });
  return controller;
}
