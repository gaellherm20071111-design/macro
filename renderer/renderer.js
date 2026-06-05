const { ipcRenderer } = require('electron');
const fs = require('fs');

let store = { macros: [] };
let currentMacroId = null;
let recording = false;
let recordingBuffer = null;
let macroPlaying = false;
let capturingShortcut = false;
let currentShortcut = null;
let capturingRecordShortcut = false;
let currentRecordShortcut = null;

const els = {
  status: document.getElementById('status'),
  macroName: document.getElementById('macroName'),
  btnCreate: document.getElementById('btnCreate'),
  macroSelect: document.getElementById('macroSelect'),
  btnDelete: document.getElementById('btnDelete'),

  btnRecordStart: document.getElementById('btnRecordStart'),
  btnRecordStop: document.getElementById('btnRecordStop'),

  actionType: document.getElementById('actionType'),
  actionDelayH:  document.getElementById('actionDelay-h'),
  actionDelayM:  document.getElementById('actionDelay-m'),
  actionDelayS:  document.getElementById('actionDelay-s'),
  actionDelayMs: document.getElementById('actionDelay-ms'),
  btnAddAction: document.getElementById('btnAddAction'),

  // Dynamic action fields
  afX: document.getElementById('af-x'),
  afY: document.getElementById('af-y'),
  afButton: document.getElementById('af-button'),
  afDouble: document.getElementById('af-double'),
  afKey: document.getElementById('af-key'),
  afCtrl: document.getElementById('af-ctrl'),
  afShift: document.getElementById('af-shift'),
  afAlt: document.getElementById('af-alt'),
  afCmd: document.getElementById('af-cmd'),
  afText: document.getElementById('af-text'),

  actionsTbody: document.getElementById('actionsTbody'),
  macroMeta: document.getElementById('macroMeta'),

  mouseCoords: document.getElementById('mouseCoords'),
  btnPlay: document.getElementById('btnPlay'),
  btnExport: document.getElementById('btnExport'),
  btnImport: document.getElementById('btnImport'),

  shortcutDisplay: document.getElementById('shortcutDisplay'),
  btnShortcutSet: document.getElementById('btnShortcutSet'),
  btnShortcutClear: document.getElementById('btnShortcutClear'),
  shortcutHint: document.getElementById('shortcutHint'),

  shortcutRecordDisplay: document.getElementById('shortcutRecordDisplay'),
  btnShortcutRecordSet: document.getElementById('btnShortcutRecordSet'),
  btnShortcutRecordClear: document.getElementById('btnShortcutRecordClear'),
  shortcutRecordHint: document.getElementById('shortcutRecordHint'),
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function msToUnits(ms) {
  const totalMs = Math.round(ms);
  const msOnly  = totalMs % 1000;
  const totalS  = Math.floor(totalMs / 1000);
  const s       = totalS % 60;
  const totalM  = Math.floor(totalS / 60);
  const m       = totalM % 60;
  const h       = Math.floor(totalM / 60);
  return { h, m, s, ms: msOnly };
}

function unitsToMs(h, m, s, ms) {
  return h * 3600000 + m * 60000 + s * 1000 + ms;
}

function fmtMs(ms) {
  if (!ms) return '0 ms';
  const u = msToUnits(ms);
  const parts = [];
  if (u.h)  parts.push(`${u.h}h`);
  if (u.m)  parts.push(`${u.m}m`);
  if (u.s)  parts.push(`${u.s}s`);
  if (u.ms) parts.push(`${u.ms}ms`);
  return parts.join(' ') || '0 ms';
}

function makeDelayWidget(initialMs, onChange) {
  const u = msToUnits(initialMs);

  function inp(val, max) {
    const el = document.createElement('input');
    el.type = 'number';
    el.min = '0';
    if (max != null) el.max = String(max);
    el.value = String(val);
    el.style.cssText = 'width:38px;padding:4px 2px;font-size:11px';
    el.addEventListener('change', onChange);
    return el;
  }

  function lbl(text) {
    const s = document.createElement('span');
    s.className = 'small';
    s.style.fontSize = '11px';
    s.textContent = text;
    return s;
  }

  function row(...items) {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;gap:2px;align-items:center;margin-bottom:2px';
    items.forEach(i => r.appendChild(i));
    return r;
  }

  const inpH  = inp(u.h);
  const inpM  = inp(u.m, 59);
  const inpS  = inp(u.s, 59);
  const inpMs = inp(u.ms, 999);

  const wrap = document.createElement('div');
  wrap.appendChild(row(inpH, lbl('h'), inpM, lbl('m'), inpS, lbl('s')));
  wrap.appendChild(row(inpMs, lbl('ms')));

  return {
    el: wrap,
    getValue() {
      return unitsToMs(
        Number(inpH.value)  || 0,
        Number(inpM.value)  || 0,
        Number(inpS.value)  || 0,
        Number(inpMs.value) || 0
      );
    }
  };
}

function computeTotalDelay(actions) {
  return (actions || []).reduce((acc, a) => acc + Math.max(0, a.delayMs ?? 0), 0);
}

function renderMacroSelect() {
  els.macroSelect.innerHTML = '';
  for (const m of store.macros) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    els.macroSelect.appendChild(opt);
  }

  if (store.macros.length > 0) {
    if (!currentMacroId || !store.macros.find(x => x.id === currentMacroId)) {
      currentMacroId = store.macros[0].id;
    }
    els.macroSelect.value = currentMacroId;
  } else {
    currentMacroId = null;
  }
}

