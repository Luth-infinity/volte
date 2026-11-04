// Vérification rapide : node check.js
const assert = require('assert')
const { dossierDe } = require('./claude')

assert.strictEqual(dossierDe('/Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=/Users/x/Library/Application Support/Claude-Travail'), 'Claude-Travail')
assert.strictEqual(dossierDe('/Applications/Claude.app/Contents/MacOS/Claude'), null)
assert.strictEqual(dossierDe('"C:\\Users\\x\\AppData\\Local\\AnthropicClaude\\app-1.0\\claude.exe" "--user-data-dir=C:\\Users\\x\\AppData\\Roaming\\Claude-Travail"'), 'Claude-Travail')
assert.strictEqual(dossierDe('claude.exe --user-data-dir=C:\\A B\\Claude-Travail --flag'), 'Claude-Travail')
console.log('ok')
