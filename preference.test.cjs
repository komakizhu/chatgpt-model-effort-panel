const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  Preferences,
  VERSION,
  context,
  resolveCurrentModelPreference,
  DEFAULT_PREFERENCE,
  PREFIX,
  effortLabelFromStatus,
  effortItemIndexFromStatus,
  effortLabelFromText,
  observeEffortPreference,
  createEffortBackendAdapter,
  confirmEffortWrite,
  preferenceMatches,
  classifyModelAvailability,
  modelAvailabilityLabel,
  effortRowPresentation,
  effortKey,
  effortValueKey,
  findEffortOption,
  buildEffortOptions,
  createModelOption,
  isManualNativeAction,
  findModel,
  normalizePreference,
  isLimitHint,
  PANEL_KEY,
  ENABLED_KEY,
  readFeatureEnabled,
  writeFeatureEnabled,
  createFeatureLifecycle,
  pageSummary,
  observeCurrentEffort,
  createFeatureToggleControl,
  normalizePanelSettings,
  readPanelSettings,
  clampPanelPosition,
  preferredExpandedPanelPosition,
  preferredPanelPosition,
  panelSummary,
  resolveConversationPreference,
  resolveEffortLabel,
  panelModelSlot,
  panelEffortSlot,
  shouldPreventPanelMouseFocus,
  readVisibleModelCatalog,
  createModelEffortControls,
  start
} = require('./ChatGPT_56_Preference.user.js');

function memory() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
}

const noop = () => {};

