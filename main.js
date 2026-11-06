// Volte : passe l'app Claude d'un compte à l'autre.
// Chaque compte a son propre dossier de données, donc chacun reste connecté.
// Une seule instance tourne à la fois : le lien de connexion claude:// arrive toujours au bon endroit.
const { app, Tray, Menu, globalShortcut, nativeImage, nativeTheme, BrowserWindow, screen, dialog, ipcMain } = require('electron')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const claude = require('./claude')

const MAC = process.platform === 'darwin'
const DEMO = process.env.VOLTE_DEMO // dossier où écrire des captures, sans toucher à Claude
const appData = app.getPath('appData')
const dossierDonnees = DEMO ? path.join(DEMO, 'donnees') : app.getPath('userData')
const fichierConfig = path.join(dossierDonnees, 'config.json')
const dossierPhotos = path.join(dossierDonnees, 'photos')

const CONFIG_INITIALE = {
  raccourci: 'CommandOrControl+Alt+C',
  auDemarrage: false,
  ouvrirAuDemarrage: '',
  comptes: [
    { id: 'perso', nom: 'Perso', couleur: '#D97757', dossier: null, photo: null, raccourci: '' },
    { id: 'travail', nom: 'Travail', couleur: '#3B82F6', dossier: 'Claude-Travail', photo: null, raccourci: '' },
  ],
}

let config
let tray
let ecran
let reglages
let occupe = false
let dernier

if (!DEMO && !app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => ouvrirReglages())
app.dock?.hide()
app.on('window-all-closed', () => {})

// --- Config -----------------------------------------------------------------
// L'app s'appelait « Bascule » : on reprend ses réglages et ses photos au premier lancement.
function reprendreBascule() {
  const ancien = path.join(appData, 'Bascule')
  if (DEMO || fs.existsSync(fichierConfig) || !fs.existsSync(path.join(ancien, 'config.json'))) return
  fs.mkdirSync(dossierDonnees, { recursive: true })
  fs.copyFileSync(path.join(ancien, 'config.json'), fichierConfig)
  if (fs.existsSync(path.join(ancien, 'photos'))) fs.cpSync(path.join(ancien, 'photos'), dossierPhotos, { recursive: true })
}
function lireConfig() {
  try { return { ...CONFIG_INITIALE, ...JSON.parse(fs.readFileSync(fichierConfig, 'utf8')) } } catch { return structuredClone(CONFIG_INITIALE) }
}
function ecrireConfig() {
  fs.mkdirSync(dossierDonnees, { recursive: true })
  fs.writeFileSync(fichierConfig, JSON.stringify(config, null, 2))
}
const compte = (id) => config.comptes.find((c) => c.id === id)
const principal = () => config.comptes.find((c) => !c.dossier)
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

// Compte actif d'après le dossier passé à Claude (aucun dossier = compte principal).
async function actuel() {
  const ligne = await claude.ligneDeCommande()
  if (!ligne) return null
  const dossier = claude.dossierDe(ligne)
  return (dossier && config.comptes.find((c) => c.dossier === dossier)) || principal()
}
// Dossier passé à Claude au lancement d'un compte secondaire.
const dossierComplet = (c) => path.join(appData, c.dossier || 'Claude')
// Dossier où Claude range vraiment les données du compte (le paquet Windows peut les déplacer).
const dossierLu = (c) => claude.dossierReel(c.dossier) || dossierComplet(c)

// --- Photos -----------------------------------------------------------------
function carre(img) {
  const { width: w, height: h } = img.getSize()
  const s = Math.min(w, h)
  return img.crop({ x: Math.round((w - s) / 2), y: Math.round((h - s) / 2), width: s, height: s })
}
const cachePhotos = new Map() // le redimensionnement bloque le processus principal : une fois par photo
function urlPhoto(c) {
  if (!c.photo) return null
  if (!cachePhotos.has(c.photo)) {
    const img = nativeImage.createFromPath(path.join(dossierPhotos, c.photo))
    cachePhotos.set(c.photo, img.isEmpty() ? null : carre(img).resize({ width: 192, height: 192, quality: 'best' }).toDataURL())
  }
  return cachePhotos.get(c.photo)
}
const pourEcran = (c) => ({ nom: c.nom, couleur: c.couleur, photo: urlPhoto(c) })

