<p align="center">
  <img src="docs/assets/icon-light.png" width="128" height="128" alt="Icône de Yank en mode clair : un y calligraphié blanc sur un carré rose">
  &nbsp;&nbsp;
  <img src="docs/assets/icon-dark.png" width="128" height="128" alt="Icône de Yank en mode sombre : un y calligraphié rose sur un carré presque noir">
</p>

<p align="center"><sub>Mode clair ou sombre, au choix dans Icon Composer. Comme les apps d’Apple, l’icône du Dock suit le style d’icône et de widget choisi dans Réglages Système › Apparence.</sub></p>

# Yank

Une application de bureau macOS pour [yt-dlp](https://github.com/yt-dlp/yt-dlp) :
collez l’URL d’une vidéo, d’une playlist ou d’une chaîne YouTube, X (Twitter),
Twitch ou de l’un des [sites pris en charge par
yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md). Yank
télécharge le contenu, le range dans une bibliothèque et le lit dans son propre
lecteur.

- **Téléchargements** : vidéos seules ou playlists et chaînes complètes, en
  MP4 H.264 (lisible partout), en M4A audio uniquement ou dans la meilleure
  qualité d’origine. La file d’attente permet de mettre en pause, reprendre,
  annuler et relancer un téléchargement, de régler le nombre de téléchargements
  simultanés et de réessayer automatiquement les erreurs 403 temporaires de
  YouTube. En cas d’échec, l’erreur de yt-dlp s’affiche avec le journal complet
  et un bouton « Copier les diagnostics ».
- **Bibliothèque** : dossiers (chaque playlist a le sien, avec les vidéos
  numérotées dans l’ordre de la playlist), recherche, filtres par source et
  statut de visionnage, tri, déplacement et suppression groupés, affichage dans
  le Finder, copie du lien. La suppression d’un fichier l’envoie dans la
  Corbeille.
- **YouTube** : recherchez des vidéos et des playlists depuis la barre
  latérale, regardez un résultat immédiatement (diffusé dans le lecteur, jusqu’en
  1080p, sans téléchargement) ou téléchargez-le dans le format de votre choix.
  Une playlist s’ouvre avec ses vidéos et propose « Tout lire » et « Tout
  télécharger ».
- **Lecteur** : reprise là où vous vous êtes arrêté, marquage comme regardée à
  90 %, file de lecture, lecture automatique d’un dossier, raccourcis clavier et
  image dans l’image.

## Installation

Téléchargez le fichier `.dmg` correspondant à votre Mac (Apple Silicon
`aarch64` ou Intel `x64`) depuis les [releases](https://github.com/aaimeraud/yank/releases),
faites glisser Yank dans Applications, puis installez les outils ci-dessous.

Yank n’est pas notarisé par Apple, le premier lancement est donc bloqué.
Ouvrez l’application une fois, fermez l’avertissement, puis allez dans Réglages
Système › Confidentialité et sécurité et cliquez sur **Ouvrir quand même** à
côté de « Yank a été bloqué » (sur les versions récentes de macOS, clic droit ›
Ouvrir ne suffit plus). Ou utilisez le Terminal :

```bash
xattr -dr com.apple.quarantine /Applications/Yank.app
```

## Prérequis

Yank utilise les outils que vous installez ; ils ne sont pas encore inclus dans
l’application.

```bash
brew install yt-dlp ffmpeg deno
```

- **yt-dlp** s’occupe des téléchargements. Gardez-le à jour
  (`brew upgrade yt-dlp`) : lorsqu’un site change, une mise à jour de yt-dlp
  règle presque toujours le problème.
- **ffmpeg** assemble les flux vidéo et audio.
- **deno** résout le challenge du lecteur YouTube. Sans lui, de nombreux
  téléchargements YouTube échouent avec des erreurs 403.

Yank cherche ces outils dans `PATH`, `~/.local/bin`, `/opt/homebrew/bin` et
`/usr/local/bin` (une application lancée depuis le Finder n’hérite pas du
`PATH` de votre shell). La section Réglages › Outils indique ceux qui ont été
trouvés. `YTDLP_PATH=/chemin/vers/yt-dlp` permet de remplacer la recherche de
yt-dlp.

Pour les vidéos privées, réservées aux membres ou soumises à une limite d’âge,
ainsi que pour la plupart des contenus de X, vous aurez besoin des cookies de
votre navigateur : exportez-les dans un fichier Netscape `cookies.txt` (par
exemple avec l’extension « Get cookies.txt LOCALLY »), puis sélectionnez ce
fichier dans les Réglages.

## Développement

Il vous faut [Rust](https://rustup.rs), [Bun](https://bun.sh) et les outils
indiqués ci-dessus.

```bash
bun install
bun run tauri dev      # lancer l’application avec rechargement à chaud
bun run check          # exécuter tous les contrôles ci-dessous, dans l’ordre
```

Pour travailler sur le design, lancez `bun run dev` et ouvrez
http://localhost:1420 dans un navigateur. En dehors de Tauri, l’interface
utilise un faux backend avec des données d’exemple
(`src/dev/browserPreview.ts`, uniquement en développement). La direction
visuelle est décrite dans `.taste-skill/app/direction.json` et résumée au début
de `src/App.css`.

| Commande | Vérification | Durée |
| --- | --- | --- |
| `bun test` | Logique frontend dans `src/lib/` | < 1 s |
| `bunx tsc --noEmit` | Types frontend, y compris le client IPC | ~2 s |
| `cargo test` (dans `src-tauri/`) | Backend : base de données, file d’attente, arguments et parsing de yt-dlp, nouvelles tentatives avec un faux yt-dlp | ~4 s |
| `cargo clippy --all-targets` | Lints Rust | ~5 s |
| `cargo test -- --ignored` | Tests en direct avec YouTube et votre yt-dlp (réseau requis) | ~1 min |

Construire une `.app` : `bun run tauri build` (non signée, pour un usage
personnel). Nécessite Xcode 26 ou une version ultérieure : l’icône de
l’application est un fichier Icon Composer compilé au moment de créer le bundle
([ADR 0009](docs/adr/0009-brand-icon-and-faces.md)). Pour préparer une release :
[docs/releasing.md](docs/releasing.md).

Les données sont stockées dans
`~/Library/Application Support/com.yank.app/yank.db` (SQLite), les journaux
dans `~/Library/Logs/com.yank.app/yank.log` et les téléchargements dans
`~/Movies/Yank`, sauf si vous choisissez un autre dossier.

## Se repérer dans le code

Commencez par lire [docs/architecture.md](docs/architecture.md) : le document
suit une URL, de la zone de collage jusqu’au fichier sur le disque, et indique
le fichier utilisé à chaque étape.

```
src/                    Interface React
  api.ts                Tous les appels backend, typés (seul endroit avec les noms de commandes)
  types.ts              Répliques des types Rust
  App.tsx               Assemble les hooks
  hooks/                État : bibliothèque, téléchargements, réglages, lecteur/file de lecture, YouTube
  lib/                  Logique pure avec tests unitaires (filtres, formatage, regroupement)
  components/           Vues (youtube/ contient l’écran YouTube)
src-tauri/src/          Backend Rust
  lib.rs                Démarrage et liste des commandes
  commands/              Surface IPC, volontairement légère
  downloads/            Exécution de la file : ajout, worker, nouvelles tentatives, processus yt-dlp
  ytdlp/                Recherche, appel et parsing de yt-dlp ; recherche et flux YouTube
  db/                   SQLite, un fichier par table
  settings.rs, models.rs
src-tauri/migrations/   Schéma, appliqué au démarrage
docs/adr/               Raisons des choix techniques
scripts/release.py      Mise à jour de version et changelog (avec uv)
GLOSSARY.md             Vocabulaire utilisé par le code
```

## Licence

[MIT](LICENSE). Historique des versions : [CHANGELOG.md](CHANGELOG.md).