function renderActions() {
  const macro = store.macros.find(m => m.id === currentMacroId);
  els.actionsTbody.innerHTML = '';
  if (!macro) {
    els.macroMeta.textContent = 'Aucune macro sélectionnée.';
    return;
  }

  const actions = macro.actions || [];
  els.macroMeta.textContent = `Actions: ${actions.length} | Délai total: ${fmtMs(computeTotalDelay(actions))}`;

  actions.forEach((a, idx) => {
    const tr = document.createElement('tr');

    const tdIdx = document.createElement('td');
    tdIdx.textContent = String(idx + 1);

    const tdDelay = document.createElement('td');
    const delayWidget = makeDelayWidget(a.delayMs ?? 0, () => {
      a.delayMs = delayWidget.getValue();
      persistAndRerender();
    });
    tdDelay.appendChild(delayWidget.el);

    const tdType = document.createElement('td');
    tdType.innerHTML = `<span class="pill">${a.type}</span>`;

    const tdParams = document.createElement('td');
    tdParams.className = 'mono small';
    tdParams.textContent = JSON.stringify(a).replace(/"/g,'');

    const tdActions = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'actions-cell';

    const btnUp = document.createElement('button');
    btnUp.className = 'secondary';
    btnUp.textContent = '↑';
    btnUp.disabled = idx === 0;
    btnUp.addEventListener('click', () => {
      const list = macro.actions;
      [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
      persistAndRerender();
    });

    const btnDown = document.createElement('button');
    btnDown.className = 'secondary';
    btnDown.textContent = '↓';
    btnDown.disabled = idx === macro.actions.length - 1;
    btnDown.addEventListener('click', () => {
      const list = macro.actions;
      [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]];
      persistAndRerender();
    });

    const btnDel = document.createElement('button');
    btnDel.className = 'danger';
    btnDel.textContent = 'Suppr.';
    btnDel.addEventListener('click', () => {
      macro.actions.splice(idx, 1);
      persistAndRerender();
    });

    const btnInsert = document.createElement('button');
    btnInsert.className = 'secondary';
    btnInsert.textContent = '+ Après';
    btnInsert.addEventListener('click', () => {
      const newAct = { type: 'keyTap', key: 'enter', modifiers: [], delayMs: 200 };
      macro.actions.splice(idx + 1, 0, newAct);
      persistAndRerender();
    });

    wrap.appendChild(btnUp);
    wrap.appendChild(btnDown);
    wrap.appendChild(btnInsert);
    wrap.appendChild(btnDel);
    tdActions.appendChild(wrap);

    tr.appendChild(tdIdx);
    tr.appendChild(tdDelay);
    tr.appendChild(tdType);
    tr.appendChild(tdParams);
    tr.appendChild(tdActions);

    els.actionsTbody.appendChild(tr);
  });
}

async function persistAndRerender() {
  await ipcRenderer.invoke('macros:saveAll', store);
  renderActions();
}

function currentMacro() {
  return store.macros.find(m => m.id === currentMacroId);
}

function updateActionForm() {
  const type = els.actionType.value;
  for (const id of ['mouseMove', 'mouseClick', 'keyTap', 'typeText']) {
    document.getElementById('fields-' + id).style.display = (id === type) ? '' : 'none';
  }
}

function buildActionFromUI() {
  const type = els.actionType.value;
  const delayMs = unitsToMs(
    Number(els.actionDelayH.value)  || 0,
    Number(els.actionDelayM.value)  || 0,
    Number(els.actionDelayS.value)  || 0,
    Number(els.actionDelayMs.value) || 0
  );

  if (type === 'mouseMove') {
    return { type, delayMs, x: Number(els.afX.value) || 0, y: Number(els.afY.value) || 0 };
  }
  if (type === 'mouseClick') {
    return { type, delayMs, button: els.afButton.value || 'left', double: els.afDouble.checked };
  }
  if (type === 'keyTap') {
    const mods = [];
    if (els.afCtrl.checked)  mods.push('ctrl');
    if (els.afShift.checked) mods.push('shift');
    if (els.afAlt.checked)   mods.push('alt');
    if (els.afCmd.checked)   mods.push('command');
    return { type, delayMs, key: els.afKey.value.trim() || 'enter', modifiers: mods };
  }
  if (type === 'typeText') {
    return { type, delayMs, text: els.afText.value };
  }

  return { type, delayMs };
}

async function loadStore() {
  store = await ipcRenderer.invoke('macros:list');
  if (!store.macros) store = { macros: [] };
  renderMacroSelect();
  renderActions();
}

els.macroSelect.addEventListener('change', () => {
  currentMacroId = els.macroSelect.value;
  recordingBuffer = null;
  renderActions();
});

els.btnCreate.addEventListener('click', async () => {
  const name = (els.macroName.value || '').trim() || 'Nouvelle macro';
  const id = uid();
  const macro = { id, name, actions: [] };
  store.macros.push(macro);
  currentMacroId = id;
  await persistAndRerender();
  renderMacroSelect();
  renderActions();
});

els.btnDelete.addEventListener('click', async () => {
  if (!currentMacroId) return;
  store.macros = store.macros.filter(m => m.id !== currentMacroId);
  currentMacroId = store.macros[0]?.id || null;
  await persistAndRerender();
  renderMacroSelect();
  renderActions();
});

// Receive live events from the main process during recording
ipcRenderer.on('recording:event', (e, act) => {
  if (recording && recordingBuffer) {
    recordingBuffer.push(act);
    els.status.textContent = `Enregistrement... ${recordingBuffer.length} actions`;
  }
});

els.btnRecordStart.addEventListener('click', async () => {
  if (!currentMacro()) {
    els.status.textContent = "Crée une macro d'abord puis clique Démarrer.";
    return;
  }
  recording = true;
  recordingBuffer = [];
  els.btnRecordStart.disabled = true;
  els.btnRecordStop.disabled = false;
  els.status.textContent = 'Enregistrement en cours...';
  try {
    await ipcRenderer.invoke('recording:start');
  } catch (err) {
    recording = false;
    recordingBuffer = null;
    els.btnRecordStart.disabled = false;
    els.btnRecordStop.disabled = true;
    const msg = String(err?.message || err);
    const needsAccess = msg.toLowerCase().includes('accessibility')
      || msg.toLowerCase().includes('permission')
      || msg.toLowerCase().includes('assistive')
      || msg.toLowerCase().includes('enable access')
      || msg.toLowerCase().includes('axui');
    if (needsAccess) {
      els.status.textContent = 'Permission requise : Réglages Système → Confidentialité → Accessibilité → autoriser cette app';
    } else {
      els.status.textContent = 'Erreur enregistrement: ' + msg.slice(0, 100);
    }
    console.error('recording:start error', err);
  }
});

els.btnRecordStop.addEventListener('click', async () => {
  try {
    const result = await ipcRenderer.invoke('recording:stop');
    recording = false;
    els.btnRecordStart.disabled = false;
    els.btnRecordStop.disabled = true;

    const m = currentMacro();
    if (m) {
      m.actions = result.actions;
      recordingBuffer = null;
      await persistAndRerender();
      els.status.textContent = `Terminé — ${result.actions.length} actions`;
    } else {
      els.status.textContent = 'Enregistrement terminé';
    }
  } catch (err) {
    recording = false;
    els.btnRecordStart.disabled = false;
    els.btnRecordStop.disabled = true;
    els.status.textContent = 'Erreur arrêt enregistrement: ' + String(err?.message || err).slice(0, 80);
    console.error('recording:stop error', err);
  }
});

// Update visible fields when action type changes
els.actionType.addEventListener('change', updateActionForm);
updateActionForm();

els.btnAddAction.addEventListener('click', async () => {
  if (!currentMacro()) {
    els.status.textContent = "Crée une macro d'abord.";
    return;
  }
  const act = buildActionFromUI();
  if (recording) {
    recordingBuffer.push(act);
  } else {
    currentMacro().actions.push(act);
    await persistAndRerender();
  }
  els.status.textContent = 'Action ajoutée';
});

let executionCancelled = false;

async function executeMacroNow(fromShortcut = false) {
  const macro = currentMacro();
  if (!macro || !macro.actions.length) {
    els.status.textContent = "Aucune action à exécuter.";
    return;
  }
  if (macroPlaying) {
    executionCancelled = true;
    await ipcRenderer.invoke('macro:cancel');
    return;
  }

  macroPlaying = true;
  executionCancelled = false;
  els.btnPlay.textContent = 'Annuler';

  // When triggered from the Play button (not global shortcut), show a countdown
  // so the user has time to switch to the target full-screen application.
  if (!fromShortcut) {
    for (let i = 3; i > 0; i--) {
      if (executionCancelled) {
        macroPlaying = false;
        els.btnPlay.textContent = 'Rejouer';
        els.status.textContent = 'Annulé';
        return;
      }
      els.status.textContent = `Démarrage dans ${i}s… (basculez vers l'app cible)`;
      await new Promise(res => setTimeout(res, 1000));
    }
    if (executionCancelled) {
      macroPlaying = false;
      els.btnPlay.textContent = 'Rejouer';
      els.status.textContent = 'Annulé';
      return;
    }
    await ipcRenderer.invoke('window:hideForExecution');
    await new Promise(res => setTimeout(res, 200));
  }

  els.status.textContent = 'Exécution...';
  els.mouseCoords.style.display = 'block';
  try {
    await ipcRenderer.invoke('macro:execute', macro);
    els.status.textContent = 'Terminé';
  } catch (e) {
    els.status.textContent = e.message?.includes('cancel') ? 'Arrêtée' : 'Erreur exécution';
  } finally {
    macroPlaying = false;
    executionCancelled = false;
    els.btnPlay.textContent = 'Rejouer';
    els.mouseCoords.style.display = 'none';
    if (!fromShortcut) {
      await ipcRenderer.invoke('window:showAfterExecution');
    }
  }
}

els.btnPlay.addEventListener('click', () => executeMacroNow(false));

ipcRenderer.on('mouse:position', (e, { x, y }) => {
  els.mouseCoords.textContent = `x: ${x}  y: ${y}`;
});

// Shortcut trigger from main process (global hotkey fired)
ipcRenderer.on('shortcut:trigger', () => executeMacroNow(true));

// Global record shortcut: start
ipcRenderer.on('recording:globalStart', async () => {
  if (!currentMacro()) {
    const name = 'Macro rapide';
    const id = uid();
    store.macros.push({ id, name, actions: [] });
    currentMacroId = id;
    await ipcRenderer.invoke('macros:saveAll', store);
    renderMacroSelect();
  }
  recording = true;
  recordingBuffer = [];
  els.btnRecordStart.disabled = true;
  els.btnRecordStop.disabled = false;
  els.status.textContent = 'Enregistrement global en cours...';
});

// Global record shortcut: stop — main a déjà arrêté le recorder et filtré la touche
ipcRenderer.on('recording:globalStop', async (e, result) => {
  recording = false;
  recordingBuffer = null;
  els.btnRecordStart.disabled = false;
  els.btnRecordStop.disabled = true;

  const m = currentMacro();
  if (m) {
    m.actions = result.actions;
    await persistAndRerender();
    els.status.textContent = `Terminé — ${result.actions.length} actions`;
  } else {
    els.status.textContent = 'Enregistrement terminé';
  }
});

// --- Shortcut capture ---
els.btnShortcutSet.addEventListener('click', () => {
  capturingShortcut = true;
  els.shortcutHint.style.display = 'block';
  els.shortcutDisplay.textContent = '...';
  els.shortcutDisplay.style.color = '#bcd3ff';
});

els.btnShortcutClear.addEventListener('click', async () => {
  currentShortcut = null;
  els.shortcutDisplay.textContent = 'Aucun';
  els.shortcutDisplay.style.color = '';
  await ipcRenderer.invoke('shortcut:set', null);
});

els.btnShortcutRecordSet.addEventListener('click', () => {
  capturingRecordShortcut = true;
  els.shortcutRecordHint.style.display = 'block';
  els.shortcutRecordDisplay.textContent = '...';
  els.shortcutRecordDisplay.style.color = '#bcd3ff';
});

els.btnShortcutRecordClear.addEventListener('click', async () => {
  currentRecordShortcut = null;
  els.shortcutRecordDisplay.textContent = 'Aucun';
  els.shortcutRecordDisplay.style.color = '';
  await ipcRenderer.invoke('recordShortcut:set', null);
});

window.addEventListener('keydown', async (e) => {
  if (!capturingShortcut && !capturingRecordShortcut) return;
  e.preventDefault();
  e.stopPropagation();

  const isPlay = capturingShortcut;
  capturingShortcut = false;
  capturingRecordShortcut = false;

  const displayEl = isPlay ? els.shortcutDisplay : els.shortcutRecordDisplay;
  const hintEl    = isPlay ? els.shortcutHint    : els.shortcutRecordHint;
  const curKey    = isPlay ? currentShortcut      : currentRecordShortcut;
  const ipcChan   = isPlay ? 'shortcut:set'       : 'recordShortcut:set';

  hintEl.style.display = 'none';
  displayEl.style.color = '';

  if (e.key === 'Escape' || ['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
    displayEl.textContent = curKey || 'Aucun';
    return;
  }

  const mods = [];
  if (e.ctrlKey)  mods.push('Ctrl');
  if (e.metaKey)  mods.push('Command');
  if (e.altKey)   mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  mods.push(key);

  const accelerator = mods.join('+');
  displayEl.textContent = accelerator;

  try {
    await ipcRenderer.invoke(ipcChan, accelerator);
    if (isPlay) currentShortcut = accelerator;
    else currentRecordShortcut = accelerator;
  } catch (err) {
    els.status.textContent = 'Raccourci invalide ou déjà utilisé';
    displayEl.textContent = curKey || 'Aucun';
  }
}, true);

async function loadSettings() {
  try {
    const s = await ipcRenderer.invoke('settings:get');
    if (s?.shortcut) {
      currentShortcut = s.shortcut;
      els.shortcutDisplay.textContent = s.shortcut;
    }
    if (s?.recordShortcut) {
      currentRecordShortcut = s.recordShortcut;
      els.shortcutRecordDisplay.textContent = s.recordShortcut;
    }
  } catch (_) {}
}

els.btnExport.addEventListener('click', async () => {
  const filePath = await ipcRenderer.invoke('dialog:saveFile');
  if (!filePath) return;
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
  els.status.textContent = 'Export OK';
});

els.btnImport.addEventListener('click', async () => {
  const filePath = await ipcRenderer.invoke('dialog:openFile');
  if (!filePath) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.macros)) throw new Error('Format JSON invalide');
  store = parsed;
  currentMacroId = store.macros[0]?.id || null;
  await persistAndRerender();
  renderMacroSelect();
  renderActions();
  els.status.textContent = 'Import OK';
});

loadStore();
loadSettings();

