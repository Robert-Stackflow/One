# One installer

The setup window is an Electron application (`main.cjs`, `preload.cjs`, and the HTML/CSS/JS files here). The Windows installation engine remains the NSIS package built from the main application. `npm run package:installer` packages both as one portable executable and makes the Electron window the default installer. `npm run package:installer:engine` builds only the NSIS engine.

The user can browse for a directory or edit the path directly. An existing installation is backed up and removed before installing at the chosen location; an installation failure restores the prior program, registry entries, and Start menu shortcut. The application profile is preserved.

Before installation, the setup window checks whether One is running. It offers a normal quit request through One's single-instance channel and waits for all One processes to exit. Older installations that do not handle this request can be closed from their tray menu; only after a normal quit fails does the UI offer an explicit force-quit choice. The setup requests Windows administrator permission before writing program files. If the UAC prompt is declined, it leaves the existing installation untouched.

To verify the window, run `npm run test:installer:ui` after building the custom installer. To test real install, relocation, failure recovery, and uninstall without touching the production One identity, first run `node tests/installer-lifecycle.cjs` to create a unique fixture, then run `npm run test:installer:integration`.
