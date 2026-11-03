// ==UserScript==
// @name         ChatGPT 固定 5.6 与手动档位
// @namespace    local.chatgpt-preference
// @version      0.2.1
// @description  默认 GPT-5.6 Sol + Medium，纠正模型偏移并按聊天保留手动强度。
// @match        https://chatgpt.com/*
// @run-at       document-end
// @inject-into  content
// @grant        none
// @noframes
// ==/UserScript==
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document && root.top === root.self) api.start(root);
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const VERSION = '0.2.1';
  const PREFIX = 'chatgpt-56-preference-v1:';
  const PICKER = 'button[aria-label="选择 ChatGPT 模型"],button[aria-label="Select ChatGPT model"]';
  const CHOOSER = '[role="menuitem"][aria-label="选择模型"],[role="menuitem"][aria-label="Choose model"],[role="menuitem"][aria-label="Select model"]';
  const LEVELS = [
    { value: 0, label: '低' },
    { value: 1, label: '中' },
    { value: 2, label: '高' },
    { value: 3, label: '极高' },
    { value: 4, label: '最高' }
  ];
  const valid = n => Number.isInteger(n) && n >= 0 && n <= 4;
  const normalize = s => String(s || '').replace(/\s+/g, ' ').trim();
  function context(path) {
    const match = path.match(/(?:^|\/)c\/([a-zA-Z0-9-]+)(?:\/|$)/);
    return match ? 'chat:' + match[1] : 'draft:' + path;
  }
  function effort(text) {
    text = normalize(text);
    if (/\b(?:extra\s*high|xhigh)\b|极高/i.test(text)) return 3;
    if (/\b(?:max|pro)\b|最大|最高|专业/i.test(text)) return 4;
    if (/\bmed(?:ium)?\b|中等|中/i.test(text)) return 1;
    if (/\bhigh\b|高/i.test(text)) return 2;
    if (/\b(?:instant|low|none)\b|即时|低|无推理/i.test(text)) return 0;
    return null;
  }
  function is56(text) { return /\b5\.6\b/.test(text); }
  function shouldMigrate(from, to, pending, now) {
    return from.startsWith('draft:') && to.startsWith('chat:') && !!pending &&
      pending.from === from && now - pending.time >= 0 && now - pending.time < 30000;
  }
  function interrupted(epoch, serial, path, key, hidden) {
    return epoch !== serial || context(path) !== key || hidden;
  }
  class Preferences {
    constructor(local, session) { this.local = local; this.session = session; }
    storage(key) { return key.startsWith('chat:') ? this.local : this.session; }
    read(key) {
      const raw = this.storage(key).getItem(PREFIX + key);
      if (raw === null) return null;
      try { const item = JSON.parse(raw); return valid(item.level) ? item.level : null; }
      catch (_) { return null; }
    }
    desired(key) { return this.read(key) ?? 1; }
    save(key, level) {
      if (!valid(level)) throw new Error('无法识别强度档位');
      this.storage(key).setItem(PREFIX + key, JSON.stringify({ level }));
    }
    resetDraft(key) {
      if (key.startsWith('draft:')) this.session.removeItem(PREFIX + key);
    }
    migrate(from, to) {
      if (!from.startsWith('draft:') || !to.startsWith('chat:')) return;
      const level = this.read(from);
      if (level !== null && this.read(to) === null) this.save(to, level);
      this.resetDraft(from);
    }
  }
  function start(win) {
    const doc = win.document;
    if (doc.documentElement.dataset.chatgpt56Version) return;
    doc.documentElement.dataset.chatgpt56Version = VERSION;
    const prefs = new Preferences(win.localStorage, win.sessionStorage);
    let key = context(win.location.pathname), timer, working = false;
    let serial = 0, lastInput = 0, pointerDown = false, composing = false;
    let manualUntil = 0, manualKey = key, manualBaseline = null, manualArmed = false, manualToken = 0;
    let pendingSend = null, blocked = '', verified = '', previousButton, userOwnsMenu = false, panelUi = null;
    const visible = e => !!e && e.isConnected && e.getClientRects().length > 0 &&
      win.getComputedStyle(e).visibility !== 'hidden';
    const picker = () => [...doc.querySelectorAll(PICKER)].find(visible);
    const slider = () => [...doc.querySelectorAll('[role="menu"] [role="slider"]')].find(visible);
    const menus = () => [...doc.querySelectorAll('[role="menu"],[role="dialog"]')].filter(visible);
    const option = () => {
      const matches = [...doc.querySelectorAll('[role="menuitemradio"]')]
        .filter(e => /^GPT[-\s]*5\.6\s+Sol$/i.test(normalize(e.textContent)));
      return matches.length === 1 ? matches[0] : null;
    };
    const expanded = button => button.getAttribute('aria-expanded') === 'true';
    const disabled = e => !e || e.matches(':disabled,[aria-disabled="true"],[data-disabled]:not([data-disabled="false"])');
    const signature = button => key + '|' + normalize(button.textContent) + '|' + prefs.desired(key);
    const status = (button, value) => { const current = picker() || button; if (current) { current.setAttribute('data-chatgpt-56-status', value); current.title = '5.6 偏好：' + value; } };
    function refreshPanel() {
      if (!panelUi) return;
      if (context(win.location.pathname) !== key) route();
      const level = prefs.desired(key);
      const label = LEVELS[level]?.label || LEVELS[1].label;
      panelUi.launcher.textContent = '5.6 · ' + label;
      panelUi.launcher.setAttribute('aria-label', 'GPT-5.6 强度：' + label + '。打开档位设置');
      panelUi.choices.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.level) === level)));
    }
    function mountPanel() {
      if (panelUi) {
        if (!panelUi.host.isConnected && doc.body) doc.body.append(panelUi.host);
        return;
      }
      if (!doc.body) { win.setTimeout(mountPanel, 80); return; }
      if (!doc.createElement || !win.Element?.prototype?.attachShadow) return;
      const host = doc.createElement('div');
      host.dataset.chatgpt56Panel = VERSION;
      const shadow = host.attachShadow({ mode: 'open' });
      const style = doc.createElement('style');
      style.textContent = `
        :host { all: initial; position: fixed; display: block; width: max-content; z-index: 2147483647; right: 16px; bottom: 112px; color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        button { font: inherit; }
        .launcher { display: block; min-height: 40px; padding: 0 13px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; background: #202329; color: #f5f6f8; box-shadow: 0 4px 18px rgba(0,0,0,.26); font-size: 13px; font-weight: 600; cursor: pointer; }
        .launcher:hover, .launcher:focus-visible { background: #2a3039; outline: 2px solid #80b8ff; outline-offset: 2px; }
        .panel { position: absolute; right: 0; bottom: calc(100% + 10px); width: min(326px, calc(100vw - 24px)); padding: 15px; border: 1px solid rgba(255,255,255,.14); border-radius: 16px; background: rgba(31,34,40,.98); color: #f4f5f7; box-shadow: 0 12px 36px rgba(0,0,0,.34); backdrop-filter: blur(14px); }
        .panel[hidden] { display: none; }
        .heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; font-size: 15px; font-weight: 650; }
        .close { width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: #c7cbd2; font-size: 20px; cursor: pointer; }
        .close:hover, .close:focus-visible { background: #393e47; color: #fff; outline: 2px solid #80b8ff; }
        .hint { margin: 0 0 13px; color: #b9bec8; font-size: 12px; line-height: 1.45; }
        .choices { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
        .choice { min-width: 0; min-height: 39px; padding: 0 3px; border: 1px solid #484e59; border-radius: 9px; background: #292d35; color: #e4e7ec; font-size: 12px; cursor: pointer; }
        .choice:hover, .choice:focus-visible { border-color: #83b8ff; outline: none; }
        .choice[aria-pressed="true"] { border-color: #72afff; background: #244c79; color: #fff; box-shadow: inset 0 0 0 1px #72afff; }
        .foot { margin: 11px 1px 0; color: #9299a5; font-size: 11px; line-height: 1.4; }
        @media (max-height: 520px) { :host { bottom: 78px; } }
        @media (prefers-reduced-motion: no-preference) { .panel { animation: appear .12s ease-out; } @keyframes appear { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } } }
      `;
      const launcher = doc.createElement('button');
      launcher.type = 'button'; launcher.className = 'launcher'; launcher.setAttribute('aria-expanded', 'false');
      launcher.setAttribute('aria-haspopup', 'dialog');
      const panel = doc.createElement('section');
      panel.className = 'panel'; panel.id = 'chatgpt56-effort-panel'; panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'GPT-5.6 思考强度设置'); panel.hidden = true;
      const heading = doc.createElement('div'); heading.className = 'heading';
      const title = doc.createElement('span'); title.textContent = '选择思考强度';
      const close = doc.createElement('button'); close.type = 'button'; close.className = 'close';
      close.setAttribute('aria-label', '关闭档位设置'); close.textContent = '×';
      heading.append(title, close);
      const hint = doc.createElement('p'); hint.className = 'hint';
      hint.textContent = '此档位按聊天保存；没有记录的新聊天默认使用“中”。';
      const choicesBox = doc.createElement('div'); choicesBox.className = 'choices';
      choicesBox.setAttribute('role', 'group'); choicesBox.setAttribute('aria-label', '可选强度');
      const choiceButtons = LEVELS.map(item => {
        const button = doc.createElement('button');
        button.type = 'button'; button.className = 'choice'; button.dataset.level = String(item.value);
        button.textContent = item.label; button.title = '设为' + item.label;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
          route();
          try {
            prefs.save(key, item.value);
            verified = ''; blocked = ''; manualArmed = false; manualUntil = 0; manualToken++;
            refreshPanel(); setPanelOpen(false, true);
            status(picker(), '已选择' + item.label + '，正在应用');
            schedule(1600);
          } catch (error) {
            console.warn('[ChatGPT 5.6]', error.message);
          }
        });
        choicesBox.append(button);
        return button;
      });
      const foot = doc.createElement('div'); foot.className = 'foot';
      foot.textContent = '也可以直接使用 ChatGPT 原生滑杆调整。';
      panel.append(heading, hint, choicesBox, foot);
      shadow.append(style, launcher, panel);
      panelUi = { host, shadow, launcher, panel, close, choices: choiceButtons };
      function setPanelOpen(open, returnFocus = false) {
        panel.hidden = !open;
        launcher.setAttribute('aria-expanded', String(open));
        if (open) refreshPanel();
        else if (returnFocus) launcher.focus({ preventScroll: true });
      }
      launcher.setAttribute('aria-controls', panel.id);
      launcher.addEventListener('click', () => setPanelOpen(panel.hidden));
      close.addEventListener('click', () => setPanelOpen(false, true));
      shadow.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); setPanelOpen(false, true); }
      });
      doc.body.append(host);
      refreshPanel();
    }
    const editable = e => !!e && !!e.closest('textarea,input:not([type="range"]),[contenteditable="true"]');
    const strengthControl = e => e && e.closest('[role="slider"],[role="menuitem"][aria-label="强度"],[role="menuitem"][aria-label="Effort"]');
    function captureManual() {
      if (context(win.location.pathname) !== key) { route(); return; }
      if (working || !manualArmed || Date.now() > manualUntil || manualKey !== key) return;
      const s = slider();
      if (!s) return;
      const level = Number(s.getAttribute('aria-valuenow'));
      if (s.getAttribute('aria-valuemin') !== '0' || s.getAttribute('aria-valuemax') !== '4' || !valid(level)) return;
      if (level === manualBaseline) return;
      try { prefs.save(key, level); manualBaseline = level; verified = ''; refreshPanel(); } catch (error) { console.warn('[ChatGPT 5.6]', error.message); }
    }
    function resetNewChat() {
      prefs.resetDraft(context(win.location.pathname.split('/c/')[0] || '/'));
      prefs.resetDraft('draft:/'); verified = ''; pendingSend = null; refreshPanel();
    }
    function interaction(event) {
      if (!event.isTrusted) return;
      route();
      serial++;
      const inMenu = event.target.closest('[role="menu"],' + PICKER);
      const modifier = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock'].includes(event.key);
      if (working && inMenu && (['pointerdown', 'click'].includes(event.type) || (event.type === 'keydown' && !modifier))) userOwnsMenu = true;
      lastInput = Date.now();
      if (event.type === 'pointerdown') pointerDown = true;
      if (event.type === 'pointerup' || event.type === 'pointercancel') pointerDown = false;
      const adjusts = event.type === 'pointerdown' || (event.type === 'keydown' &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key));
      if (adjusts && strengthControl(event.target)) {
        const s = slider();
        if (s) {
          manualBaseline = Number(s.getAttribute('aria-valuenow'));
          manualArmed = valid(manualBaseline); manualKey = key; manualToken++;
          manualUntil = Date.now() + 1800;
          win.setTimeout(captureManual, 100);
          win.setTimeout(captureManual, 500);
        }
      }
      if (manualArmed && (event.type === 'pointerup' || event.type === 'keyup')) {
        manualUntil = Date.now() + 1000;
        const token = manualToken;
        win.setTimeout(captureManual, 100);
        win.setTimeout(() => { captureManual(); if (manualToken === token) manualArmed = false; }, 700);
      }
      if (event.type === 'keydown' && (event.metaKey || event.ctrlKey) && event.shiftKey &&
          !event.altKey && String(event.key).toLowerCase() === 'o') resetNewChat();
      const control = event.target.closest('button,a');
      const sendClick = event.type === 'click' && control &&
        (control.getAttribute('data-testid') === 'send-button' ||
         /^(?:发送|发送提示|Send prompt|Send message)$/i.test(normalize(control.getAttribute('aria-label'))));
      const sendEnter = event.type === 'keydown' && event.key === 'Enter' &&
        !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && !composing &&
        event.target.closest('textarea,[contenteditable="true"]');
      // Observe only the user's send gesture; never read or submit its contents.
      if (key.startsWith('draft:') && (sendClick || sendEnter)) pendingSend = { from: key, time: Date.now() };
      if (event.type === 'click' && control) {
        if (control.matches('a')) pendingSend = null;
        if (/^(?:新聊天|New chat)$/i.test(normalize(control.getAttribute('aria-label') || control.textContent))) {
          resetNewChat();
        }
      }
      schedule(1500);
    }
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'keydown', 'keyup', 'click', 'input'])
      doc.addEventListener(type, interaction, true);
    doc.addEventListener('compositionstart', () => { composing = true; }, true);
    doc.addEventListener('compositionend', () => { composing = false; lastInput = Date.now(); schedule(1500); }, true);
    function route() {
      const next = context(win.location.pathname);
      if (next !== key) {
        if (shouldMigrate(key, next, pendingSend, Date.now())) prefs.migrate(key, next);
        pendingSend = null; key = next; verified = ''; blocked = ''; manualUntil = 0; manualArmed = false;
        refreshPanel();
      }
    }
    function busy() {
      return doc.readyState !== 'complete' || doc.hidden || pointerDown || composing ||
        (!!panelUi && !panelUi.panel.hidden) || Date.now() - lastInput < 1400 ||
        !!doc.querySelector('button[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="停止流式传输"]');
    }
    const delay = ms => new Promise(resolve => win.setTimeout(resolve, ms));
    async function waitFor(fn, check) {
      for (let i = 0; i < 25; i++) {
        check();
        const value = fn();
        if (value) return value;
        await delay(80);
      }
      throw new Error('控件没有按预期更新，已停止本轮操作');
    }
    async function reconcile() {
      route();
      if (working || busy()) return;
      const button = picker();
      if (!button || disabled(button)) return;
      if (button !== previousButton) { previousButton = button; verified = ''; blocked = ''; }
      const sig = signature(button);
      const label = normalize(button.textContent);
      const desired = prefs.desired(key);
      if (verified === sig || blocked === sig) return;
      if (is56(label) && effort(label) === desired && verified.startsWith(key + '|')) {
        verified = sig; status(button, 'verified'); return;
      }
      // Never take ownership of a menu the user opened.
      if (expanded(button) || menus().length) return;
      working = true; userOwnsMenu = false;
      const epoch = serial, routeKey = key, oldFocus = doc.activeElement;
      let owned = false, failure = null;
      const cancelled = () => interrupted(epoch, serial, win.location.pathname, routeKey, doc.hidden) || prefs.desired(routeKey) !== desired;
      function check() {
        if (cancelled())
          throw new Error('用户开始操作，已让出控件');
      }
      function click(e) {
        check();
        if (!visible(e) || disabled(e)) throw new Error('目标选项不可用，未替换成其他模型');
        e.click();
      }
      async function close() {
        for (let i = 0; i < 2 && owned && !userOwnsMenu && context(win.location.pathname) === routeKey; i++) {
          const target = menus().find(e => e.matches('[role="menu"]') &&
            (e.querySelector(CHOOSER) || (option() && e.contains(option()))));
          if (!target) break;
          // Dismiss only our menu via an inert outside target. Escape can also
          // invoke the composer's mode-removal shortcut after a native rerender.
          const outside = doc.createElement('span');
          outside.hidden = true;
          doc.documentElement.append(outside);
          try {
            outside.dispatchEvent(new win.PointerEvent('pointerdown', {
              pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0,
              buttons: 1, bubbles: true, cancelable: true, composed: true
            }));
            await delay(80);
          } finally { outside.remove(); }
        }
      }
      async function open() {
        click(picker()); owned = true;
        return waitFor(() => [...doc.querySelectorAll(CHOOSER)].find(visible), check);
      }
      try {
        const choose = await open();
        click(choose);
        const target = await waitFor(() => { const e = option(); return visible(e) && e; }, check);
        if (target.getAttribute('aria-checked') !== 'true') click(target);
        await delay(100); check();
        if (option()?.getAttribute('aria-checked') !== 'true') {
          // Some versions unmount the whole menu on selection. Reopen it to
          // confirm the native checked state, then continue with effort.
          await close();
          const confirmChooser = await open();
          click(confirmChooser);
          const confirmed = await waitFor(() => { const e = option(); return visible(e) && e; }, check);
          if (confirmed.getAttribute('aria-checked') !== 'true') throw new Error('目标模型未被选中');
        }
        // Return to the parent effort control through the same native trigger.
        await close();
        await delay(100); check();
        await open();
        let s = await waitFor(slider, check);
        if (s.getAttribute('aria-valuemin') !== '0' || s.getAttribute('aria-valuemax') !== '4')
          throw new Error('网页的强度范围已改变，未猜测档位');
        for (let i = 0; i < 5; i++) {
          const now = Number(s.getAttribute('aria-valuenow'));
          if (!valid(now)) throw new Error('无法读取强度');
          if (now === desired) break;
          check();
          s.focus({ preventScroll: true });
          const direction = now < desired ? 'ArrowRight' : 'ArrowLeft';
          s.dispatchEvent(new win.KeyboardEvent('keydown', { key: direction, code: direction, bubbles: true, cancelable: true }));
          await waitFor(() => Number(slider()?.getAttribute('aria-valuenow')) !== now, check);
          s = slider();
        }
        if (Number(s.getAttribute('aria-valuenow')) !== desired || !is56(normalize(picker()?.textContent)))
          throw new Error('模型或强度未通过读取确认');
        check();
        verified = signature(picker()); blocked = ''; status(button, '已确认模型和档位');
      } catch (error) {
        failure = error;
        if (!cancelled()) {
          blocked = signature(picker() || button); status(button, '暂停：' + error.message);
          console.warn('[ChatGPT 5.6]', error.message);
        } else {
          blocked = '';
        }
      } finally {
        await close();
        if (!cancelled() && oldFocus?.isConnected && editable(oldFocus)) oldFocus.focus({ preventScroll: true });
        working = false;
        if (failure && cancelled()) schedule(1600);
      }
    }
    function schedule(ms = 450) {
      if (working) return;
      win.clearTimeout(timer);
      timer = win.setTimeout(() => reconcile().catch(error => console.warn('[ChatGPT 5.6]', error.message)), ms);
    }
    new win.MutationObserver(records => {
      if (panelUi && !panelUi.host.isConnected) mountPanel();
      for (const r of records) {
        if (r.type === 'attributes' && r.attributeName === 'aria-valuenow') captureManual();
      }
      schedule();
    }).observe(doc.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['aria-valuenow', 'aria-checked', 'aria-expanded', 'disabled']
    });
    win.addEventListener('storage', event => { if (event.key?.startsWith(PREFIX)) { refreshPanel(); schedule(); } });
    win.addEventListener('popstate', () => { pendingSend = null; schedule(); });
    win.addEventListener('blur', () => { pointerDown = false; });
    doc.addEventListener('visibilitychange', () => schedule());
    win.setInterval(() => { route(); schedule(100); }, 1800);
    schedule(1200);
    mountPanel();
  }
  return { Preferences, context, effort, is56, shouldMigrate, interrupted, start };
});
