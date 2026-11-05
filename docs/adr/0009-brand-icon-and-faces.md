# The Dock icon follows the system's icon style; the in-app mark does not

Yank's brand is a script "y" on a rounded tile, in pink `#ff4a61`, with a light icon (pink tile, white y) and a dark one (near-black tile, pink y). The brand face is Kapakana. The app shows no wordmark: the mark beside the window controls is enough, and the script word read as one thing too many in the top bar.

The app icon is the owner's Icon Composer document, kept as source in `src-tauri/icons/yank.icon`. `scripts/macos-icon.sh` compiles it with `actool` into `Assets.car` at bundle time (Tauri's `beforeBundleCommand`), and `src-tauri/Info.plist` names it with `CFBundleIconName`. The catalog carries the default, dark and tinted appearances. macOS 26 picks one from System Settings › Appearance › Icon & widget style (Default, Dark, Clear, Tinted), a setting separate from light and dark mode: in dark mode with the Default style, Yank's Dock icon stays the pink tile, as Finder's and Mail's stay light. The compiled catalog is a build product and is never committed. `icon.icns` stays in the bundle for systems that predate asset-catalog icons. Building needs Xcode 26 or later, which is what reads `.icon` documents.

Inside the window the mark is always the light icon. The dark icon is drawn for the Dock and a wallpaper. On Yank's true-black top bar its tile disappears and its thin pink stroke blurs at 30px, and the light tile is legible in both appearances. The favicon (`public/yank.svg`) follows light and dark mode, which is all a browser exposes.

Kapakana has one job: the first-run greeting, the only headline of an empty library. Everything you read stays in Inter, at 500 for titles so it does not outweigh the hairline script. Only Kapakana's Latin subset ships (18 KB); the package's Japanese subsets would add about 0.9 MB.

The pink is the one accent and stays on data. Errors moved to orange `#ff9f43` and to a square label, so a failed download never reads as one in progress.