// Copie une image en PNG carré de 512 px. Sur Mac on passe par sips, qui lit aussi le HEIC des iPhone.
function importerPhoto(source, destination) {
  fs.mkdirSync(dossierPhotos, { recursive: true })
  if (MAC) return execFileSync('sips', ['-s', 'format', 'png', '-Z', '512', source, '--out', destination])
  const img = nativeImage.createFromPath(source)
  if (img.isEmpty()) throw new Error('Format d’image non pris en charge')
  fs.writeFileSync(destination, carre(img).resize({ width: 512, height: 512, quality: 'best' }).toPNG())
}

// Pastille ronde d'un compte (photo ou initiale), dessinée par la page de l'écran de transition.
const cacheIcones = new Map()
async function icone(c) {
  const cle = `${c.nom}|${c.couleur}|${c.photo}`
  if (!cacheIcones.has(cle)) {
    const url = await ecran.webContents.executeJavaScript(`iconeCompte(${JSON.stringify(pourEcran(c))}, 32)`)
    cacheIcones.set(cle, nativeImage.createFromBuffer(Buffer.from(url.split(',')[1], 'base64'), { scaleFactor: 2 }))
  }
  return cacheIcones.get(cle)
}

// --- Écran de transition ----------------------------------------------------
// Verre natif : vibrancy sur Mac, acrylique sur Windows 11. La page pose un voile par-dessus
// pour que le texte reste lisible quel que soit le fond.
const LARGEUR = 280
const HAUTEUR = 240
function creerEcran() {
  ecran = new BrowserWindow({
    width: LARGEUR, height: HAUTEUR, show: false, frame: false, transparent: true,
    vibrancy: 'popover', visualEffectState: 'active', backgroundMaterial: 'acrylic', backgroundColor: '#00000000',
    roundedCorners: true, hasShadow: true,
    resizable: false, movable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true,
  })
  ecran.setAlwaysOnTop(true, 'screen-saver')
  ecran.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  ecran.setIgnoreMouseEvents(true)
  return ecran.loadFile(path.join(__dirname, 'ecran.html')).then(async () => {
    // Premier affichage invisible : sans ça, la toute première bascule montre une carte vide.
    ecran.setOpacity(0)
    ecran.showInactive()
    await attendre(300)
    ecran.hide()
  })
}
async function fondu(de, a, ms) {
  for (let i = 1; i <= 8; i++) {
    ecran.setOpacity(de + ((a - de) * i) / 8)
    await attendre(ms / 8)
  }
}
// Renvoie le temps (ms) qu'il reste à l'animation.
function afficher(donnees) {
  const reste = ecran.webContents.executeJavaScript(`etat(${JSON.stringify(donnees)})`)
  if (!ecran.isVisible()) {
    const { workArea: z } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    ecran.setPosition(Math.round(z.x + (z.width - LARGEUR) / 2), Math.round(z.y + z.height * 0.4 - HAUTEUR / 2))
    ecran.setOpacity(0)
    ecran.showInactive()
    fondu(0, 1, 120)
  }
  return reste
}

async function basculer(id) {
  if (occupe) return
  occupe = true // posé avant le premier await : deux appuis rapides ne lancent qu'une bascule
  const courant = (await actuel()) || compte(dernier) || principal()
  if (!id) { // compte suivant dans la liste
    const i = config.comptes.indexOf(courant)
    id = config.comptes[(i + 1) % config.comptes.length].id
  }
  const vers = compte(id)
  if (!vers || (vers === courant && (await claude.tourne()))) { occupe = false; return }
  const base = { de: pourEcran(courant), vers: pourEcran(vers) }
  try {
    // La transition joue d'une traite pendant que Claude se ferme. On ne relance Claude
    // qu'ensuite : sa relance fait ramer la machine, autant qu'elle tombe sur une carte immobile.
    const debut = Date.now()
    const animation = afficher({ ...base, etape: 0 })
    if (await claude.tourne()) {
      await claude.fermer()
      for (let i = 0; await claude.tourne(); i++) {
        if (i > 50) throw new Error('Claude ne se ferme pas')
        await attendre(200)
      }
    }
    await attendre((await animation) - (Date.now() - debut) + 100)
    afficher({ ...base, etape: 1 })
    // Chaque compte retient sa propre position de fenêtre : on donne à l'arrivant celle du partant,
    // pour que Claude rouvre sur le même écran, à la même place.
    try { fs.copyFileSync(path.join(dossierLu(courant), 'window-state.json'), path.join(dossierLu(vers), 'window-state.json')) } catch {}
    claude.ouvrir(vers.dossier ? dossierComplet(vers) : null)
    for (let i = 0; !(await claude.tourne()) && i < 30; i++) await attendre(300)
    await attendre(1200) // le temps que la fenêtre de Claude apparaisse
    const reste = await afficher({ ...base, etape: 2 })
    dernier = vers.id
    await attendre(reste + 450) // on laisse l'anneau se poser
  } catch (e) {
    afficher({ ...base, etape: 1, erreur: e.message })
    await attendre(2500)
  } finally {
    await fondu(1, 0, 180)
    ecran.hide()
    occupe = false
    menu()
    reglages?.webContents.send('etats')
  }
}

