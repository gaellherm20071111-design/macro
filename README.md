# Macro Desktop — Electron (Windows & macOS)

App desktop pour créer/rejouer des macros souris/clavier avec délai par action.

## Prérequis

### Windows
- Python 3.x et les [Build Tools Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (pour compiler les modules natifs)

### macOS
- Xcode Command Line Tools : `xcode-select --install`
- Après le premier lancement, autoriser l'app dans **Réglages Système → Confidentialité → Accessibilité** pour que le contrôle souris/clavier fonctionne.

## Lancer en dev

```bash
npm install   # compile automatiquement les modules natifs via electron-rebuild
npm start
```

## Construire

```bash
npm run build
```

Génère un installeur `.exe` (NSIS) sur Windows et un `.dmg` sur macOS dans le dossier `dist/`.

## Notes
- L'UI et le système d'édition/sauvegarde/export sont en place.
- L'enregistrement global souris/clavier (capture hors fenêtre) reste à brancher.
- L'exécution/rejouer utilise `@jitsi/robotjs`, fork maintenu de robotjs, compatible Windows et macOS.