class TestElement {
  constructor(tagName, ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = this.tagName === 'SHADOW-ROOT' ? 11 : 1;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.parentElement = null;
    this._textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.focusCalls = 0;
    this.style = {};
    this.className = '';
    this.shadowRoot = null;
    this.dataset = new Proxy({}, {
      get: (_target, key) => this.attributes.get('data-' + String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())),
      set: (_target, key, value) => {
        this.attributes.set('data-' + String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), String(value));
        return true;
      }
    });
    this.classList = {
      add: name => { if (!this.className.split(/\s+/).includes(name)) this.className = (this.className + ' ' + name).trim(); },
      remove: name => { this.className = this.className.split(/\s+/).filter(item => item && item !== name).join(' '); },
      contains: name => this.className.split(/\s+/).includes(name)
    };
  }

  append(...elements) {
    for (const element of elements) {
      if (element.parentElement) element.remove();
      element.parentElement = this;
      this.children.push(element);
    }
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }

  contains(element) {
    return element === this || this.children.some(child => child.contains(element));
  }

  get isConnected() {
    let node = this;
    while (node) {
      if (node === this.ownerDocument?.documentElement) return true;
      node = node.parentElement || node.host || null;
    }
    return false;
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }

  set textContent(value) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this._textContent = String(value ?? '');
  }

  get innerText() { return this.textContent; }
  set innerText(value) { this.textContent = value; }

  getClientRects() {
    let node = this;
    while (node) {
      if (node.hidden || node.style?.display === 'none') return [];
      node = node.parentElement || node.host || null;
    }
    return this.isConnected ? [{ width: 100, height: 30 }] : [];
  }

  getBoundingClientRect() {
    return { left: 900, right: 1000, top: 800, bottom: 830, width: 100, height: 30 };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    if (name === 'class') return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || [];
    callbacks.push(callback);
    this.listeners.set(name, callbacks);
  }

  removeEventListener(name, callback) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== callback));
  }

  dispatchEvent(event) {
    event.target = this;
    const path = [];
    let node = this;
    while (node) {
      path.push(node);
      node = node.parentElement || node.host || null;
    }
    for (node of path) {
      event.currentTarget = node;
      for (const callback of node.listeners?.get(event.type) || []) callback(event);
      if (event.bubbles === false) break;
    }
    return true;
  }

  click(isTrusted = false) {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', isTrusted, bubbles: true, cancelable: true, preventDefault() {} });
  }

  focus() {
    this.focusCalls++;
  }

  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }

  attachShadow() {
    const shadow = new TestElement('shadow-root', this.ownerDocument);
    shadow.host = this;
    this.shadowRoot = shadow;
    return shadow;
  }

  matches(selector) {
    return String(selector).split(',').some(part => {
      let query = part.trim();
      if (!query) return false;
      const tag = query.match(/^[a-z][a-z0-9-]*/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      if (!tag && /^[a-z][a-z0-9-]*$/i.test(query)) return false;
      if (query.includes(':disabled') && !(this.disabled || this.getAttribute('aria-disabled') === 'true')) return false;
      for (const match of query.matchAll(/\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
        const [, name, value] = match;
        const actual = this.getAttribute(name);
        if (actual === null || (value !== undefined && actual !== value)) return false;
      }
      for (const match of query.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
        if (!this.classList.contains(match[1])) return false;
      }
      return true;
    });
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentElement || node.host || null;
    }
    return null;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function testDocument() {
  const doc = new TestElement('document');
  doc.nodeType = 9;
  doc.readyState = 'complete';
  doc.hidden = false;
  doc.documentElement = new TestElement('html', doc);
  doc.body = new TestElement('body', doc);
  doc.append(doc.documentElement);
  doc.documentElement.append(doc.body);
  doc.createElement = tagName => new TestElement(tagName, doc);
  doc.querySelectorAll = selector => doc.documentElement.querySelectorAll(selector);
  doc.querySelector = selector => doc.querySelectorAll(selector)[0] || null;
  doc.getElementById = id => doc.querySelectorAll('[id="' + id + '"]')[0] || null;
  return doc;
}

function fakeChatGPTWindow({
  enabled = null,
  currentModel = 'GPT-6',
  currentEffort = 'Medium',
  currentEffortValue = 1,
  effortSurface = true,
  buttonShowsModel = true,
  modelRows: rows = null,
  onModelClick = null,
  pathname = '/c/test-chat',
  localStore = null
} = {}) {
  const document = testDocument();
  const localStorage = localStore || memory(), sessionStorage = memory();
  if (enabled !== null) localStorage.setItem(ENABLED_KEY, enabled ? 'on' : 'off');
  const buttonText = () => buttonShowsModel && currentModel
    ? currentModel + ' · ' + currentEffort
    : currentEffort;
  let menu = null, menuOpenCount = 0, modelClickCount = 0, observerCount = 0;
  const picker = document.createElement('button');
  picker.setAttribute('aria-label', '选择 ChatGPT 模型');
  picker.textContent = buttonText();
  document.body.append(picker);

  const removeMenu = () => {
    const removed = menu;
    menu?.remove();
    menu = null;
    return removed;
  };
  document.documentElement.addEventListener('pointerdown', event => {
    if (menu && !menu.contains(event.target)) removeMenu();
  });
  const composer = document.createElement('textarea');
  document.body.append(composer);
  const modelRows = () => rows || [
    { label: 'GPT-5.6 Sol', stableId: 'gpt-56' },
    { label: 'GPT-6', stableId: 'gpt-6' }
  ];
  const addEffortSurface = target => {
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = currentEffort + '，第 ' + (currentEffortValue + 1) + ' 项，共 5 项。';
    const slider = document.createElement('div');
    slider.setAttribute('role', 'slider');
    slider.setAttribute('aria-valuemin', '0');
    slider.setAttribute('aria-valuemax', '4');
    slider.setAttribute('aria-valuenow', String(currentEffortValue));
    slider.setAttribute('aria-valuetext', currentEffort);
    target.append(status, slider);
  };
  picker.addEventListener('click', () => {
    if (menu) { removeMenu(); return; }
    menuOpenCount++;
    menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    if (effortSurface) addEffortSurface(menu);
    const chooser = document.createElement('button');
    chooser.setAttribute('role', 'menuitem');
    chooser.setAttribute('aria-label', '选择模型');
    chooser.addEventListener('click', () => {
      menu.textContent = '';
      const status = document.createElement('div');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.textContent = currentEffort + '，第 2 项，共 5 项。';
      menu.append(status);
      for (const row of modelRows()) {
        const item = document.createElement('button');
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-label', row.label);
        item.setAttribute('data-model-id', row.stableId);
        if (row.disabled) item.setAttribute('aria-disabled', 'true');
        if (row.reason) item.setAttribute('aria-description', row.reason);
        item.setAttribute('aria-checked', String(currentModel === row.label));
        item.addEventListener('click', () => {
          modelClickCount++;
          currentModel = row.label;
          for (const sibling of menu.querySelectorAll('[role="menuitemradio"]')) {
            sibling.setAttribute('aria-checked', String(sibling === item));
          }
          onModelClick?.({ currentModel, item, menu, window: win });
          picker.textContent = buttonText();
          const removed = removeMenu();
          queueMicrotask(() => win.triggerMutation([{
            type: 'childList', target: document.body, addedNodes: [],
            removedNodes: removed ? [removed] : []
          }]));
        });
        menu.append(item);
      }
    });
    menu.append(chooser);
    document.body.append(menu);
  });

  const observers = [];
  class MutationObserverMock {
    constructor(callback) { this.callback = callback; this.disconnected = false; observerCount++; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const intervals = new Map();
  let nextInterval = 0;
  let nextAnimation = 0;
  const win = new TestElement('window', document);
  Object.assign(win, {
    document,
    localStorage,
    sessionStorage,
    location: { pathname: '/c/test-chat' },
    innerWidth: 1200,
    innerHeight: 900,
    top: null,
    self: null,
    Element: TestElement,
    MutationObserver: MutationObserverMock,
    ResizeObserver: ResizeObserverMock,
    AbortController,
    PointerEvent: class PointerEventMock {
      constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    },
    getComputedStyle: element => ({ visibility: 'visible', display: element.hidden ? 'none' : 'block' }),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: id => clearTimeout(id),
    setInterval: callback => { const id = ++nextInterval; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
    requestAnimationFrame: callback => { const id = ++nextAnimation; callback(); return id; },
    cancelAnimationFrame() {},
    get observerCount() { return observerCount; },
    get observers() { return observers; },
    get activeIntervals() { return intervals.size; },
    get modelClickCount() { return modelClickCount; },
    get menuOpenCount() { return menuOpenCount; },
    get currentModel() { return currentModel; },
    setCurrentModel(label, { showModel = buttonShowsModel } = {}) {
      currentModel = label;
      buttonShowsModel = showModel;
      picker.textContent = buttonText();
    },
    setButtonShowsModel(showModel) {
      buttonShowsModel = Boolean(showModel);
      picker.textContent = buttonText();
    },
    triggerMutation(records = []) {
      for (const observer of observers) {
        if (!observer.disconnected) observer.callback(records);
      }
    },
    composer,
    picker,
    localStorage,
    sessionStorage,
    removeMenu
  });
  win.top = win.self = win;
  win.location.pathname = pathname;
  Object.defineProperties(win, {
    observerCount: { get: () => observerCount },
    observers: { get: () => observers },
    activeIntervals: { get: () => intervals.size },
    modelClickCount: { get: () => modelClickCount },
    menuOpenCount: { get: () => menuOpenCount },
    currentModel: { get: () => currentModel }
  });
  return win;
}

function descendants(node) {
  return node.children.flatMap(child => [child, ...descendants(child)]);
}

function panelFor(win) {
  return win.document.body.children.find(element => element.dataset.chatgptModelPanel).shadowRoot;
}

async function expandPanelAndWaitForCatalog(win, waitMs = 1800) {
  panelFor(win).querySelector('.toggle').click(true);
  await new Promise(resolve => setTimeout(resolve, waitMs));
}

test('用户脚本元数据、运行时标记和 README 版本保持一致', () => {
  const source = fs.readFileSync('ChatGPT_56_Preference.user.js', 'utf8');
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.equal(VERSION, '0.7.0');
  assert.match(source, /^\/\/ @version\s+0\.7\.0$/m);
  assert.match(readme, /^版本：0\.7\.0/m);
});

test('面板首次默认折叠，单独保存位置并读取', () => {
  const store = memory();
  assert.deepEqual(readPanelSettings(store), { settings: { collapsed: true, position: null }, available: true });
  store.setItem(PANEL_KEY, JSON.stringify({ collapsed: false, position: { right: 45, bottom: 80 } }));
  assert.deepEqual(readPanelSettings(store).settings, { collapsed: false, position: { right: 45, bottom: 80 } });
});

test('无效面板数据回退默认，存储不可用有独立状态', () => {
  const store = memory();
  store.setItem(PANEL_KEY, '{broken');
  assert.deepEqual(readPanelSettings(store), { settings: { collapsed: true, position: null }, available: true });
  assert.deepEqual(normalizePanelSettings({ collapsed: false, position: { right: -1, bottom: 2 } }),
    { collapsed: true, position: null });
  assert.equal(readPanelSettings({ getItem() { throw new Error('blocked'); } }).available, false);
});

test('脚本开关首次默认开启、关闭后持久关闭，损坏或不可读时保守停用', () => {
  const store = memory();
  assert.deepEqual(readFeatureEnabled(store), { enabled: true, available: true, reason: '' });
  assert.deepEqual(writeFeatureEnabled(store, false), { ok: true });
  assert.deepEqual(readFeatureEnabled(store), { enabled: false, available: true, reason: '' });
  store.setItem(ENABLED_KEY, 'corrupt');
  assert.equal(readFeatureEnabled(store).enabled, false);
  assert.match(readFeatureEnabled(store).reason, /无法识别/);
  assert.deepEqual(readFeatureEnabled({ getItem() { throw new Error('blocked'); } }), {
    enabled: false, available: false, reason: '无法读取脚本开关设置，已停用'
  });
});

test('脚本生命周期重复开启或关闭不会重复注册与清理', () => {
  const calls = { enable: 0, disable: 0 };
  const lifecycle = createFeatureLifecycle(false, {
    enable: () => { calls.enable++; },
    disable: () => { calls.disable++; }
  });
  assert.equal(lifecycle.set(false), false);
  assert.equal(lifecycle.set(true), true);
  assert.equal(lifecycle.set(true), false);
  assert.equal(lifecycle.set(false), true);
  assert.equal(lifecycle.set(false), false);
  assert.deepEqual(calls, { enable: 1, disable: 1 });
});

test('页面未知模型时仍显示真实档位，且序号不匹配时不确认档位', () => {
  assert.deepEqual(pageSummary({
    model: null,
    preference: null,
    effort: observeCurrentEffort({ state: 'unknown', label: 'Medium' }, 'Medium')
  }), { text: '模型未确认 · Medium', state: '' });
  assert.deepEqual(observeCurrentEffort({
    state: 'range', value: 1, min: 0, max: 4, itemIndex: 4, label: 'Medium'
  }, 'Medium，第 4 项，共 5 项。'), {
    state: 'unknown', label: '', value: 1, min: 0, max: 4, reason: '页面档位名称与位置不一致'
  });
});

test('折叠面板闲置变淡，交互恢复清晰且关闭后可展开开启', () => {
  const win = fakeChatGPTWindow({ enabled: false });
  const originalSetTimeout = win.setTimeout;
  const originalClearTimeout = win.clearTimeout;
  let idle = null;
  win.setTimeout = (callback, ms) => ms === 5000 ? (idle = { callback }) : originalSetTimeout(callback, ms);
  win.clearTimeout = id => { if (id === idle) idle = null; else originalClearTimeout(id); };
  const app = start(win);
  const host = win.document.body.children.find(element => element.dataset.chatgptModelPanel);
  const panel = host.shadowRoot.querySelector('.panel');
  const toggle = host.shadowRoot.querySelector('.toggle');
  const feature = host.shadowRoot.querySelector('.feature-toggle');
  const featureSwitch = host.shadowRoot.querySelector('.feature-switch');
  assert.equal(feature.hidden, true);
  assert.equal(toggle.hidden, false);
  assert.ok(idle);
  idle.callback();
  assert.equal(host.dataset.idle, 'true');
  panel.dispatchEvent({ type: 'pointerenter', bubbles: false });
  assert.equal(host.dataset.idle, 'false');
  assert.equal(idle, null);
  panel.dispatchEvent({ type: 'pointerleave', bubbles: false });
  assert.ok(idle);
  toggle.click(true);
  assert.equal(feature.hidden, false);
  assert.equal(host.dataset.idle, 'false');
  assert.equal(idle, null);
  featureSwitch.click(true);
  assert.equal(app.enabled, true);
  featureSwitch.click(true);
  assert.equal(app.enabled, false);
  toggle.click(true);
  assert.equal(feature.hidden, true);
  toggle.click(true);
  assert.equal(feature.hidden, false);
  featureSwitch.click(true);
  assert.equal(app.enabled, true);
  featureSwitch.click(true);
});

test('总开关通过可访问的 switch 控件通知并反映持久状态', () => {
  let enabled = true;
  const control = createFeatureToggleControl(testDocument(), () => { enabled = !enabled; });
  control.update(enabled);
  assert.equal(control.button.getAttribute('role'), 'switch');
  assert.equal(control.button.getAttribute('aria-checked'), 'true');
  assert.equal(control.button.getAttribute('aria-label'), '关闭脚本');
  control.button.click(true);
  control.update(enabled);
  assert.equal(control.button.getAttribute('aria-checked'), 'false');
  assert.equal(control.button.getAttribute('aria-label'), '开启脚本');
});

test('实际启动流程尊重总开关，启用后只切一次，关闭后撤下页面观察', async () => {
  const win = fakeChatGPTWindow({ enabled: false, currentModel: 'GPT-6' });
  const app = start(win);
  const host = win.document.body.children.find(element => element.dataset.chatgptModelPanel);
  const featureSwitch = host.shadowRoot.querySelector('.feature-switch');
  assert.equal(app.enabled, false);
  assert.equal(app.active, false);
  assert.equal(win.observerCount, 0);
  assert.equal(win.activeIntervals, 0);
  assert.equal(win.document.listeners.get('input')?.length || 0, 0);

  featureSwitch.click(true);
  assert.equal(app.enabled, true);
  assert.equal(app.active, true);
  assert.equal(win.observerCount, 1);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(win.currentModel, 'GPT-5.6 Sol', JSON.stringify(app.diagnostics));
  assert.equal(win.modelClickCount, 1);
  assert.equal(win.menuOpenCount, 1);

  await app.reconcile();
  assert.equal(win.modelClickCount, 1);
  assert.equal(win.menuOpenCount, 1);
  const preferenceKey = PREFIX + 'chat:test-chat';
  const savedBeforeDisable = win.localStorage.getItem(preferenceKey);

  featureSwitch.click(true);
  assert.equal(app.enabled, false);
  assert.equal(app.active, false);
  assert.equal(win.activeIntervals, 0);
  assert.equal(win.document.listeners.get('input')?.length || 0, 0);
  assert.ok(win.observers.every(observer => observer.disconnected));
  win.setCurrentModel('GPT-6');
  await app.reconcile();
  assert.equal(win.currentModel, 'GPT-6');
  assert.equal(win.modelClickCount, 1);
  assert.equal(win.localStorage.getItem(preferenceKey), savedBeforeDisable);

  featureSwitch.click(true);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(app.enabled, true);
  assert.equal(win.currentModel, 'GPT-5.6 Sol');
  assert.equal(win.modelClickCount, 2);
  assert.equal(win.menuOpenCount, 2);
});

test('原生按钮只显示 Medium 时读取唯一勾选项，并复用关闭菜单的确认', async () => {
  const win = fakeChatGPTWindow({ currentModel: 'GPT-6', buttonShowsModel: false });
  const app = start(win);
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.equal(win.currentModel, 'GPT-5.6 Sol', JSON.stringify(app.diagnostics));
  assert.equal(win.modelClickCount, 1);
  assert.equal(win.menuOpenCount, 1);
  await app.reconcile();
  assert.equal(win.modelClickCount, 1);
  assert.equal(win.menuOpenCount, 1);
  win.document.body.children.find(element => element.dataset.chatgptModelPanel)
    .shadowRoot.querySelector('.feature-switch').click(true);
});

test('模型未确认时只探测一次，普通调度不会反复打开菜单', async () => {
  const win = fakeChatGPTWindow({ currentModel: null, buttonShowsModel: false });
  const app = start(win);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(win.menuOpenCount, 1);
  assert.equal(win.modelClickCount, 0);
  assert.equal(app.diagnostics.blocked.kind, 'model-unconfirmed');
  await app.reconcile();
  await app.reconcile();
  assert.equal(win.menuOpenCount, 1);
  win.setCurrentModel('GPT-5.6 Sol', { showModel: true });
  await app.reconcile();
  assert.equal(app.diagnostics.observation.observation.modelState, 'confirmed');
  assert.equal(win.menuOpenCount, 1);
  win.document.body.children.find(element => element.dataset.chatgptModelPanel)
    .shadowRoot.querySelector('.feature-switch').click(true);
});

test('页面模型已与默认目标一致时不打开菜单或重复点击', async () => {
  const win = fakeChatGPTWindow({ currentModel: 'GPT-5.6 Sol' });
  const app = start(win);
  await new Promise(resolve => setTimeout(resolve, 550));
  await app.reconcile();
  assert.equal(win.currentModel, 'GPT-5.6 Sol');
  assert.equal(win.menuOpenCount, 0);
  assert.equal(win.modelClickCount, 0);
  win.document.body.children.find(element => element.dataset.chatgptModelPanel)
    .shadowRoot.querySelector('.feature-switch').click(true);
});

test('展开面板后空闲读取模型目录，保留权限限制并禁用无写入接口的强度按钮', async () => {
  const win = fakeChatGPTWindow({
    currentModel: 'GPT-5.6 Sol',
    modelRows: [
      { label: 'GPT-5.6 Sol', stableId: 'gpt-56' },
      { label: 'GPT-6', stableId: 'gpt-6', disabled: true, reason: '已达到使用限额' }
    ]
  });
  const app = start(win);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(win.menuOpenCount, 0, '折叠面板不主动打开原生菜单');
  assert.ok(panelFor(win).querySelectorAll('.model-choice').every(button => button.disabled));
  assert.match(panelFor(win).querySelector('.model-note').textContent, /模型列表未读取/);

  await expandPanelAndWaitForCatalog(win);
  const shadow = panelFor(win);
  assert.deepEqual(app.diagnostics.catalog.map(item => item.label), ['GPT-5.6 Sol', 'GPT-6']);
  assert.equal(win.menuOpenCount, 1);
  assert.equal(shadow.querySelectorAll('.model-choice')[0].disabled, false);
  assert.equal(shadow.querySelectorAll('.model-choice')[1].disabled, true);
  assert.match(shadow.querySelector('.model-note').textContent, /已达到使用限额/);
  assert.ok(shadow.querySelectorAll('.effort-choice').every(button => button.disabled));
  assert.match(shadow.querySelector('.effort-note').textContent, /未发现可确认的强度写入接口/);
  assert.equal(win.document.querySelectorAll('[role="menu"]').length, 0, '只关闭脚本打开的菜单');

  shadow.querySelector('.feature-switch').click(true);
});

test('用户打开的原生菜单会阻止展开面板的目录读取，脚本不关闭它', async () => {
  const local = memory();
  local.setItem(PANEL_KEY, JSON.stringify({ collapsed: false, position: null }));
  const win = fakeChatGPTWindow({ currentModel: 'GPT-5.6 Sol', localStore: local });
  const app = start(win);
  win.picker.click(true);
  await new Promise(resolve => setTimeout(resolve, 1700));
  assert.equal(win.menuOpenCount, 1);
  assert.equal(win.document.querySelectorAll('[role="menu"]').length, 1);
  assert.equal(app.diagnostics.catalog.length, 0);

  panelFor(win).querySelector('.feature-switch').click(true);
  assert.equal(win.document.querySelectorAll('[role="menu"]').length, 1);
  win.removeMenu();
});

test('面板确认模型后保存全局默认，新聊天继承且已有聊天保留自己的偏好', async () => {
  const local = memory();
  const previous = {
    modelKey: 'label:gpt-5.6 sol', modelLabel: 'GPT-5.6 Sol',
    effortKey: effortValueKey('label:gpt-5.6 sol', 1), effortLabel: 'Medium', effortState: 'value'
  };
  local.setItem(PREFIX + 'chat:test-chat', JSON.stringify(previous));
  local.setItem(PREFIX + 'chat:existing', JSON.stringify(previous));
  const win = fakeChatGPTWindow({ currentModel: 'GPT-5.6 Sol', localStore: local });
  const app = start(win);
  await expandPanelAndWaitForCatalog(win);

  const modelButtons = panelFor(win).querySelectorAll('.model-choice');
  modelButtons.find(button => button.textContent === 'GPT-6').click(true);
  await new Promise(resolve => setTimeout(resolve, 2100));

  const savedDefault = JSON.parse(local.getItem(PREFIX + 'default'));
  const savedChat = JSON.parse(local.getItem(PREFIX + 'chat:test-chat'));
  assert.equal(win.currentModel, 'GPT-6');
  assert.equal(savedDefault.modelLabel, 'GPT-6');
  assert.equal(savedDefault.effortState, 'value');
  assert.equal(savedDefault.effortLabel, 'Medium');
  assert.equal(savedChat.modelLabel, 'GPT-6');
  assert.equal(savedChat.effortState, 'value');
  assert.equal(panelFor(win).querySelector('.selection-note').textContent, '已记为新聊天默认');

  const prefs = new Preferences(local, win.sessionStorage);
  assert.equal(prefs.ensure('chat:new-chat').modelLabel, 'GPT-6');
  assert.deepEqual(prefs.ensure('chat:existing'), previous);
  panelFor(win).querySelector('.feature-switch').click(true);

  const reload = fakeChatGPTWindow({ localStore: local, currentModel: 'GPT-5.6 Sol', pathname: '/c/new-chat' });
  local.setItem(ENABLED_KEY, 'on');
  start(reload);
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.equal(reload.currentModel, 'GPT-6');
  assert.equal(JSON.parse(local.getItem(PREFIX + 'chat:new-chat')).modelLabel, 'GPT-6');
  panelFor(reload).querySelector('.feature-switch').click(true);
});

test('强度名称可见但页面未提供强度值时不覆盖新聊天默认', async () => {
  const local = memory();
  const originalDefault = {
    modelKey: 'label:gpt-5.6 sol', modelLabel: 'GPT-5.6 Sol',
    effortKey: effortValueKey('label:gpt-5.6 sol', 1), effortLabel: 'Medium', effortState: 'value'
  };
  local.setItem(PREFIX + 'default', JSON.stringify(originalDefault));
  const win = fakeChatGPTWindow({ currentModel: 'GPT-5.6 Sol', localStore: local, effortSurface: false });
  start(win);
  await expandPanelAndWaitForCatalog(win);
  panelFor(win).querySelectorAll('.model-choice').find(button => button.textContent === 'GPT-6').click(true);
  await new Promise(resolve => setTimeout(resolve, 2100));

  assert.equal(win.currentModel, 'GPT-6');
  assert.deepEqual(JSON.parse(local.getItem(PREFIX + 'default')), originalDefault);
  assert.equal(JSON.parse(local.getItem(PREFIX + 'chat:test-chat')).effortState, 'unknown');
  assert.match(panelFor(win).querySelector('.selection-note').textContent, /强度未确认，新聊天默认未更改/);
  panelFor(win).querySelector('.feature-switch').click(true);
});

test('面板确认后的两类存储失败分别提示，另一类写入仍可成功', async () => {
  for (const failedKey of [PREFIX + 'default', PREFIX + 'chat:test-chat']) {
    const values = new Map();
    const localStore = {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) {
        if (key === failedKey) throw new Error('quota exceeded');
        values.set(key, String(value));
      },
      removeItem(key) { values.delete(key); }
    };
    const win = fakeChatGPTWindow({ currentModel: 'GPT-5.6 Sol', localStore });
    start(win);
    await expandPanelAndWaitForCatalog(win);
    panelFor(win).querySelectorAll('.model-choice')[0].click(true);
    await new Promise(resolve => setTimeout(resolve, 1900));

    const note = panelFor(win).querySelector('.selection-note').textContent;
    if (failedKey.endsWith(':default')) {
      assert.equal(values.get(PREFIX + 'chat:test-chat') !== undefined, true);
      assert.equal(values.has(PREFIX + 'default'), false);
      assert.match(note, /新聊天默认未保存/);
    } else {
      assert.equal(values.has(PREFIX + 'chat:test-chat'), false);
      assert.equal(values.has(PREFIX + 'default'), true);
      assert.match(note, /当前聊天偏好未保存/);
    }
    panelFor(win).querySelector('.feature-switch').click(true);
  }
});

test('用户在等待切换期间开始输入会取消后续脚本操作并让调度恢复', async () => {
  const win = fakeChatGPTWindow({
    currentModel: 'GPT-6',
    onModelClick: ({ window }) => {
      window.composer.dispatchEvent({
        type: 'input',
        isTrusted: true,
        bubbles: true,
        composed: true,
        preventDefault() {}
      });
    }
  });
  const app = start(win);
  await new Promise(resolve => setTimeout(resolve, 1750));
  assert.equal(win.currentModel, 'GPT-5.6 Sol');
  assert.equal(win.modelClickCount, 1);
  assert.equal(app.active, true);
  await app.reconcile();
  assert.equal(win.modelClickCount, 1);
  win.document.body.children.find(element => element.dataset.chatgptModelPanel)
    .shadowRoot.querySelector('.feature-switch').click(true);
});

test('用户手动确认的模型在当前聊天优先于默认值并跨刷新保存', async () => {
  const local = memory();
  const originalDefault = {
    modelKey: 'label:gpt-5.6 sol', modelLabel: 'GPT-5.6 Sol',
    effortKey: effortValueKey('label:gpt-5.6 sol', 1), effortLabel: 'Medium', effortState: 'value'
  };
  local.setItem(PREFIX + 'default', JSON.stringify(originalDefault));
  const win = fakeChatGPTWindow({
    currentModel: 'GPT-5.6 Sol',
    localStore: local,
    onModelClick: ({ window }) => window.setButtonShowsModel(false)
  });
  const app = start(win);
  await new Promise(resolve => setTimeout(resolve, 300));
  win.picker.click(true);
  win.document.querySelector('[role="menuitem"]').click(true);
  win.document.querySelectorAll('[role="menuitemradio"]')
    .find(item => item.getAttribute('aria-label') === 'GPT-6')
    .click(true);
  await new Promise(resolve => setTimeout(resolve, 1700));

  assert.equal(win.currentModel, 'GPT-6');
  const stored = JSON.parse(win.localStorage.getItem(PREFIX + 'chat:test-chat'));
  assert.equal(stored.modelLabel, 'GPT-6');
  assert.equal(stored.effortState, 'unknown');
  assert.deepEqual(JSON.parse(win.localStorage.getItem(PREFIX + 'default')), originalDefault);
  await app.reconcile();
  assert.equal(win.currentModel, 'GPT-6');
  win.document.body.children.find(element => element.dataset.chatgptModelPanel)
    .shadowRoot.querySelector('.feature-switch').click(true);

  const reload = fakeChatGPTWindow({
    localStore: win.localStorage,
    currentModel: 'GPT-5.6 Sol'
  });
  reload.localStorage.setItem(ENABLED_KEY, 'on');
  start(reload);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(reload.currentModel, 'GPT-6');
  reload.document.body.children.find(element => element.dataset.chatgptModelPanel)
    .shadowRoot.querySelector('.feature-switch').click(true);
});

test('聊天偏好存储失败时当前标签页保留已确认模型且不被默认值覆盖', async () => {
  const values = new Map([[ENABLED_KEY, 'on']]);
  const localStore = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (key.startsWith(PREFIX)) throw new Error('quota exceeded');
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); }
  };
  const win = fakeChatGPTWindow({
    currentModel: 'GPT-5.6 Sol',
    localStore,
    onModelClick: ({ window }) => window.setButtonShowsModel(false)
  });
  const app = start(win);
  await new Promise(resolve => setTimeout(resolve, 300));
  win.picker.click(true);
  win.document.querySelector('[role="menuitem"]').click(true);
  win.document.querySelectorAll('[role="menuitemradio"]')
    .find(item => item.getAttribute('aria-label') === 'GPT-6')
    .click(true);
  await new Promise(resolve => setTimeout(resolve, 1650));

  assert.equal(win.currentModel, 'GPT-6');
  assert.equal(win.localStorage.getItem(PREFIX + 'chat:test-chat'), null);
  assert.match(panelFor(win).querySelector('.selection-note').textContent, /当前聊天偏好未保存/);
  await app.reconcile();
  assert.equal(win.currentModel, 'GPT-6');
  win.document.body.children.find(element => element.dataset.chatgptModelPanel)
    .shadowRoot.querySelector('.feature-switch').click(true);
});

test('存储访问失败时默认停用，用户仍可在当前标签页开启并看到未持久保存提示', () => {
  const win = fakeChatGPTWindow({ enabled: false });
  Object.defineProperty(win, 'localStorage', {
    configurable: true,
    get() { throw new Error('storage unavailable'); }
  });
  const app = start(win);
  const host = win.document.body.children.find(element => element.dataset.chatgptModelPanel);
  const feature = host.shadowRoot.querySelector('.feature-switch');
  const state = host.shadowRoot.querySelector('.feature-state');
  assert.equal(app.enabled, false);
  assert.match(state.textContent, /无法读取脚本开关设置/);
  feature.click(true);
  assert.equal(app.enabled, true);
  assert.match(state.textContent, /无法保存脚本开关状态/);
  feature.click(true);
});

test('总开关跨标签同步，关闭状态在重新加载后仍然保留', () => {
  const sharedStorage = memory();
  sharedStorage.setItem(ENABLED_KEY, 'off');
  const firstWindow = fakeChatGPTWindow({ localStore: sharedStorage });
  const firstApp = start(firstWindow);
  const secondWindow = fakeChatGPTWindow({ localStore: sharedStorage });
  const secondApp = start(secondWindow);
  assert.equal(firstApp.enabled, false);
  assert.equal(secondApp.enabled, false);

  sharedStorage.setItem(ENABLED_KEY, 'on');
  firstWindow.dispatchEvent({ type: 'storage', key: ENABLED_KEY, bubbles: false });
  secondWindow.dispatchEvent({ type: 'storage', key: ENABLED_KEY, bubbles: false });
  assert.equal(firstApp.enabled, true);
  assert.equal(secondApp.enabled, true);

  sharedStorage.setItem(ENABLED_KEY, 'off');
  firstWindow.dispatchEvent({ type: 'storage', key: ENABLED_KEY, bubbles: false });
  secondWindow.dispatchEvent({ type: 'storage', key: ENABLED_KEY, bubbles: false });
  assert.equal(firstApp.active, false);
  assert.equal(secondApp.active, false);
  assert.equal(firstWindow.activeIntervals, 0);
  assert.equal(secondWindow.activeIntervals, 0);
});

test('面板位置按视口和展开后的高度限制，原始偏好不变', () => {
  const desired = { right: 400, bottom: 500 };
  assert.deepEqual(clampPanelPosition(null, { width: 800, height: 600 }, { width: 290, height: 40 }), { right: 12, bottom: 12 });
  assert.deepEqual(clampPanelPosition(desired, { width: 400, height: 300 }, { width: 290, height: 200 }), { right: 110, bottom: 100 });
  assert.deepEqual(desired, { right: 400, bottom: 500 });
  assert.deepEqual(clampPanelPosition({ right: -4, bottom: -8 }, { width: 200, height: 100 }, { width: 290, height: 200 }), { right: 0, bottom: 0 });
});

test('面板默认停靠在录音按钮右侧的留白处', () => {
  const position = preferredPanelPosition(
    { width: 1324, height: 1024 },
    { width: 148, height: 32 },
    { top: 680 },
    { left: 1080, right: 1125, top: 980, bottom: 1012 }
  );
  assert.deepEqual(position, { right: 12, bottom: 12 });
  assert.ok(1324 - position.right - 148 >= 1125 + 12);
  assert.equal(position.bottom, 12);
});

test('展开态仍停在输入栏上方并避开录音按钮', () => {
  const position = preferredExpandedPanelPosition(
    { width: 1024, height: 768 },
    { width: 198, height: 180 },
    { top: 640 },
    { left: 880, right: 920, top: 700, bottom: 732 }
  );
  assert.deepEqual(position, { right: 156, bottom: 140 });
});

test('折叠摘要只显示网页已核对的模型与强度', () => {
  const wanted = DEFAULT_PREFERENCE;
  assert.deepEqual(panelSummary(wanted, wanted), { text: 'GPT-5.6 · Medium', state: '' });
  const unknown = { ...wanted, effortKey: null, effortLabel: '', effortState: 'unknown' };
  assert.deepEqual(panelSummary(unknown, unknown), { text: 'GPT-5.6 · 档位未识别', state: '' });
  assert.deepEqual(panelSummary(wanted, { ...unknown, observedEffortLabel: 'High' }), { text: 'GPT-5.6 · High', state: '' });
  assert.deepEqual(panelSummary(wanted, null), { text: '', state: '' });
});

test('当前会话的用户选择优先于默认值，切换会话后才回到保存值', () => {
  const saved = { ...DEFAULT_PREFERENCE };
  const userChoice = { ...saved, effortKey: effortValueKey(saved.modelKey, 3), effortLabel: 'Extra High' };
  assert.equal(resolveConversationPreference(saved, null, null), saved);
  assert.equal(resolveConversationPreference(saved, userChoice, saved).effortKey, userChoice.effortKey);
  assert.equal(resolveConversationPreference(saved, null, userChoice).effortKey, userChoice.effortKey);
});

test('强度标签不会用滞后的原生状态覆盖已确认档位', () => {
  assert.equal(resolveEffortLabel('Extra High', 'Medium'), 'Extra High');
  assert.equal(resolveEffortLabel('极高', 'Extra High'), 'Extra High');
  assert.equal(resolveEffortLabel('原生第 4 档', 'Extra High'), 'Extra High');
  assert.equal(resolveEffortLabel('Medium', 'Medium'), 'Medium');
});

test('快捷档位只把 Medium 和 Extra High 显示为 Mid 和 X High，Max 不冒充 Pro', () => {
  assert.equal(panelEffortSlot('Medium').label, 'Mid');
  assert.equal(panelEffortSlot('Mid').canonical, 'Medium');
  assert.equal(panelEffortSlot('Extra High').label, 'X High');
  assert.equal(panelEffortSlot('X High').canonical, 'Extra High');
  assert.equal(panelEffortSlot('Pro').label, 'Pro');
  assert.equal(panelEffortSlot('Max'), null);
  assert.equal(panelModelSlot('GPT-5.6 Sol').label, 'GPT-5.6');
  assert.equal(panelModelSlot('GPT-6').label, 'GPT-6');
  assert.equal(panelModelSlot('GPT-6 Thinking'), null);
});

test('展开面板实际渲染固定模型和强度按钮，并只按页面确认状态选中', () => {
  const modelSelections = [];
  const effortSelections = [];
  const controls = createModelEffortControls(testDocument(),
    model => modelSelections.push(model),
    (model, effortKey) => effortSelections.push({ model, effortKey }));
  const current = { ...DEFAULT_PREFERENCE };
  const gpt56 = createModelOption({ key: current.modelKey, label: 'GPT-5.6 Sol' });
  const gpt6 = createModelOption({ stableId: 'gpt-6', label: 'GPT-6', reason: '已锁定访问权限；已达到使用限额' });
  const medium = { key: effortValueKey(current.modelKey, 1), value: 1, label: 'Medium' };
  const originalNodes = descendants(controls.element);

  controls.update({
    catalog: [gpt56, gpt6],
    catalogFresh: true,
    current,
    effortModelKey: current.modelKey,
    effortOptions: [medium],
    observedEffortLabel: 'Medium',
    writerAvailable: false,
    writerReason: '未发现可确认的强度写入接口'
  });

  assert.deepEqual([...controls.modelButtons.values()].map(button => button.textContent), ['GPT-5.6', 'GPT-6']);
  assert.deepEqual([...controls.effortButtons.values()].map(button => button.textContent), ['Low', 'Mid', 'High', 'X High', 'Pro']);
  assert.equal(controls.modelButtons.get('gpt-5.6').getAttribute('aria-pressed'), 'true');
  assert.equal(controls.modelButtons.get('gpt-6').disabled, true);
  assert.match(controls.modelNotice.textContent, /GPT-6：.*访问权限.*使用限额/);
  assert.equal(controls.effortButtons.get('medium').getAttribute('aria-pressed'), 'true');
  assert.equal(controls.effortButtons.get('medium').disabled, true);
  assert.match(controls.effortNotice.textContent, /无法切换/);
  assert.equal(controls.effortButtons.get('pro').disabled, true);
  assert.match(controls.effortButtons.get('pro').title, /此档未确认/);
  assert.equal(descendants(controls.element).some(node => node.tagName === 'SELECT'), false);

  controls.modelButtons.get('gpt-6').click(true);
  controls.effortButtons.get('medium').click(true);
  assert.equal(modelSelections.length, 0);
  assert.equal(effortSelections.length, 0);

  controls.update({
    catalog: [gpt56, gpt6],
    catalogFresh: true,
    current: { ...current, effortLabel: 'Extra High', effortKey: effortValueKey(current.modelKey, 3) },
    effortModelKey: current.modelKey,
    effortOptions: [{ key: effortValueKey(current.modelKey, 3), value: 3, label: 'Extra High' }],
    observedEffortLabel: 'Extra High',
    writerAvailable: true,
    writerReason: ''
  });
  assert.equal(controls.effortButtons.get('extra-high').getAttribute('aria-pressed'), 'true');
  assert.equal(controls.effortButtons.get('pro').disabled, true);
  const updatedNodes = descendants(controls.element);
  assert.equal(updatedNodes.length, originalNodes.length);
  originalNodes.forEach((node, index) => assert.strictEqual(updatedNodes[index], node));
  assert.equal(descendants(controls.element).some(node => node.focusCalls > 0), false);

  controls.update({
    catalog: [gpt56, gpt6],
    catalogFresh: true,
    current: { ...current, effortLabel: 'Max', effortKey: effortValueKey(current.modelKey, 4) },
    effortModelKey: current.modelKey,
    effortOptions: [{ key: effortValueKey(current.modelKey, 4), value: 4, label: 'Max' }],
    observedEffortLabel: 'Max',
    writerAvailable: true,
    writerReason: ''
  });
  assert.equal(controls.effortButtons.get('pro').getAttribute('aria-pressed'), 'false');
  assert.equal(controls.effortButtons.get('pro').disabled, true);
  assert.match(controls.effortButtons.get('pro').title, /此档未确认/);
});

test('打开的原生模型菜单只读采集真实模型项目，不点击菜单或选项', () => {
  let clicks = 0, reads = 0;
  const elements = [
    { label: 'GPT-5.6 Sol', key: 'model:56', click() { clicks++; } },
    { label: 'GPT-6', key: 'model:6', reason: '已达到使用限额', click() { clicks++; } }
  ];
  const menu = {
    querySelectorAll(selector) {
      assert.equal(selector, '[role="menuitemradio"]');
      return elements;
    }
  };
  const items = readVisibleModelCatalog([menu], element => {
    reads++;
    return { ...element };
  }, () => true);
  assert.deepEqual(items.map(item => item.label), ['GPT-5.6 Sol', 'GPT-6']);
  assert.equal(reads, 2);
  assert.equal(clicks, 0);
  assert.deepEqual(readVisibleModelCatalog([], () => { throw new Error('不应读取'); }, () => true), []);
});

test('鼠标点击模型或强度按钮可阻止浏览器把焦点从输入框移走', () => {
  let prevented = false;
  const control = {};
  const pointer = {
    type: 'pointerdown', button: 0, cancelable: true,
    preventDefault() { prevented = true; }
  };
  assert.equal(shouldPreventPanelMouseFocus(pointer, control), true);
  pointer.preventDefault();
  assert.equal(prevented, true);
  assert.equal(shouldPreventPanelMouseFocus({ ...pointer, button: 2 }, control), false);
  assert.equal(shouldPreventPanelMouseFocus({ ...pointer, cancelable: false }, control), false);
  assert.equal(shouldPreventPanelMouseFocus({ ...pointer, type: 'keydown' }, control), false);
});

test('初始默认组合为 GPT-5.6 Sol + Medium', () => {
  const prefs = new Preferences(memory(), memory());
  assert.deepEqual(prefs.readDefault(), DEFAULT_PREFERENCE);
  assert.deepEqual(prefs.ensure('chat:a'), DEFAULT_PREFERENCE);
});

test('聊天偏好跨重载保存且互不覆盖', () => {
  const local = memory();
  const first = new Preferences(local, memory());
  const modelKey = 'label:gpt-5.6 sol';
  first.save('chat:a', { modelKey, modelLabel: 'GPT-5.6 Sol', effortKey: effortValueKey(modelKey, 3), effortLabel: '极高', effortState: 'value' });
  const second = new Preferences(local, memory());
  assert.equal(second.ensure('chat:a').effortKey, effortValueKey(modelKey, 3));
  assert.equal(second.ensure('chat:b').effortKey, effortValueKey(modelKey, 1));
});

test('聊天偏好存储失败不会伪装成已持久保存', () => {
  const failing = {
    getItem() { return null; },
    setItem() { throw new Error('quota exceeded'); },
    removeItem() {}
  };
  const prefs = new Preferences(failing, failing);
  assert.deepEqual(prefs.ensure('chat:volatile'), DEFAULT_PREFERENCE);
  assert.equal(prefs.read('chat:volatile'), null);
  assert.throws(() => prefs.save('chat:volatile', DEFAULT_PREFERENCE), /无法持久保存聊天偏好/);
  assert.throws(() => prefs.setDefault(DEFAULT_PREFERENCE), /无法持久保存默认偏好/);
});

test('全局默认只影响之后首次进入的聊天', () => {
  const prefs = new Preferences(memory(), memory());
  prefs.ensure('chat:existing');
  const changed = { modelKey: 'model:new', modelLabel: 'New Model', effortKey: effortValueKey('model:new', 2), effortLabel: 'High', effortState: 'value' };
  prefs.setDefault(changed);
  assert.equal(prefs.ensure('chat:existing').modelKey, 'label:gpt-5.6 sol');
  assert.equal(prefs.ensure('chat:new').modelKey, 'model:new');
});

test('未识别强度不能设为默认，但可以保留为聊天状态', () => {
  const prefs = new Preferences(memory(), memory());
  const unknown = { modelKey: 'model:unknown', modelLabel: 'Unknown', effortKey: null, effortLabel: '', effortState: 'unknown' };
  prefs.save('chat:a', unknown);
  assert.equal(prefs.ensure('chat:a').effortState, 'unknown');
  assert.throws(() => prefs.setDefault(unknown), /已确认/);
  const noEffort = { ...unknown, effortState: 'none' };
  assert.equal(prefs.setDefault(noEffort).effortState, 'none');
});

test('旧版 0–4 档位只迁移到 GPT-5.6 Sol 并保留旧键', () => {
  const local = memory();
  for (let level = 0; level <= 4; level++) {
    const session = memory();
    const prefs = new Preferences(local, session);
    session.setItem('chatgpt-56-preference-v1:draft:/', JSON.stringify({ level }));
    const migrated = prefs.ensure('draft:/');
    assert.equal(migrated.modelLabel, 'GPT-5.6 Sol');
    assert.equal(migrated.effortKey, effortValueKey('label:gpt-5.6 sol', level));
    assert.notEqual(session.getItem('chatgpt-56-preference-v1:draft:/'), null);
  }
});

test('新聊天草稿只在明确发送后关联到会话', () => {
  const prefs = new Preferences(memory(), memory());
  const modelKey = 'label:gpt-5.6 sol';
  prefs.save('draft:/', { modelKey, modelLabel: 'GPT-5.6 Sol', effortKey: effortValueKey(modelKey, 2), effortLabel: 'High', effortState: 'value' });
  prefs.migrate('draft:/', 'chat:sent', { from: 'draft:/', time: 100 }, 200);
  assert.equal(prefs.ensure('chat:sent').effortKey, effortValueKey(modelKey, 2));
  assert.equal(prefs.read('draft:/'), null);
});

test('未知会话不迁移临时偏好', () => {
  const prefs = new Preferences(memory(), memory());
  const modelKey = 'label:gpt-5.6 sol';
  prefs.save('draft:/', { modelKey, modelLabel: 'GPT-5.6 Sol', effortKey: effortValueKey(modelKey, 4), effortLabel: 'Max', effortState: 'value' });
  prefs.migrate('draft:/', 'chat:opened-without-send');
  assert.equal(prefs.read('chat:opened-without-send'), null);
  assert.equal(prefs.read('draft:/').effortKey, effortValueKey(modelKey, 4));
});

test('模型切换时已保存的聊天档位不会被临时草稿覆盖', () => {
  const prefs = new Preferences(memory(), memory());
  prefs.save('draft:/', { modelKey: 'model:draft', modelLabel: 'Draft', effortKey: effortValueKey('model:draft', 2), effortLabel: 'High', effortState: 'value' });
  prefs.save('chat:existing', { modelKey: 'model:existing', modelLabel: 'Existing', effortKey: effortValueKey('model:existing', 4), effortLabel: 'Max', effortState: 'value' });
  prefs.migrate('draft:/', 'chat:existing');
  assert.equal(prefs.ensure('chat:existing').effortKey, effortValueKey('model:existing', 4));
});

test('中英文原生强度状态解析成可读标签', () => {
  assert.equal(effortLabelFromStatus('Medium，第 2 项，共 5 项。'), 'Medium');
  assert.equal(effortLabelFromStatus('Extra High, item 4 of 5.'), 'Extra High');
  assert.equal(effortLabelFromText('GPT-5.6 · 中'), 'Medium');
  assert.equal(effortLabelFromText('GPT-5.6 · Mid'), 'Medium');
  assert.equal(effortLabelFromText('GPT-5.6 · X High'), 'Extra High');
  assert.equal(effortLabelFromText('GPT-6 · Extra High'), 'Extra High');
  assert.equal(effortItemIndexFromStatus('Medium，第 2 项，共 5 项。'), 2);
  assert.equal(effortItemIndexFromStatus('Extra High, item 4 of 5.'), 4);
  assert.equal(effortLabelFromStatus('无项目序号的文字'), null);
  assert.equal(effortKey('Medium'), 'effort:medium');
  assert.equal(effortKey('极高'), 'effort:extra-high');
  assert.equal(effortKey('Experimental level'), 'label:experimental level');
});

test('每个模型按自己的滑杆范围生成档位，缺少名称时保持未识别', () => {
  const four = buildEffortOptions('model:four', 0, 3, { 0: 'Low，第 1 项，共 4 项。', 1: 'Medium，第 2 项，共 4 项。', 2: 'High，第 3 项，共 4 项。', 3: 'Max，第 4 项，共 4 项。' });
  assert.equal(four.kind, 'value');
  assert.deepEqual(four.options.map(option => option.label), ['Low', 'Medium', 'High', 'Max']);
  const partial = buildEffortOptions('model:three', 0, 2, { 0: 'Low，第 1 项，共 3 项。', 1: '', 2: 'High，第 3 项，共 3 项。' });
  assert.equal(partial.kind, 'unknown');
  assert.deepEqual(partial.options, []);
  assert.equal(buildEffortOptions('model:wrong', 0, 1, { 0: 'Medium，第 2 项，共 2 项。', 1: 'High，第 2 项，共 2 项。' }).reason, '档位文案与当前值不一致');
  assert.notEqual(four.options[0].key, effortValueKey('model:three', 0));
  assert.equal(buildEffortOptions('model:wide', 0, 10, {}).kind, 'unknown');
});

test('真实页面文案与滑杆序号一致时才确认档位', () => {
  const saved = { ...DEFAULT_PREFERENCE };
  const observed = observeEffortPreference(saved, 'Medium，第 2 项，共 5 项。', {
    state: 'range', value: 1, min: 0, max: 4, itemIndex: 2, accessibleLabel: ''
  });
  assert.equal(observed.effortState, 'value');
  assert.equal(observed.effortLabel, 'Medium');
  assert.equal(observed.effortKey, effortValueKey(saved.modelKey, 1));
  const mismatch = observeEffortPreference(saved, 'High，第 3 项，共 5 项。', {
    state: 'range', value: 1, min: 0, max: 4, itemIndex: 3, accessibleLabel: ''
  });
  assert.equal(mismatch.effortState, 'unknown');
  assert.equal(mismatch.effortLabel, '');
});

test('没有滑杆数值时只在文案与已保存真实档位一致时复用会话键', () => {
  const saved = { ...DEFAULT_PREFERENCE };
  const same = observeEffortPreference(saved, 'GPT-5.6 · 中', { state: 'missing', value: null, min: null, itemIndex: null });
  assert.equal(same.effortState, 'value');
  assert.equal(same.effortLabel, 'Medium');
  const migrated = observeEffortPreference({ ...saved, effortLabel: '原生第 2 档' }, 'GPT-5.6 · Medium', {
    state: 'missing', value: null, min: null, itemIndex: null
  });
  assert.equal(migrated.effortState, 'value');
  assert.equal(migrated.effortLabel, 'Medium');
  const changed = observeEffortPreference({ ...saved, effortLabel: 'High', effortKey: effortValueKey(saved.modelKey, 2) }, 'GPT-5.6 · 中', {
    state: 'missing', value: null, min: null, itemIndex: null
  });
  assert.equal(changed.effortState, 'unknown');
  assert.equal(changed.observedEffortLabel, 'Medium');
  assert.deepEqual(panelSummary(saved, changed), { text: 'GPT-5.6 · Medium', state: '' });
});

test('后端适配器没有确认契约时明确阻塞，假的契约可验证失败边界', async () => {
  const blocked = createEffortBackendAdapter();
  assert.equal(blocked.available, false);
  assert.equal(blocked.canRead, false);
  assert.equal(blocked.canWrite, false);
  assert.equal((await blocked.write({})).ok, false);
  const calls = [];
  const adapter = createEffortBackendAdapter({
    async read(payload) { calls.push(['read', payload]); return { ok: true, value: 'Medium' }; },
    async write(payload) { calls.push(['write', payload]); return { ok: true, value: 'High' }; }
  });
  assert.equal(adapter.available, true);
  assert.equal(adapter.canRead, true);
  assert.equal(adapter.canWrite, true);
  assert.deepEqual(await adapter.read({ context: 'chat:a' }), { ok: true, value: 'Medium' });
  assert.deepEqual(await adapter.write({ context: 'chat:a' }), { ok: true, value: 'High' });
  assert.deepEqual(calls.map(call => call[0]), ['read', 'write']);
  const invalid = createEffortBackendAdapter({
    async read() { return { value: 'Medium' }; },
    async write() { throw new Error('权限不足'); }
  });
  assert.deepEqual(await invalid.read({}), { ok: false, reason: '后端响应无法确认' });
  assert.deepEqual(await invalid.write({}), { ok: false, reason: '权限不足' });
  const reader = createEffortBackendAdapter({ async read() { return { ok: true }; } });
  assert.equal(reader.canRead, true);
  assert.equal(reader.canWrite, false);
  assert.deepEqual(await reader.write({}), { ok: false, reason: '未发现可确认的强度写入接口' });
});

test('写入只在页面于 5 秒内确认同一模型与档位后成功，失败时不提交偏好', async () => {
  const modelKey = DEFAULT_PREFERENCE.modelKey;
  const target = {
    ...DEFAULT_PREFERENCE,
    effortKey: effortValueKey(modelKey, 3),
    effortLabel: 'Extra High'
  };
  let clock = 0;
  let pagePreference = DEFAULT_PREFERENCE;
  let saved = null;
  const adapter = createEffortBackendAdapter({
    async write() { return { ok: true }; }
  });
  const success = await confirmEffortWrite({
    adapter,
    target,
    payload: { context: 'chat:a', modelKey, effortKey: target.effortKey },
    check: noop,
    now: () => clock,
    wait: async ms => {
      clock += ms;
      if (clock >= 300) pagePreference = target;
    },
    readCurrent: async () => ({ preference: pagePreference })
  });
  if (success.ok) saved = success.preference;
  assert.equal(success.ok, true);
  assert.equal(saved.effortLabel, 'Extra High');

  clock = 0;
  pagePreference = DEFAULT_PREFERENCE;
  saved = null;
  const timeout = await confirmEffortWrite({
    adapter,
    target,
    payload: { context: 'chat:a', modelKey, effortKey: target.effortKey },
    check: noop,
    now: () => clock,
    wait: async ms => { clock += ms; },
    readCurrent: async () => ({ preference: pagePreference })
  });
  if (timeout.ok) saved = timeout.preference;
  assert.equal(timeout.ok, false);
  assert.equal(timeout.reason, '页面未在 5 秒内确认切换结果');
  assert.equal(saved, null);

  const controller = new AbortController();
  let receivedSignal = null;
  const cancellable = createEffortBackendAdapter({
    async write(_payload, options) {
      receivedSignal = options.signal;
      controller.abort();
      return { ok: true };
    }
  });
  const cancelled = await confirmEffortWrite({
    adapter: cancellable,
    target,
    payload: { context: 'chat:a', modelKey, effortKey: target.effortKey },
    check: noop,
    signal: controller.signal,
    readCurrent: async () => ({ preference: target })
  });
  assert.equal(receivedSignal, controller.signal);
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.reason, '档位修改已取消');
});

