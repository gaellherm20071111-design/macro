const { app, BrowserWindow, ipcMain, globalShortcut, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let overlayWindow = null;
let overlayReady = false;
let macrosStorePath;
let settingsPath;
let playShortcutKey = null;
let recordShortcutKey = null;
let isRecording = false;

// On macOS Retina displays, uiohook-napi may report physical pixel coordinates
// while Electron/robotjs use logical pixels. Normalize to logical pixels.
function toLogical(value, scaleFactor) {
  return scaleFactor > 1 ? Math.round(value / scaleFactor) : value;
}

function normalizeMouseCoords(actions) {
  const { scaleFactor, bounds } = screen.getPrimaryDisplay();
  if (scaleFactor <= 1) return actions;
  // Only apply if any coordinate exceeds logical bounds (proof of physical pixels)
  const needsScaling = actions.some(
    a => a.type === 'mouseMove' && (a.x > bounds.width || a.y > bounds.height)
  );
  if (!needsScaling) return actions;
  return actions.map(a => {
    if (a.type === 'mouseMove') {
      return { ...a, x: toLogical(a.x, scaleFactor), y: toLogical(a.y, scaleFactor) };
    }
    return a;
  });
}

function logicalMouseCoords(x, y) {
  const { scaleFactor, bounds } = screen.getPrimaryDisplay();
  if (scaleFactor <= 1) return { x, y };
  if (x > bounds.width || y > bounds.height) {
    return { x: toLogical(x, scaleFactor), y: toLogical(y, scaleFactor) };
  }
  return { x, y };
}

function createOrShowOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayReady = true;
    overlayWindow.show();
    return;
  }
  overlayReady = false;
  overlayWindow = new BrowserWindow({
    width: 140,
    height: 28,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.webContents.once('did-finish-load', () => {
    overlayReady = true;
    overlayWindow.show();
  });
  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));
}

function hideOverlay() {
  overlayReady = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

function sendOverlayCoords(x, y) {
  if (!overlayReady || !overlayWindow || overlayWindow.isDestroyed()) return;
  const logical = logicalMouseCoords(x, y);
  overlayWindow.setPosition(Math.round(logical.x) - 70, Math.round(logical.y) - 38);
  overlayWindow.webContents.send('overlay:coords', logical);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function readMacros() {
  try {
    if (!fs.existsSync(macrosStorePath)) return { macros: [] };
    const raw = fs.readFileSync(macrosStorePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.macros)) return { macros: [] };
    return parsed;
  } catch {
    return { macros: [] };
  }
}

function writeMacros(data) {
  fs.mkdirSync(path.dirname(macrosStorePath), { recursive: true });
  fs.writeFileSync(macrosStorePath, JSON.stringify(data, null, 2), 'utf8');
}

function readSettings() {
  try {
    if (!fs.existsSync(settingsPath)) return {};
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(data) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
}

function registerPlayShortcut(accelerator) {
  if (playShortcutKey) {
    try { globalShortcut.unregister(playShortcutKey); } catch (_) {}
    playShortcutKey = null;
  }
  if (!accelerator) return;
  try {
    globalShortcut.register(accelerator, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shortcut:trigger');
      }
    });
    playShortcutKey = accelerator;
  } catch (e) {
    console.error('Failed to register play shortcut:', accelerator, e.message);
  }
}

function acceleratorToRecorderKey(accelerator) {
  const parts = accelerator.split('+');
  const modAliases = { ctrl: 'ctrl', control: 'ctrl', command: 'command', meta: 'command', alt: 'alt', shift: 'shift' };
  const mods = [];
  let key = null;
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (modAliases[lower]) mods.push(modAliases[lower]);
    else key = lower;
  }
  return { key, modifiers: mods };
}