// --- Raccourcis -------------------------------------------------------------
// Renvoie les raccourcis refusés par le système, par clé ('general' ou id de compte).
function appliquerRaccourcis() {
  globalShortcut.unregisterAll()
  const erreurs = {}
  const essayer = (cle, acc, fn) => {
    if (!acc) return
    try { if (!globalShortcut.register(acc, fn)) erreurs[cle] = 'Déjà utilisé par une autre app' } catch { erreurs[cle] = 'Raccourci invalide' }
  }
  essayer('general', config.raccourci, () => basculer())
  for (const c of config.comptes) essayer(c.id, c.raccourci, () => basculer(c.id))
  return erreurs
}
function appliquerDemarrage() {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.auDemarrage })
}

// --- Barre de menus ---------------------------------------------------------
async function menu() {
  if (!tray || occupe) return
  const courant = (await actuel()) || compte(dernier) || principal()
  tray.setImage(await icone(courant))
  if (MAC) tray.setTitle(courant.nom)
  tray.setToolTip(`Volte — ${courant.nom}`)
  const icones = await Promise.all(config.comptes.map(icone))
  tray.setContextMenu(Menu.buildFromTemplate([
    ...config.comptes.map((c, i) => ({
      label: c.nom, type: 'checkbox', checked: c === courant, icon: icones[i],
      accelerator: c.raccourci || undefined, registerAccelerator: false,
      click: () => basculer(c.id),
    })),
    { type: 'separator' },
    { label: 'Compte suivant', accelerator: config.raccourci || undefined, registerAccelerator: false, click: () => basculer() },
    { label: 'Réglages…', click: ouvrirReglages },
    { type: 'separator' },
    { label: 'Quitter Volte', role: 'quit' },
  ]))
}

