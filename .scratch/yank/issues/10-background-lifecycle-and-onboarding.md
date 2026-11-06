# 10: Background lifecycle and onboarding

**What to build:** First-run onboarding (choose folder, bootstrap binaries, optional cookies import, skippable/re-runnable). Closing the window hides to macOS menu bar with downloads continuing and an active-count badge; quit from menu bar cancels with confirmation. Deletion semantics: "Remove from library" vs "Delete file and entry".

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] First-run onboarding flow with skip and re-run from Settings (today: default folder, Settings covers the rest)
- [ ] Menu-bar background mode with active download badge
- [ ] Quit confirmation when downloads are active
- [x] Deletion offers "Remove from library" (keeps the file) and "Delete file" (moves it to the Trash)
- [x] Cookies.txt import in Settings

## Comments

- 2026-11-04 (daniel/finish-yank): Deletion semantics done (Remove from library vs Delete file). Downloads default to ~/Movies/Yank so first launch works without onboarding, but the onboarding flow itself and menu-bar mode are still open.
