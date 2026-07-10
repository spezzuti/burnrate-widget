# BurnRate

BurnRate is a desktop widget for **Windows, macOS, and Linux** that shows how much of your AI usage you've burned through — in real time, from your system tray.

It's a fork of [claude-usage-widget](https://github.com/SlavomirDurej/claude-usage-widget) by Slavomir Durej (MIT licensed), which tracks Claude.ai usage only. BurnRate keeps everything that widget does for Claude and adds two more providers: **OpenAI Codex** (via your ChatGPT subscription) and **OpenRouter**. Full credit to the original project and its contributors for the widget's core design.

![Claude Usage Widget, the original claude-usage-widget UI that BurnRate is built on](assets/screenshot-main.png)
<sub>This screenshot is from the upstream claude-usage-widget project and predates BurnRate's multi-provider UI, rebrand, and Fable row — kept here as a nod to where the widget started.</sub>

---

## Providers

Each provider is independently toggleable in Settings. Disabling one stops it from polling entirely.

### Claude (claude.ai)

- Session (5h) and weekly usage bars with circular countdown timers and reset times
- Expandable per-model breakdown: Sonnet, Opus, Cowork, Design, and OAuth apps usage, plus extra usage spend/credits
- 7-day usage history graph
- Optional tray icons showing live session and weekly percentages (enable "Show tray stats" in Settings)
- Sign in by logging into claude.ai in an embedded window (the session cookie is captured automatically) or by pasting a session key manually
- Multi-organization support — if your account belongs to more than one org, a selector appears
- **Fable**: scoped weekly limits available on some Claude plans are auto-detected and pinned as their own teal row directly under Weekly, with their own show/hide checkbox. Uncheck it and Fable data still appears in the expandable per-model breakdown instead.

### OpenAI Codex (ChatGPT subscription)

- 5-hour and weekly rate-limit windows
- Zero configuration — reads your existing Codex CLI login from `~/.codex/auth.json`
- If you're not logged in via the Codex CLI, or the token has expired, the section shows a status line instead of failing
- Uses an unofficial ChatGPT usage endpoint, so it may break if OpenAI changes it; the widget parses it defensively and won't crash if the shape changes

### OpenRouter

- Spend today / this week / this month, plus remaining credits
- Uses your own OpenRouter API key, entered once in Settings
- Polled at most once per 60 seconds to stay well under any rate limits

---

## Visibility, Compact Mode & Alerts

- **Per-provider toggles** — turn Claude, Codex, or OpenRouter on/off entirely
- **Per-row checkboxes** — independently show/hide Claude session, weekly, and Fable; Codex session and weekly; OpenRouter today, week, month, and credits
- The window automatically resizes to fit whatever rows are currently visible
- **Compact mode** shrinks the widget to a minimal multi-provider view: Claude session/weekly (plus the Fable bar when present), Codex session/weekly, and an OpenRouter credits line. Height adapts to whichever providers you have enabled.
- **Usage alerts** — desktop notifications when Claude's session, weekly, or any individual model row (Sonnet, Opus, Fable, other scoped limits) crosses your configured warn/danger thresholds

---

## Other Features

- Always-on-top, autostart at login, minimize to system tray
- Dark / Light / System themes
- 12h or 24h time format
- Configurable refresh interval, from every 15 seconds to every 5 minutes
- Configurable warning (default 75%) and danger (default 90%) thresholds, applied to every usage bar's color
- Automatic update check against GitHub Releases on startup

---

## Installation

### Download a Release

Grab the latest build from the [Releases](../../releases) page:

- **Windows:** `BurnRate-{version}-win-Setup.exe` (installer) or `BurnRate-{version}-win-portable.exe` (no install needed)
- **macOS:** `BurnRate-{version}-macOS-arm64.dmg` (Apple Silicon) or `BurnRate-{version}-macOS-x64.dmg` (Intel)
- **Linux:** `BurnRate-{version}-linux-x86_64.AppImage` or `BurnRate-{version}-linux-arm64.AppImage`

> **macOS:** if a release isn't notarized, Gatekeeper may show a "damaged or can't be opened" warning. Fix it by running `xattr -cr /Applications/BurnRate.app` in Terminal, then launch again.

