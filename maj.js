// Mises à jour de Volte, lues sur les releases GitHub de Luth-infinity/volte.
// Windows : electron-updater télécharge en arrière-plan, puis Volte propose de redémarrer pour installer.
// Mac : l'app n'est pas signée par Apple, l'installation automatique échouerait. On prévient seulement,
// et le clic ouvre la page de la release.
const { app, Notification, shell } = require('electron')

const DEPOT = 'Luth-infinity/volte'
const PAGE = `https://github.com/${DEPOT}/releases/latest`
const INTERVALLE = 2 * 60 * 60 * 1000 // Volte reste ouvert des jours entiers
const PREMIER_DELAI = 15000
const MAC = process.platform === 'darwin'

// statut : 'indisponible' | 'verification' | 'a-jour' | 'disponible' | 'telechargement' | 'prete' | 'erreur'
let etat = { statut: 'indisponible' }
let changement = () => {}
let updater = null
let dejaNotifiee = null

function poser(nouvel) {
  etat = nouvel
  changement(etat)
}

function notifier(titre, corps, clic) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: titre, body: corps, silent: true })
  if (clic) n.on('click', clic)
  n.show()
}

// 0.1.10 > 0.1.9 : on compare nombre par nombre, pas en texte.
function plusRecente(a, b) {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

// --- Windows ------------------------------------------------------------------
// electron-updater n'existe qu'empaqueté (il lui faut app-update.yml) : chargé à la demande.
function chargerUpdater() {
  if (updater) return updater
  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true // quitter Volte suffit aussi à installer
  autoUpdater.logger = null
  autoUpdater.on('update-available', (i) => poser({ statut: 'telechargement', version: i.version }))
  autoUpdater.on('update-not-available', () => poser({ statut: 'a-jour' }))
  autoUpdater.on('update-downloaded', (i) => {
    poser({ statut: 'prete', version: i.version })
    if (dejaNotifiee !== i.version) {
      dejaNotifiee = i.version
      notifier(`Volte ${i.version} est prête`, 'Clique pour redémarrer Volte et l’installer.', installer)
    }
  })
  autoUpdater.on('error', (e) => poser({ statut: 'erreur', message: String(e?.message || e).slice(0, 160) }))
  updater = autoUpdater
  return updater
}

// --- Mac ----------------------------------------------------------------------
async function verifierMac() {
  const r = await fetch(`https://api.github.com/repos/${DEPOT}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!r.ok) throw new Error(`GitHub a répondu ${r.status}`)
  const version = String((await r.json()).tag_name || '').replace(/^v/, '')
  if (!version || !plusRecente(version, app.getVersion())) return poser({ statut: 'a-jour' })
  poser({ statut: 'disponible', version })
  if (dejaNotifiee !== version) {
    dejaNotifiee = version
    notifier(`Volte ${version} est disponible`, 'Clique pour la télécharger.', ouvrirPage)
  }
}

// --- Commun -------------------------------------------------------------------
async function verifier() {
  if (!app.isPackaged) return poser({ statut: 'indisponible' })
  // Un téléchargement en cours ou fini ne se revérifie pas : on écraserait un état plus avancé.
  if (etat.statut === 'telechargement' || etat.statut === 'prete') return
  poser({ statut: 'verification' })
  try {
    if (MAC) await verifierMac()
    else await chargerUpdater().checkForUpdates()
  } catch (e) {
    poser({ statut: 'erreur', message: String(e?.message || e).slice(0, 160) })
  }
}

// Ferme Volte, installe en silence (installeur en un clic) et le relance.
function installer() {
  if (etat.statut === 'prete' && updater) updater.quitAndInstall(true, true)
}
const ouvrirPage = () => shell.openExternal(PAGE)

function surveiller(surChangement) {
  changement = surChangement
  if (!app.isPackaged) return
  setTimeout(() => {
    verifier()
    setInterval(verifier, INTERVALLE)
  }, PREMIER_DELAI)
}

module.exports = { surveiller, verifier, installer, ouvrirPage, etat: () => etat, plusRecente }