function filterShortcutAction(actions, accelerator) {
  if (!actions.length || !accelerator) return actions;
  const { key, modifiers } = acceleratorToRecorderKey(accelerator);
  if (!key) return actions;
  const last = actions[actions.length - 1];
  if (last.type === 'keyTap' && last.key === key) {
    const lastMods = [...(last.modifiers || [])].sort().join(',');
    const accelMods = [...modifiers].sort().join(',');
    if (lastMods === accelMods) return actions.slice(0, -1);
  }
  return actions;
}

function toggleGlobalRecording(accelerator) {
  if (!isRecording) {
    isRecording = true;
    const { startRecording } = require('./recorder');
    createOrShowOverlay();
    startRecording((act) => {
      if (act.type === 'mouseMove') sendOverlayCoords(act.x, act.y);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recording:event', act);
      }
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording:globalStart');
    }
  } else {
    isRecording = false;
    const { stopRecording } = require('./recorder');
    hideOverlay();
    const result = stopRecording();
    const filtered = filterShortcutAction(result.actions, accelerator);
    const normalized = normalizeMouseCoords(filtered);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording:globalStop', { ...result, actions: normalized });
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

function registerRecordShortcut(accelerator) {
  if (recordShortcutKey) {
    try { globalShortcut.unregister(recordShortcutKey); } catch (_) {}
    recordShortcutKey = null;
  }
  if (!accelerator) return;
  try {
    globalShortcut.register(accelerator, () => toggleGlobalRecording(accelerator));
    recordShortcutKey = accelerator;
  } catch (e) {
    console.error('Failed to register record shortcut:', accelerator, e.message);
  }
}

app.whenReady().then(() => {
  macrosStorePath = path.join(app.getPath('userData'), 'macros.json');
  settingsPath = path.join(app.getPath('userData'), 'settings.json');

  createWindow();

  const settings = readSettings();
  if (settings.shortcut) registerPlayShortcut(settings.shortcut);
  if (settings.recordShortcut) registerRecordShortcut(settings.recordShortcut);

  ipcMain.handle('macros:list', () => readMacros());

  ipcMain.handle('macros:saveAll', (e, payload) => {
    writeMacros(payload);
    return { ok: true };
  });

  ipcMain.handle('settings:get', () => readSettings());

  ipcMain.handle('settings:set', (e, data) => {
    const current = readSettings();
    writeSettings({ ...current, ...data });
    return { ok: true };
  });

  ipcMain.handle('shortcut:set', (e, accelerator) => {
    registerPlayShortcut(accelerator);
    const current = readSettings();
    writeSettings({ ...current, shortcut: accelerator || null });
    return { ok: true };
  });

  ipcMain.handle('recordShortcut:set', (e, accelerator) => {
    registerRecordShortcut(accelerator);
    const current = readSettings();
    writeSettings({ ...current, recordShortcut: accelerator || null });
    return { ok: true };
  });

  ipcMain.handle('dialog:openFile', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Macro JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths?.length) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('dialog:saveFile', async () => {
    const r = await dialog.showSaveDialog({
      filters: [{ name: 'Macro JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    return r.filePath;
  });

  ipcMain.handle('recording:start', () => {
    const { startRecording } = require('./recorder');
    isRecording = true;
    createOrShowOverlay();
    startRecording((act) => {
      if (act.type === 'mouseMove') sendOverlayCoords(act.x, act.y);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recording:event', act);
      }
    });
    return { ok: true };
  });

  ipcMain.handle('recording:stop', () => {
    const { stopRecording } = require('./recorder');
    isRecording = false;
    hideOverlay();
    const result = stopRecording();
    return { ...result, actions: normalizeMouseCoords(result.actions) };
  });

  ipcMain.handle('macro:execute', async (e, macro) => {
    const { executeMacro } = require('./executor');
    await executeMacro(macro, {
      speedFactor: 1,
      onMousePos: (x, y) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mouse:position', { x, y });
        }
      },
    });
    return { ok: true };
  });

  ipcMain.handle('macro:cancel', () => {
    const { cancelExecution } = require('./executor');
    cancelExecution();
    return { ok: true };
  });

  ipcMain.handle('window:hideForExecution', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });

  ipcMain.handle('window:showAfterExecution', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