test('重复强度名称不能替代数值确认', () => {
  const modelKey = DEFAULT_PREFERENCE.modelKey;
  const highAtTwo = {
    modelKey, modelLabel: DEFAULT_PREFERENCE.modelLabel,
    effortKey: effortValueKey(modelKey, 2), effortLabel: 'High', effortState: 'value'
  };
  const highAtThree = {
    ...highAtTwo, effortKey: effortValueKey(modelKey, 3)
  };
  assert.equal(preferenceMatches(highAtTwo, highAtThree), false);
  assert.equal(preferenceMatches(highAtTwo, highAtTwo), true);
});

test('档位逻辑不再聚焦原生滑杆或派发合成方向键', () => {
  const source = fs.readFileSync('ChatGPT_56_Preference.user.js', 'utf8');
  assert.doesNotMatch(source, /function\s+moveSliderTo\b/);
  assert.doesNotMatch(source, /new\s+win\.KeyboardEvent/);
  assert.doesNotMatch(source, /state\.control\.focus\s*\(/);
  assert.doesNotMatch(source, /oldFocus\.focus\s*\(/);
  assert.match(source, /shouldPreventPanelMouseFocus\(event, preserveFocusChoice\)/);
  const effortReader = source.slice(source.indexOf('const readNativeModelText'), source.indexOf('const menus'));
  assert.doesNotMatch(effortReader, /parentElement|\.click\s*\(/);
  const passiveRead = source.slice(source.indexOf('function readCurrentPreferenceFromNative'), source.indexOf('function updateEffortUi'));
  assert.doesNotMatch(passiveRead, /\.click\s*\(/);
  assert.match(source, /未发现可确认的强度写入接口/);
  const chooseEffort = source.slice(source.indexOf('function chooseEffort'), source.indexOf('function renderPanel'));
  assert.doesNotMatch(chooseEffort, /rememberConversationPreference/);
  const reconcile = source.slice(source.indexOf('async function reconcile'), source.indexOf("for (const type of ['pointerdown'"));
  assert.match(reconcile, /if \(!actual\)[\s\S]*?openModelOptions/);
  assert.doesNotMatch(source, /pendingCatalogRefresh/);
  const catalogReader = source.slice(source.indexOf('function observeVisibleModelCatalog'), source.indexOf('function isChooser'));
  assert.match(catalogReader, /menus\(\)/);
  assert.match(catalogReader, /readModelItems/);
  assert.doesNotMatch(catalogReader, /\.click\s*\(/);
  const panelCreation = source.slice(source.indexOf('function mountPanel'), source.indexOf('function schedule'));
  assert.doesNotMatch(panelCreation, /☆|⌖|↻|设为新聊天默认|重新读取原生控件|resetPosition|saveDefault|refresh|createElement\(['"]select/);
  assert.match(source, /observeVisibleModelCatalog\(\)/);
});

test('旧版按名称保存的档位只在同模型中按原生标签迁移', () => {
  const modelKey = 'model:legacy';
  const options = buildEffortOptions(modelKey, 0, 2, {
    0: 'Low，第 1 项，共 3 项。',
    1: 'Medium，第 2 项，共 3 项。',
    2: 'High，第 3 项，共 3 项。'
  }).options;
  assert.equal(findEffortOption(options, { modelKey, effortKey: 'effort:medium', effortLabel: 'Medium' }).value, 1);
  assert.equal(findEffortOption(options, { modelKey: 'model:other', effortKey: 'effort:medium', effortLabel: 'Medium' }), null);
});

test('档位选项以模型和原生滑杆位置组成独立标识', () => {
  const first = buildEffortOptions('model:a', 0, 1, { 0: 'High，第 1 项，共 2 项。', 1: 'High，第 2 项，共 2 项。' });
  const second = buildEffortOptions('model:b', 0, 1, { 0: 'High，第 1 项，共 2 项。', 1: 'High，第 2 项，共 2 项。' });
  assert.notEqual(first.options[0].key, first.options[1].key);
  assert.notEqual(first.options[0].key, second.options[0].key);
});

test('原生没有强度控件与控件未识别分别保留状态', () => {
  const base = { modelKey: 'model:x', modelLabel: 'Model X', effortKey: null, effortLabel: '' };
  assert.equal(normalizePreference({ ...base, effortState: 'none' }).effortState, 'none');
  assert.equal(normalizePreference({ ...base, effortState: 'unknown' }).effortState, 'unknown');
  assert.equal(normalizePreference({ ...base, effortState: 'value' }), null);
});

test('模型稳定 ID 优先，缺失 ID 时按完整名称区分', () => {
  const stable = createModelOption({ stableId: 'model-123', label: 'GPT-6', checked: true });
  const fallback = createModelOption({ label: 'GPT-5.6 Sol', category: '推理模型' });
  assert.equal(stable.key, 'id:model-123');
  assert.equal(fallback.key, 'label:gpt-5.6 sol');
  assert.equal(fallback.category, '推理模型');
  assert.equal(findModel([stable, fallback], { modelKey: 'old-key', modelLabel: 'GPT-5.6 Sol' }).key, fallback.key);
});

test('目录尚未读取时也能用保存的模型字段构造当前观察值', () => {
  const saved = { ...DEFAULT_PREFERENCE };
  const fallback = resolveCurrentModelPreference([], saved, 'GPT-5.6 · Medium');
  assert.equal(fallback.key, saved.modelKey);
  assert.equal(fallback.label, saved.modelLabel);
  const actualGpt6 = resolveCurrentModelPreference([], saved, 'GPT-6 · Medium');
  assert.equal(actualGpt6.label, 'GPT-6');
  assert.notEqual(actualGpt6.key, saved.modelKey);
  assert.equal(resolveCurrentModelPreference([], saved, 'Medium'), null);
  const savedThinking = {
    ...saved,
    modelKey: 'label:gpt-6 thinking',
    modelLabel: 'GPT-6 Thinking'
  };
  const actualThinking = resolveCurrentModelPreference([], savedThinking, 'GPT-6 Thinking · Medium');
  assert.equal(actualThinking.key, savedThinking.modelKey);
  const thinkingFromDefault = resolveCurrentModelPreference([], saved, 'GPT-6 Thinking · Medium');
  assert.equal(thinkingFromDefault.label, 'GPT-6 Thinking');
  assert.notEqual(thinkingFromDefault.key, saved.modelKey);
  const catalog = [
    createModelOption({ label: 'GPT-6', stableId: 'gpt-6' }),
    createModelOption({ label: 'GPT-6 Thinking', stableId: 'gpt-6-thinking' }),
    createModelOption({ label: 'GPT-5.6 Sol', stableId: 'gpt-56' })
  ];
  assert.equal(resolveCurrentModelPreference(catalog, saved, 'GPT-6 Thinking · Medium').key, 'id:gpt-6-thinking');
  assert.equal(resolveCurrentModelPreference([catalog[0]], saved, 'GPT-6 Thinking · Medium').label, 'GPT-6 Thinking');
  assert.equal(resolveCurrentModelPreference(catalog, saved, '5.6 中').key, 'id:gpt-56');
});

test('模型读取可独立使用唯一已选目录项，且拒绝多选和文字冲突', () => {
  const saved = { ...DEFAULT_PREFERENCE };
  const gpt56 = createModelOption({ label: 'GPT-5.6 Sol', stableId: 'gpt-56' });
  const gpt6 = createModelOption({ label: 'GPT-6', stableId: 'gpt-6' });
  assert.equal(resolveCurrentModelPreference([gpt56, gpt6], saved, 'Medium', gpt56).key, gpt56.key);
  assert.equal(resolveCurrentModelPreference([gpt56, gpt6], saved, '5.6 中', gpt56).key, gpt56.key);
  assert.equal(resolveCurrentModelPreference([gpt56, gpt6], saved, 'Medium'), null);
  assert.equal(resolveCurrentModelPreference([{ ...gpt56, checked: true }, { ...gpt6, checked: true }], saved, 'Medium'), null);
  assert.equal(resolveCurrentModelPreference([gpt56, gpt6], saved, 'GPT-6 · Medium', gpt56), null);
});

test('只有用户可信的模型与强度操作会被识别为手动选择', () => {
  assert.equal(isManualNativeAction({ isTrusted: true, type: 'pointerdown' }, 'model'), true);
  assert.equal(isManualNativeAction({ isTrusted: true, type: 'keydown', key: 'Enter' }, 'model'), true);
  assert.equal(isManualNativeAction({ isTrusted: true, type: 'keydown', key: 'ArrowRight' }, 'effort'), true);
  assert.equal(isManualNativeAction({ isTrusted: false, type: 'click' }, 'model'), false);
  assert.equal(isManualNativeAction({ isTrusted: false, type: 'keydown', key: 'ArrowRight' }, 'effort'), false);
  assert.equal(isManualNativeAction({ isTrusted: true, type: 'change' }, 'model'), false);
});

test('账号限额和权限提示会使模型不可用', () => {
  const model = createModelOption({ label: 'GPT-6', reason: '已锁定，打开访问权限选项；已达到使用限额' });
  assert.equal(isLimitHint(model.reason), true);
  assert.equal(model.disabled, true);
  assert.equal(model.availability.state, 'limited-and-permission');
  assert.equal(modelAvailabilityLabel(model), '已锁定，打开访问权限选项；已达到使用限额');
  assert.equal(classifyModelAvailability('已达到使用限额').state, 'limited');
  assert.equal(classifyModelAvailability('需要访问权限').state, 'permission');
  assert.equal(classifyModelAvailability('').state, 'available');
  assert.equal(createModelOption({ label: 'GPT-5.6 Sol' }).disabled, false);
});

test('GPT-5.6 当前名称可见，但没有选项或写入契约时诚实地禁用切换', () => {
  const row = effortRowPresentation({
    selected: true,
    model: createModelOption({ label: 'GPT-5.6 Sol' }),
    observedLabel: 'Medium',
    options: [],
    writerAvailable: false
  });
  assert.deepEqual(row, {
    label: 'Medium',
    disabled: true,
    title: '无法切换：未发现可确认的强度写入接口'
  });
});

test('重复模型标识无法由精确查找器猜测', () => {
  const a = createModelOption({ label: 'Duplicate', stableId: 'same' });
  const b = createModelOption({ label: 'Duplicate 2', stableId: 'same' });
  assert.equal(findModel([a, b], { modelKey: 'id:same', modelLabel: 'Duplicate' }), null);
});

test('ChatGPT 路由能解析普通会话、项目会话和新草稿', () => {
  assert.equal(context('/c/abc-123'), 'chat:abc-123');
  assert.equal(context('/g/project/c/abc'), 'chat:abc');
  assert.equal(context('/'), 'draft:/');
  assert.equal(context('/g/project'), 'draft:/g/project');
});
