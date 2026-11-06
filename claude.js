// Contrôle de l'app Claude : savoir si elle tourne, sur quel dossier, la fermer, la relancer.
// Tout est asynchrone : un appel bloquant figerait Volte, et l'animation avec.
const { execFile, spawn } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
const os = require('os')
const path = require('path')

const run = promisify(execFile)
const MAC = process.platform === 'darwin'
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
const local = process.env.LOCALAPPDATA || ''
const roaming = process.env.APPDATA || ''
const sousDossiers = (d) => { try { return fs.readdirSync(d) } catch { return [] } }

// Emplacements de Claude sur Windows. L'installeur actuel (paquet MSIX) range l'app dans WindowsApps,
// où on ne peut pas la lancer directement : on passe par son alias claude-desktop.exe.
// On teste l'alias avec readdir, pas existsSync : c'est un point d'analyse que stat ne sait pas lire.
function exeWindows() {
  const alias = path.join(local, 'Microsoft', 'WindowsApps')
  if (sousDossiers(alias).some((f) => f.toLowerCase() === 'claude-desktop.exe')) return path.join(alias, 'claude-desktop.exe')
  const programmes = process.env.ProgramFiles || 'C:\\Program Files'
  return [
    path.join(local, 'AnthropicClaude', 'claude.exe'),
    path.join(local, 'Programs', 'Claude', 'Claude.exe'),
    path.join(programmes, 'Claude', 'Claude.exe'),
  ].find((f) => fs.existsSync(f))
}

// Processus de l'app de bureau sur Windows. Claude Code (le terminal) s'appelle aussi claude.exe :
// on ne garde que les exécutables rangés dans un dossier app ou app-x.y.z, ceux de l'app.
const EXE_APP = /\\app(-[\d.]+)?\\claude\.exe$/i
async function processusWindows() {
  const { stdout } = await run('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter 'Name=''claude.exe''' | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.ExecutablePath, $_.CommandLine }"],
  { windowsHide: true }).catch(() => ({ stdout: '' }))
  return stdout.split(/\r?\n/).map((l) => {
    const [pid, exe, ...reste] = l.split('|')
    const ligne = reste.join('|').trim()
    const chemin = exe || (ligne.match(/^"?([^"]+?\.exe)/i) || [])[1] || ''
    return { pid, ligne, app: EXE_APP.test(chemin) }
  }).filter((p) => p.pid && p.app)
}
// Le processus principal est le seul sans --type= (les autres sont ses auxiliaires).
const principalWindows = (liste) => liste.find((p) => !/--type=/.test(p.ligne))

const tourne = MAC
  ? () => run('pgrep', ['-x', 'Claude']).then(() => true, () => false)
  : () => processusWindows().then((l) => l.length > 0)

// Ligne de commande du processus principal de Claude, ou null s'il est fermé.
async function ligneDeCommande() {
  if (MAC) {
    const { stdout } = await run('ps', ['-axo', 'args'])
    return stdout.split('\n').find((l) => /\/Claude\.app\/Contents\/MacOS\/Claude( |$)/.test(l)) || null
  }
  const p = principalWindows(await processusWindows())
  return p ? p.ligne : null
}

// Nom du dossier de données passé à Claude (null = dossier par défaut).
function dossierDe(ligne) {
  const m = ligne.match(/--user-data-dir=([^"\r\n]+?)(?:"|\s--|\s*$)/)
  return m ? m[1].trim().split(/[\\/]/).pop() : null // basename, quel que soit le séparateur
}

async function fermer() {
  if (MAC) return run('pkill', ['-TERM', '-x', 'Claude']).catch(() => {})
  // Par numéro de processus : un taskkill par nom fermerait aussi les sessions Claude Code du terminal.
  const p = principalWindows(await processusWindows())
  if (p) await run('taskkill', ['/PID', p.pid], { windowsHide: true }).catch(() => {})
  // Fermer ses fenêtres peut laisser Claude dans la zone de notification : au bout de 3 s on force.
  for (let i = 0; i < 15 && (await tourne()); i++) await attendre(200)
  const restants = await processusWindows()
  if (restants.length) await run('taskkill', ['/F', '/T', ...restants.flatMap((r) => ['/PID', r.pid])], { windowsHide: true }).catch(() => {})
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

// Dossiers où Claude a pu ranger les données d'un compte (nom = null pour le dossier par défaut).
// Sur Mac, un seul endroit. Sur Windows, le paquet MSIX déplace ou redirige les données :
// %LOCALAPPDATA%\Claude-Data\claude_…, %LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming, puis %APPDATA%.
function emplacements(nom) {
  if (MAC) return [path.join(os.homedir(), 'Library', 'Application Support', nom || 'Claude')]
  const paquets = sousDossiers(path.join(local, 'Packages')).filter((d) => /^Claude_/i.test(d))
    .map((d) => path.join(local, 'Packages', d, 'LocalCache', 'Roaming', nom || 'Claude'))
  const donnees = nom ? [] : sousDossiers(path.join(local, 'Claude-Data')).filter((d) => /^claude_/i.test(d))
    .map((d) => path.join(local, 'Claude-Data', d))
  return [...donnees, ...paquets, path.join(roaming, nom || 'Claude')]
}
const dossierReel = (nom) =>emplacements(nom).find((d) => fs.existsSync(path.join(d, 'config.json')))

// Un compte est connecté quand son config.json garde un jeton de connexion (on ne lit que les noms des clés).
function connecte(nom) {
  const d = dossierReel(nom)
  if (!d) return false
  try { return Object.keys(JSON.parse(fs.readFileSync(path.join(d, 'config.json'), 'utf8'))).some((k) => k.startsWith('oauth:token')) } catch { return false }
}

module.exports = { tourne, ligneDeCommande, dossierDe, fermer, ouvrir, dossierReel, connecte, EXE_APP }