// --- Réglages ---------------------------------------------------------------
function ouvrirReglages() {
  if (reglages) return reglages.show(), reglages.focus()
  reglages = new BrowserWindow({
    width: 720, height: 580, minWidth: 640, minHeight: 480, show: false, title: 'Volte',
    ...(MAC
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 }, backgroundColor: '#00000000', vibrancy: 'sidebar' }
      : { autoHideMenuBar: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#f5f5f7' }),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  reglages.loadFile(path.join(__dirname, 'reglages.html'))
  reglages.once('ready-to-show', () => { reglages.show(); app.focus({ steal: true }) })
  reglages.on('closed', () => { reglages = null })
  return reglages
}

ipcMain.handle('lire', () => ({
  config,
  photos: Object.fromEntries(config.comptes.map((c) => [c.id, urlPhoto(c)])),
}))
ipcMain.handle('enregistrer', (_e, nouvelle) => {
  config = nouvelle
  ecrireConfig()
  const erreurs = appliquerRaccourcis()
  appliquerDemarrage()
  menu()
  return erreurs
})
ipcMain.handle('choisirPhoto', async (_e, id) => {
  const c = compte(id)
  const { canceled, filePaths } = await dialog.showOpenDialog(reglages, {
    title: `Photo de ${c.nom}`, properties: ['openFile'],
    filters: [{ name: 'Images', extensions: MAC ? ['png', 'jpg', 'jpeg', 'heic', 'webp'] : ['png', 'jpg', 'jpeg'] }],
  })
  if (canceled) return null
  const ancienne = c.photo
  c.photo = `${id}-${Date.now()}.png`
  try {
    importerPhoto(filePaths[0], path.join(dossierPhotos, c.photo))
  } catch (e) {
    c.photo = ancienne
    dialog.showErrorBox('Volte', `Impossible d’utiliser cette image.\n${e.message}`)
    return null
  }
  if (ancienne) fs.rmSync(path.join(dossierPhotos, ancienne), { force: true })
  ecrireConfig()
  menu()
  return { photo: c.photo, url: urlPhoto(c) }
})
ipcMain.handle('retirerPhoto', (_e, id) => {
  const c = compte(id)
  if (c.photo) fs.rmSync(path.join(dossierPhotos, c.photo), { force: true })
  c.photo = null
  ecrireConfig()
  menu()
})
// État de connexion de chaque compte, et celui qui est ouvert dans Claude en ce moment.
ipcMain.handle('etats', async () => {
  const ouvert = await actuel()
  return Object.fromEntries(config.comptes.map((c) => [c.id, { connecte: claude.connecte(c.dossier), ouvert: c === ouvert }]))
})
// Ouvre Claude sur ce compte : s'il n'est pas encore connecté, Claude affiche son écran de connexion.
ipcMain.handle('connecter', (_e, id) => basculer(id))
ipcMain.handle('suspendreRaccourcis', (_e, oui) => (oui ? globalShortcut.unregisterAll() : appliquerRaccourcis()))

// --- Démo : captures de l'écran de transition et des réglages -------------
async function demo() {
  const exemple = process.env.VOLTE_PHOTO // une photo de test sur le second compte
  if (exemple) {
    importerPhoto(exemple, path.join(dossierPhotos, 'demo.png'))
    config.comptes[1].photo = 'demo.png'
  }
  await creerEcran()
  const capture = async (nom, fen = ecran) => fs.writeFileSync(path.join(DEMO, `${nom}.png`), (await fen.webContents.capturePage()).toPNG())
  const base = { de: pourEcran(config.comptes[0]), vers: pourEcran(config.comptes[1]) }
  for (const theme of ['light', 'dark']) {
    await ecran.webContents.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
    afficher({ ...base, etape: 0 })
    await attendre(250); await capture(`ecran-${theme}-1-depart`)
    await attendre(450); await capture(`ecran-${theme}-2-erosion`)
    await attendre(500); await capture(`ecran-${theme}-3-croisement`)
    afficher({ ...base, etape: 1 })
    await attendre(1200); await capture(`ecran-${theme}-4-arrivee`)
    const reste = await afficher({ ...base, etape: 2 })
    await attendre(reste + 100); await capture(`ecran-${theme}-5-pret`)
    ecran.hide()
  }
  const w = ouvrirReglages()
  await new Promise((r) => w.once('ready-to-show', r))
  for (const theme of ['light', 'dark']) {
    // La capture ne contient pas le flou natif de la barre latérale : on le remplace par un aplat.
    await w.webContents.executeJavaScript(`document.documentElement.dataset.theme = '${theme}';
      document.querySelector('.laterale').style.background = '${theme === 'dark' ? '#2b2b2e' : '#e6e6e9'}'`)
    for (const [nom, vue] of [['principal', config.comptes[0].id], ['compte', config.comptes[1].id], ['general', 'general']]) {
      await w.webContents.executeJavaScript(`document.querySelector('[data-vue="${vue}"]').click()`)
      await attendre(1500) // le temps de lire l'état de connexion des comptes
      await capture(`reglages-${theme}-${nom}`, w)
    }
  }
  app.quit()
}

app.whenReady().then(async () => {
  reprendreBascule()
  config = lireConfig()
  if (DEMO) return demo()
  ecrireConfig()
  await creerEcran()
  tray = new Tray(nativeImage.createEmpty())
  if (!MAC) tray.on('click', () => tray.popUpContextMenu()) // Windows : le clic gauche ouvre aussi le menu
  appliquerRaccourcis()
  appliquerDemarrage()
  await menu()
  setInterval(menu, 5000) // suit aussi un Claude lancé à la main
  const auLancement = compte(config.ouvrirAuDemarrage)
  if (auLancement) claude.tourne().then((oui) => oui || claude.ouvrir(auLancement.dossier ? dossierComplet(auLancement) : null))
})
app.on('will-quit', () => globalShortcut.unregisterAll())
