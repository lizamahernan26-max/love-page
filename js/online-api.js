export class OnlineApi extends EventTarget {
  constructor() {
    super();
    this.enabled = false;
    this.user = null;
    this.couple = null;
    this.csrf = null;
    this.notes = [];
    this.transport = null;
    this.sessionEpoch = 0;
  }
  changed(name = 'change') { this.dispatchEvent(new Event(name)); }
  clear() { this.sessionEpoch++; this.user = null; this.couple = null; this.csrf = null; this.notes = []; this.setupRequired = false; this.slotsAvailable = false; this.changed('identitychange'); this.changed(); }
  async request(path, method = 'GET', body, {checkIdentity = true} = {}) {
    const expectedUser = this.user?.id;
    const headers = method === 'GET' ? {} : {'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf || ''};
    let response;
    try {
      response = await fetch(`/api/${path}`, {method, headers, credentials: 'same-origin', cache: 'no-store',
        ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(12000)});
    } catch { throw new Error('暂时连不上服务器。请保留尚未提交的内容，联网后重试。'); }
    let value;
    try {value = await response.json();}
    catch {if (response.status === 401) this.clear(); throw new Error('服务器返回异常，请保留草稿后稍后重试。');}
    const responseUser = response.headers.get('X-Xinwang-User');
    if (checkIdentity && expectedUser && this.user?.id !== expectedUser) throw new Error('账号已切换，上一会话的结果未应用到当前页面。');
    if (checkIdentity && responseUser && responseUser !== expectedUser) {
      this.clear(); this.changed('sessionchange');
      throw new Error('当前浏览器账号已切换，请重新确认自己的账号。');
    }
    if (!response.ok) {
      if (response.status === 401 && path !== 'auth/login' && path !== 'couple/leave' && path !== 'auth/password') this.clear();
      const error = new Error(value.error?.message || '操作暂未完成，请稍后重试。');
      error.code = value.error?.code;
      throw error;
    }
    return value;
  }
  async loadSession() {
    const epoch = ++this.sessionEpoch;
    const session = await this.request('session', 'GET', undefined, {checkIdentity: false});
    if (epoch !== this.sessionEpoch) return session;
    const previous = this.user?.id;
    this.user = session.user || null;
    this.couple = session.couple || null;
    this.csrf = session.csrfToken || null;
    this.setupRequired = session.setupRequired || false;
    this.setupKeyRequired = session.setupKeyRequired || false;
    this.slotsAvailable = session.slotsAvailable || false;
    if (previous !== this.user?.id) { this.notes = []; this.changed('identitychange'); }
    this.changed();
    return session;
  }
  async authenticate(action, body) {
    this.sessionEpoch++;
    const session = await this.request(`auth/${action}`, 'POST', body, {checkIdentity: false});
    this.sessionEpoch++;
    this.notes = []; this.user = session.user; this.couple = session.couple; this.csrf = session.csrfToken;
    this.setupRequired = false; this.slotsAvailable = false;
    this.changed('identitychange'); this.changed();
    return session;
  }
  async refreshNotes() {
    if (!this.user) return;
    const owner = this.user.id;
    const value = await this.request('notes');
    if (this.user?.id !== owner || value.viewerId !== owner) return;
    this.notes = value.notes; this.couple = value.couple; this.changed('notes'); this.changed('profile');
  }
  async saveProfile(value) {
    const result = await this.request('couple/profile', 'PATCH', value);
    this.couple = result.couple; this.changed('profile'); this.changed();
  }
}
