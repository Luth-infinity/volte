// Contrôle de l'app Claude : savoir si elle tourne, sur quel dossier, la fermer, la relancer.
// Tout est asynchrone : un appel bloquant figerait Volte, et l'animation avec.
const { execFile, spawn } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
const path = require('path')

const run = promisify(execFile)
const MAC = process.platform === 'darwin'
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

// Emplacements connus de Claude sur Windows : installeur classique, puis variantes.
function exeWindows() {
  const local = process.env.LOCALAPPDATA || ''
  const programmes = process.env.ProgramFiles || 'C:\\Program Files'
  return [
    path.join(local, 'AnthropicClaude', 'claude.exe'),
    path.join(local, 'Programs', 'Claude', 'Claude.exe'),
    path.join(programmes, 'Claude', 'Claude.exe'),
  ].find((f) => fs.existsSync(f))
}

const tourne = MAC
  ? () => run('pgrep', ['-x', 'Claude']).then(() => true, () => false)
  : () => run('tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/NH', '/FO', 'CSV'])
    .then((r) => /claude\.exe/i.test(r.stdout), () => false)

// Ligne de commande du processus principal de Claude, ou null s'il est fermé.
async function ligneDeCommande() {
  if (MAC) {
    const { stdout } = await run('ps', ['-axo', 'args'])
    return stdout.split('\n').find((l) => /\/Claude\.app\/Contents\/MacOS\/Claude( |$)/.test(l)) || null
  }
  const { stdout } = await run('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | ForEach-Object CommandLine"]).catch(() => ({ stdout: '' }))
  // Le processus principal est le seul sans --type= (les autres sont ses auxiliaires).
  return stdout.split(/\r?\n/).find((l) => l.trim() && !/--type=/.test(l)) || null
}

// Nom du dossier de données passé à Claude (null = dossier par défaut).
function dossierDe(ligne) {
  const m = ligne.match(/--user-data-dir=([^"\r\n]+?)(?:"|\s--|\s*$)/)
  return m ? m[1].trim().split(/[\\/]/).pop() : null // basename, quel que soit le séparateur
}

async function fermer() {
  if (MAC) return run('pkill', ['-TERM', '-x', 'Claude']).catch(() => {})
  await run('taskkill', ['/IM', 'claude.exe']).catch(() => {})
  // Fermer ses fenêtres peut laisser Claude dans la zone de notification : au bout de 3 s on force.
  for (let i = 0; i < 15 && (await tourne()); i++) await attendre(200)
  if (await tourne()) await run('taskkill', ['/F', '/T', '/IM', 'claude.exe']).catch(() => {})
}

// dossier : chemin complet du dossier de données, ou null pour celui par défaut.
function ouvrir(dossier) {
  const args = dossier ? [`--user-data-dir=${dossier}`] : []
  if (MAC) {
    spawn('open', ['-a', 'Claude', ...(args.length ? ['--args', ...args] : [])], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  const exe = exeWindows()
  if (!exe) throw new Error('Claude est introuvable sur ce PC')
  spawn(exe, args, { detached: true, stdio: 'ignore' }).unref()
}

module.exports = { tourne, ligneDeCommande, dossierDe, fermer, ouvrir }
