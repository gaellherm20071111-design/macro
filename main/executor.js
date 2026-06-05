const robot = require('@jitsi/robotjs');

let cancelled = false;

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function cancelExecution() {
  cancelled = true;
}

async function executeMacro(macro, opts = {}) {
  cancelled = false;
  const actions = macro?.actions || [];
  const speed = opts.speedFactor ?? 1;
  const onMousePos = opts.onMousePos;

  for (const act of actions) {
    if (cancelled) break;
    const d = Math.max(0, act.delayMs ?? 0);
    if (d) await sleep(d / speed);
    if (cancelled) break;

    switch (act.type) {
      case 'mouseMove':
        robot.moveMouse(act.x, act.y);
        break;
      case 'mouseClick':
        robot.mouseClick(act.button || 'left', !!act.double);
        break;
      case 'mouseDown':
        robot.mouseToggle('down', act.button || 'left');
        break;
      case 'mouseUp':
        robot.mouseToggle('up', act.button || 'left');
        break;
      case 'keyTap':
        robot.keyTap(act.key, act.modifiers || []);
        break;
      case 'typeText':
        robot.typeString(act.text || '');
        break;
    }

    if (onMousePos) {
      const pos = robot.getMousePos();
      onMousePos(pos.x, pos.y);
    }
  }
}

module.exports = { executeMacro, cancelExecution };

