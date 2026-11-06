// Vérification rapide : node check.js
const assert = require('assert')
const { dossierDe } = require('./claude')

assert.strictEqual(dossierDe('/Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=/Users/x/Library/Application Support/Claude-Travail'), 'Claude-Travail')
assert.strictEqual(dossierDe('/Applications/Claude.app/Contents/MacOS/Claude'), null)
assert.strictEqual(dossierDe('"C:\\Users\\x\\AppData\\Local\\AnthropicClaude\\app-1.0\\claude.exe" "--user-data-dir=C:\\Users\\x\\AppData\\Roaming\\Claude-Travail"'), 'Claude-Travail')
assert.strictEqual(dossierDe('claude.exe --user-data-dir=C:\\A B\\Claude-Travail --flag'), 'Claude-Travail')
// Seule l'app de bureau compte : Claude Code (terminal) s'appelle aussi claude.exe.
const { EXE_APP } = require('./claude')
assert.ok(EXE_APP.test('C:\\Program Files\\WindowsApps\\Claude_4.23118.0.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe'))
assert.ok(EXE_APP.test('C:\\Users\\x\\AppData\\Local\\AnthropicClaude\\app-0.14.10\\claude.exe'))
assert.ok(!EXE_APP.test('C:\\Users\\x\\AppData\\Local\\Claude-Data\\claude_p\\claude-code\\2.1.317\\a33aa5518497\\claude.exe'))
assert.ok(!EXE_APP.test('C:\\Users\\x\\.local\\bin\\claude.exe'))
console.log('ok')