> **Linux:** AppImages run without installation. On Ubuntu 22.04+ you may need `sudo apt install libfuse2` first.

### Build from Source

**Prerequisites:** Node.js 18+ and npm.

```bash
git clone https://github.com/spezzuti/burnrate-widget.git
cd burnrate-widget
npm install
npm start
```

To produce installable artifacts:

```bash
npm run build:win     # NSIS installer + portable exe
npm run build:mac     # DMG (arm64 + x64)
npm run build:linux   # AppImage (x64 + arm64)
```

---

## Usage

### First Launch

1. Launch BurnRate — it starts with Claude enabled by default
2. Click "Login to Claude" and sign in through the embedded claude.ai window (or paste a session key manually)
3. Open Settings (gear icon) to enable Codex and/or OpenRouter, and to pick which rows you want visible
4. Codex picks up your existing `codex login` session automatically — no extra setup needed
5. For OpenRouter, paste an API key from [openrouter.ai/keys](https://openrouter.ai/keys)

### Widget Controls

- **Drag** the title bar to move the widget
- **Refresh** icon to update data immediately
- **Graph** icon to toggle the Claude usage history chart
- **Minimize** icon to hide to the system tray / dock
- **Gear** icon to open Settings
- **X** to close the app

### System Tray

BurnRate always keeps a tray icon for showing/hiding the widget; enable "Show tray stats" in Settings to turn it into two icons displaying live Claude session % and weekly %. Right-click for: Show Widget, Refresh, Log Out, Exit.

---

## Config Location

Settings and encrypted credentials are stored via Electron's standard per-app data directory:

- **Windows:** `%APPDATA%\BurnRate` (installed/packaged build) or `%APPDATA%\burnrate-widget` (running from source)
- **macOS:** `~/Library/Application Support/BurnRate` (or `burnrate-widget` from source)
- **Linux:** `~/.config/BurnRate` (or `burnrate-widget` from source)

---

## Privacy & Security

- BurnRate talks only to **claude.ai**, **chatgpt.com** (for Codex usage), **openrouter.ai**, and **api.github.com** (for the startup update check against this repo's releases). No telemetry, no third-party analytics.
- Your Claude session key and OpenRouter API key are encrypted at rest using your OS's native secure storage (DPAPI on Windows, Keychain on macOS, libsecret on Linux) via Electron's `safeStorage`. If OS-level encryption isn't available on your system, credentials fall back to plaintext storage locally — they are never sent anywhere except the provider they belong to, and the OpenRouter key is never displayed back in the UI once saved.
- Codex needs no key at all — it reuses your local Codex CLI login.
- "Log Out" from the tray menu clears your Claude session key, org ID, and all claude.ai cookies/session storage.
- BurnRate is an **unofficial** tool and is not affiliated with Anthropic, OpenAI, or OpenRouter.

---

## Troubleshooting

**"Login Required" keeps appearing (Claude)** — your session likely expired. Click "Login to Claude" to re-authenticate, or "Log Out" from the tray menu and log back in.

**Codex section shows a status line instead of data** — run `codex login` from the Codex CLI, then refresh.

**OpenRouter section shows an error** — double check the API key in Settings and that it hasn't been revoked at [openrouter.ai/keys](https://openrouter.ai/keys).

**Widget not updating** — check your internet connection, click refresh manually, or re-login from the tray menu.

**Build errors** — clean reinstall usually fixes it:
```bash
rm -rf node_modules package-lock.json
npm install
```

---

## Contributors

BurnRate's foundation comes from claude-usage-widget. Special thanks to its contributors:

- [@cwil2072](https://github.com/cwil2072) - macOS minimize/restore fix, usage history graph
- [@dion-jy](https://github.com/dion-jy) - Login flow architecture improvements
- [@goooseman](https://github.com/goooseman) - Login window security improvements
- [@sergkuzn](https://github.com/sergkuzn) - Linux desktop launcher & autostart documentation
- [@irishpolyglot](https://github.com/irishpolyglot) - Scoped weekly limits (Fable) support and extra-row timer fix, adopted from their upstream PR

---

## License

This project is licensed under the [MIT License](LICENSE) — see the LICENSE file for details.

---

*Built with Electron · [Releases](../../releases) · [Discussions](../../discussions)*
