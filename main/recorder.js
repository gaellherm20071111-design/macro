const { uIOhook, UiohookKey } = require('uiohook-napi');

const KEYCODE_MAP = {
  [UiohookKey.Backspace]: 'backspace',
  [UiohookKey.Tab]: 'tab',
  [UiohookKey.Enter]: 'enter',
  [UiohookKey.CapsLock]: 'capslock',
  [UiohookKey.Escape]: 'escape',
  [UiohookKey.Space]: 'space',
  [UiohookKey.PageUp]: 'pageup',
  [UiohookKey.PageDown]: 'pagedown',
  [UiohookKey.End]: 'end',
  [UiohookKey.Home]: 'home',
  [UiohookKey.ArrowLeft]: 'left',
  [UiohookKey.ArrowUp]: 'up',
  [UiohookKey.ArrowRight]: 'right',
  [UiohookKey.ArrowDown]: 'down',
  [UiohookKey.Insert]: 'insert',
  [UiohookKey.Delete]: 'delete',
  [UiohookKey.Digit0]: '0', [UiohookKey.Digit1]: '1', [UiohookKey.Digit2]: '2',
  [UiohookKey.Digit3]: '3', [UiohookKey.Digit4]: '4', [UiohookKey.Digit5]: '5',
  [UiohookKey.Digit6]: '6', [UiohookKey.Digit7]: '7', [UiohookKey.Digit8]: '8',
  [UiohookKey.Digit9]: '9',
  [UiohookKey.KeyA]: 'a', [UiohookKey.KeyB]: 'b', [UiohookKey.KeyC]: 'c',
  [UiohookKey.KeyD]: 'd', [UiohookKey.KeyE]: 'e', [UiohookKey.KeyF]: 'f',
  [UiohookKey.KeyG]: 'g', [UiohookKey.KeyH]: 'h', [UiohookKey.KeyI]: 'i',
  [UiohookKey.KeyJ]: 'j', [UiohookKey.KeyK]: 'k', [UiohookKey.KeyL]: 'l',
  [UiohookKey.KeyM]: 'm', [UiohookKey.KeyN]: 'n', [UiohookKey.KeyO]: 'o',
  [UiohookKey.KeyP]: 'p', [UiohookKey.KeyQ]: 'q', [UiohookKey.KeyR]: 'r',
  [UiohookKey.KeyS]: 's', [UiohookKey.KeyT]: 't', [UiohookKey.KeyU]: 'u',
  [UiohookKey.KeyV]: 'v', [UiohookKey.KeyW]: 'w', [UiohookKey.KeyX]: 'x',
  [UiohookKey.KeyY]: 'y', [UiohookKey.KeyZ]: 'z',
  [UiohookKey.F1]: 'f1', [UiohookKey.F2]: 'f2', [UiohookKey.F3]: 'f3',
  [UiohookKey.F4]: 'f4', [UiohookKey.F5]: 'f5', [UiohookKey.F6]: 'f6',
  [UiohookKey.F7]: 'f7', [UiohookKey.F8]: 'f8', [UiohookKey.F9]: 'f9',
  [UiohookKey.F10]: 'f10', [UiohookKey.F11]: 'f11', [UiohookKey.F12]: 'f12',
};

const MODIFIER_KEYCODES = new Set([
  UiohookKey.Ctrl, UiohookKey.CtrlRight,
  UiohookKey.Alt, UiohookKey.AltRight,
  UiohookKey.Shift, UiohookKey.ShiftRight,
  UiohookKey.Meta, UiohookKey.MetaRight,
]);

const MODIFIER_NAMES = {
  [UiohookKey.Ctrl]: 'ctrl', [UiohookKey.CtrlRight]: 'ctrl',
  [UiohookKey.Alt]: 'alt', [UiohookKey.AltRight]: 'alt',
  [UiohookKey.Shift]: 'shift', [UiohookKey.ShiftRight]: 'shift',
  [UiohookKey.Meta]: 'command', [UiohookKey.MetaRight]: 'command',
};

let recording = false;
let active = false; // uIOhook started
let actions = [];
let lastT = null;
let lastMouseT = null;
let heldModifiers = new Set();
let onEventCallback = null;

const MOUSE_THROTTLE_MS = 50;

function pushAction(act) {
  const t = Date.now();
  act.delayMs = Math.max(0, t - lastT);
  lastT = t;
  actions.push(act);
  if (onEventCallback) onEventCallback(act);
}

uIOhook.on('mousemove', (e) => {
  if (!recording) return;
  const t = Date.now();
  if (lastMouseT && t - lastMouseT < MOUSE_THROTTLE_MS) return;
  lastMouseT = t;
  pushAction({ type: 'mouseMove', x: e.x, y: e.y });
});

uIOhook.on('mousedown', (e) => {
  if (!recording) return;
  const button = e.button === 2 ? 'right' : e.button === 3 ? 'middle' : 'left';
  pushAction({ type: 'mouseDown', button });
});

uIOhook.on('mouseup', (e) => {
  if (!recording) return;
  const button = e.button === 2 ? 'right' : e.button === 3 ? 'middle' : 'left';
  pushAction({ type: 'mouseUp', button });
});

uIOhook.on('keydown', (e) => {
  if (MODIFIER_KEYCODES.has(e.keycode)) {
    const name = MODIFIER_NAMES[e.keycode];
    if (name) heldModifiers.add(name);
    return;
  }
  if (!recording) return;
  const key = KEYCODE_MAP[e.keycode];
  if (!key) return;
  pushAction({ type: 'keyTap', key, modifiers: [...heldModifiers] });
});

uIOhook.on('keyup', (e) => {
  const name = MODIFIER_NAMES[e.keycode];
  if (name) heldModifiers.delete(name);
});

function startRecording(onEvent) {
  if (active) stopRecording();
  recording = true;
  active = true;
  actions = [];
  heldModifiers = new Set();
  lastT = Date.now();
  lastMouseT = null;
  onEventCallback = onEvent || null;
  uIOhook.start();
}

function stopRecording() {
  recording = false;
  if (active) {
    try { uIOhook.stop(); } catch (_) {}
    active = false;
  }
  onEventCallback = null;
  return {
    actions: actions.slice(),
    durationMs: actions.reduce((acc, a) => acc + (a.delayMs || 0), 0),
  };
}

module.exports = { startRecording, stopRecording };
