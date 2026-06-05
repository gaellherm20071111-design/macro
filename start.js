// Cross-platform launcher that strips ELECTRON_RUN_AS_NODE before starting.
// That env var is set by Claude Code / VS Code which makes Electron act as Node.js.
const { spawn } = require('child_process');
const electron = require('./node_modules/electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, ['.', '--no-sandbox'], { env, stdio: 'inherit' })
  .on('exit', (code) => process.exit(code || 0));
