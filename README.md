# OneKey — The Voice-First Keyboard Replacement for Windows

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 45 Passed](https://img.shields.io/badge/Tests-45%20Passing-brightgreen.svg)]()
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D6.svg)]()
[![Wispr Flow Compatible](https://img.shields.io/badge/Wispr%20Flow-Native%20Trigger-purple.svg)](https://wisprflow.ai/)
[![Challenge: WeMakeDevs](https://img.shields.io/badge/Challenge-WeMakeDevs%20No%20Hands-orange.svg)]()

> **Reclaim your desk. OneKey transforms your voice into universal desktop control, replacing the physical keyboard with instant, deterministic Windows actions.**
> Built for the **Wispr Flow — No Hands Challenge** by **WeMakeDevs**.

---

## Table of Contents
1. [The Vision: Replacing the Keyboard with OneKey](#the-vision-replacing-the-keyboard-with-onekey)
2. [Why Replace the Keyboard?](#why-replace-the-keyboard)
3. [System Architecture](#system-architecture)
4. [Core Components Deep Dive](#core-components-deep-dive)
5. [Wispr Flow & Voice Trigger Integration](#wispr-flow--voice-trigger-integration)
6. [Comprehensive Command Reference](#comprehensive-command-reference)
7. [Deterministic Safety & Security Philosophy](#deterministic-safety--security-philosophy)
8. [Developer & System Controls](#developer--system-controls)
9. [Custom Macros & Command Aliases](#custom-macros--command-aliases)
10. [Configuration & Settings](#configuration--settings)
11. [Installation & Developer Guide](#installation--developer-guide)
12. [Verification & Automated Testing](#verification--automated-testing)
13. [Privacy & Local-First Guarantee](#privacy--local-first-guarantee)
14. [License](#license)

---

## The Vision: Replacing the Keyboard with OneKey

For over fifty years, the computer keyboard has remained the primary bottleneck between human intention and digital execution. To navigate modern operating systems, developers and power users must memorize hundreds of multi-key shortcuts (`Ctrl+Alt+I`, `Win+Left`, `Ctrl+Shift+Tab`, `Alt+F4`), repeatedly reach across mice and trackpads, and manually type boilerplate text.

**OneKey re-engineers this paradigm by replacing the physical keyboard with natural speech.**

Instead of:
- Pressing `Win+R`, typing `notepad`, and hitting `Enter` &rarr; Say: **"Open Notepad, Wispr Flow"**
- Pressing `Alt+Tab` ten times to find Spotify &rarr; Say: **"Switch to Spotify"**
- Pressing `Win+Right` to dock an editor &rarr; Say: **"Snap window to the right"**
- Pressing `Ctrl+G`, typing `142`, hitting `Enter` in VS Code &rarr; Say: **"Go to line 142"**
- Reaching for the mouse to click an app &rarr; Say: **"Double click"**
- Typing out repetitive phrases or code prompts &rarr; Speak your prompt and submit instantly.

OneKey does not just sit alongside your keyboard; **it is engineered to make your keyboard obsolete for day-to-day navigation, window orchestration, text entry, and system automation**.

```
   ┌──────────────────────────────────────────────────────────────┐
   │                   HUMAN VOICE / DICTATION                   │
   │           "Snap this window to the left, Wispr Flow"        │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │               FLOATING HUD (renderer/renderer.js)            │
   │       Ultra-lightweight, always-on-top glassmorphic pill     │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │             DETERMINISTIC PARSER (src/parser.js)             │
   │  Tokenization • Strips trailing trigger • AST generation    │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │           SCHEMA & VALIDATION (src/schema.js)                │
   │   Allowlist verification • Path bounds check • Safe guards   │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │             STATE PIPELINE (src/pipeline.js)                 │
   │   Auto-run countdown timer • Confirmations • Undo / History  │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │            NATIVE EXECUTOR (src/executor.js)                 │
   │  Win32 API • PowerShell • Clipboard Injection • User32 Hook  │
   └──────────────────────────────────────────────────────────────┘
```

---

## Why Replace the Keyboard?

| Physical Keyboard Friction | The OneKey Solution |
|---|---|
| **Ergonomic Strain (RSI & Carpal Tunnel)** | Hands remain relaxed or off the desk entirely; voice takes over window management, typing, and mouse clicks. |
| **Cognitive Overhead (Shortcut Fatigue)** | No need to memorize obscure key combos (`Ctrl+K, Ctrl+S`, `Win+Shift+S`); simply speak the intended action plain English. |
| **Context Switching (Alt-Tab Hunting)** | Jump straight to any active window by its title or process name without cycling through endless icons. |
| **Developer Productivity** | Navigate files, jump to line numbers, trigger code copilot chats, and create workspace folders without lifting your hands from your thinking flow. |
| **Accessibility First** | Provides full desktop autonomy for individuals with motor impairments or mobility limitations. |

---

## System Architecture

OneKey is built on a high-performance, resilient Electron and Node.js architecture coupled with native Windows PowerShell/Win32 APIs.

```
onekey/
├── main.js                  # Electron application lifecycle & native OS hooks
├── preload.js               # Context-isolated IPC secure bridge (window.onekey)
├── package.json             # App manifest, build configurations & dependencies
├── LICENSE                  # MIT License
├── .gitignore               # Version control ignore rules
├── renderer/
│   ├── index.html           # Floating HUD UI, modal popups, command history
│   ├── styles.css           # Glassmorphic dark styling & responsive states
│   └── renderer.js          # HUD UI logic, auto-submit listener & shortcut hooks
├── src/
│   ├── parser.js            # Natural language tokenizer & trigger stripper
│   ├── schema.js            # Strict action schema definitions & validation
│   ├── executor.js          # Win32 automation executor (apps, keys, mouse, power)
│   ├── pipeline.js          # Finite state machine handling confirmations & undo
│   ├── store.js             # Electron userData configuration & history persistence
│   ├── defaults.js          # Default configuration factory
│   ├── appmatch.js          # Fuzzy matching algorithm for Windows Start Menu apps
│   ├── sysops.js            # High-level system automation helpers
│   ├── winops.js            # Window enumeration and focus helpers
│   ├── speech.js            # Windows Speech Recognition engine child process wrapper
│   ├── aliases.js           # Custom multi-step macro validator and executor
│   └── llm.js               # AI natural language fallback parser (OpenAI / Groq)
├── ps/
│   ├── sys.ps1              # PowerShell engine for keys, mouse, apps, power & display
│   ├── win.ps1              # User32/Win32 window handle enumeration & activation
│   ├── listen.ps1           # Offline Windows System.Speech dictation bridge
│   └── speak.ps1            # Windows System.Speech.Synthesis TTS feedback
└── test/
    ├── parser.test.js       # Comprehensive unit tests for parser & grammar
    ├── generic.test.js      # Unit tests for desktop, mouse, window & power actions
    ├── executor.test.js     # Unit tests for executor actions and undo logic
    └── pipeline.test.js     # Unit tests for the state machine and confirmation flows
```

---

## Core Components Deep Dive

### 1. The Floating HUD (`renderer/`)
- Sits unobtrusively at the center bottom of your screen (`screen-saver` window level, always-on-top, borderless, transparent background).
- Houses an active command input bar, status badge (`Ready`, `Listening`, `Running`, `Pending`, `Input needed`, `Done`, `Failed`), history flyout, and settings launcher.
- Automatically expands upward to display confirmation chips when sensitive tasks (like closing windows or system shutdowns) are scheduled.

### 2. The Deterministic Parser (`src/parser.js`)
Unlike fragile LLM-only voice tools that suffer from hallucination, latency, and unpredictable outputs, OneKey uses an **ultra-fast, deterministic rule parser**:
- **Zero Latency**: Executes locally in under 1 millisecond.
- **Smart Number Conversion**: Translates spoken numbers ("twenty seven", "line forty five") into exact integers.
- **Key Combination Parsing**: Converts phrases like `"press control shift t"` into Win32 SendKeys format (`^+t`).
- **Trailing Voice Trigger Stripping**: Automatically recognizes trailing words like `"Wispr Flow"` or `"enter"` to trigger instant execution while stripping them from the payload.

### 3. Strict Safety Schema (`src/schema.js`)
- Enforces an allowlist of permitted actions (`SPECS`). Unregistered actions are immediately rejected.
- **Filesystem Sandbox Protection**: Guarantees folder creation only occurs within pre-approved base locations (`Documents`, `Desktop`, `Downloads`). Prevents directory traversal attacks (`../`, illegal characters, Windows reserved names like `CON`, `NUL`, `PRN`).
- **URL Sanitization**: Rejects dangerous schemes (`file://`, `javascript:`, credentials); only standard `http` and `https` protocols are allowed.

### 4. Native OS Executor (`src/executor.js` & `ps/sys.ps1`)
- **Clipboard-Based Text Injection**: Typing text via standard simulated keystrokes causes missed characters on high-load machines. OneKey backs up your current clipboard, writes the dictated text, sends `Ctrl+V`, waits for completion, and cleanly restores your previous clipboard content.
- **Start Menu App Resolution**: Integrates with PowerShell `Get-StartApps` to search any installed Windows application (UWP apps, legacy Win32, Store packages) with fuzzy matching.
- **Window Management Engine**: Interfaces directly with Win32 `User32.dll` to bring windows forward, snap them to left/right halves, minimize, maximize, and capture screenshots.

---

## Wispr Flow & Voice Trigger Integration

OneKey is designed to pair seamlessly with **Wispr Flow**, the state-of-the-art neural dictation system.

### How the Synergy Works
1. Press your Wispr Flow dictation hotkey anywhere in Windows.
2. Dictate your command into the OneKey HUD.
3. Finish your sentence with **"Wispr Flow"** (e.g., *"Open Google Chrome, Wispr Flow"*).
4. OneKey's `checkAutoSubmit` listener detects the trigger, strips the trailing trigger words, and executes your command instantly without touching the keyboard.

---

## Comprehensive Command Reference

### 1. App Launching & Window Switching (Replacing Alt+Tab & Start Menu)
| What You Say | Action Performed |
|---|---|
| `Open VS Code` / `Launch Code` | Focuses running VS Code, or launches the configured executable. |
| `Open Calculator` / `Start Spotify` | Resolves installed apps via Start Menu and launches them. |
| `Switch to Chrome` / `Focus Edge` | Instantly switches to the active browser window. |
| `Focus <Window Title>` | Searches all open windows and brings the best match forward. |

### 2. Window Control & Docking (Replacing Windows Shortcuts)
| What You Say | Keyboard Equivalent |
|---|---|
| `Move this window to the left` / `Snap left` | `Win + Left Arrow` |
| `Shift my window to the right` / `Snap right` | `Win + Right Arrow` |
| `Maximize this window` / `Full screen` | `Win + Up Arrow` |
| `Minimize this window` | `Win + Down Arrow` |
| `Restore window` | Restores window to normal dimensions |
| `Close window` | Confirmed window close (replaces dangerous `Alt + F4`) |

### 3. Mouse Navigation & Clicking (Replacing the Physical Mouse)
| What You Say | Action Performed |
|---|---|
| `Move cursor to center` / `Move mouse to middle` | Glides cursor smoothly to the center of the active window |
| `Move cursor top right` / `bottom left` | Glides cursor to corner regions or close buttons |
| `Move mouse left 300 pixels` / `Move cursor up` | Directional cursor movement with custom pixel distances |
| `Click` / `Single click` / `Left click` | Simulates left mouse button click |
| `Right click` | Opens context menu at current cursor location |
| `Double click` | Simulates rapid double click |

### 4. Keyboard Simulation & Direct Typing
| What You Say | Action Performed |
|---|---|
| `Type hello world and enter` | Pastes "hello world" into active window and sends `Enter` |
| `Press control shift t` | Sends `Ctrl + Shift + T` (reopens last closed tab) |
| `Press escape` / `Hit enter` | Sends `Esc` or `Enter` keys |
| `Zoom in` / `Zoom out` / `Reset zoom` | Sends `Ctrl + +`, `Ctrl + -`, `Ctrl + 0` |
| `Page up` / `Page down` | Sends `PageUp` or `PageDown` keys |

### 5. Web Browsing & Search (Replacing Browser URL Typing)
| What You Say | Action Performed |
|---|---|
| `Search for quantum computing` | Opens Google search in default browser |
| `Search YouTube for lo-fi hip hop` | Opens YouTube search results directly |
| `Search GitHub for electron` | Opens GitHub search results |
| `Go to github dot com` / `Open reddit.com` | Opens specified URL (validates http/https) |
| `New tab` | Sends `Ctrl + T` to active browser |
| `Next tab` / `Previous tab` | Sends `Ctrl + Tab` / `Ctrl + Shift + Tab` |

### 6. Developer Workflow (Visual Studio Code)
| What You Say | Action Performed |
|---|---|
| `Go to line 42` | Focuses VS Code, sends `Ctrl + G`, enters `42`, presses `Enter` |
| `Find authentication in the current file` | Focuses VS Code, sends `Ctrl + F`, pastes search query |
| `Open Copilot` | Sends configured Copilot shortcut (`Ctrl + Alt + I`) |

### 7. Filesystem Organization
| What You Say | Action Performed |
|---|---|
| `Create a folder called Project Alpha in Documents` | Safely creates folder inside approved location |
| `Open folder Project Alpha in Documents` | Launches Windows File Explorer directly inside the folder |
| `Undo last action` | Deletes the last folder created if it remains empty |

### 8. System Power Management
| What You Say | Action Performed |
|---|---|
| `Lock my computer` / `Lock screen` | Locks Windows workstation |
| `Sleep` / `Put computer to sleep` | Puts PC into low-power sleep mode |
| `Shut down my computer` | Schedules shutdown with 30s abort timer (requires confirmation) |
| `Restart my laptop` | Schedules restart with 30s abort timer (requires confirmation) |
| `Cancel shutdown` | Cancels any pending shutdown or reboot (`shutdown /a`) |

---

## Deterministic Safety & Security Philosophy

Replacing the keyboard means granting voice commands system-level authority. OneKey employs a **defense-in-depth safety design**:

1. **Confirmation Gates for Consequential Operations**:
   Destructive actions—such as shutting down the PC, closing a window, or executing system reboots—are classified as `CONSEQUENTIAL`. OneKey halts execution, displays a confirmation banner, and requires an explicit spoken *"confirm"* or physical button click before touching the OS.
2. **Auto-Run Delay Timer (`autoRunDelayMs`)**:
   Standard actions (such as opening an app or creating a folder) feature a configurable grace period (default: 1.5 seconds) with a countdown bar. If you spoke by mistake, simply say *"cancel"* or press `Esc` to stop execution before it happens.
3. **Execution Transparency Badges**:
   Every command records an audit trail with verification status:
   - **`Done` (Green)**: The action was verified by the filesystem or window handle confirmation.
   - **`Sent (unverified)` (Orange)**: Keystrokes or messages were delivered, but the internal application reaction cannot be independently audited.
   - **`Failed` (Red)**: The action was safely rejected or encountered an OS error without altering state.

---

## Custom Macros & Command Aliases

OneKey allows you to chain multiple actions into a single voice trigger using JSON aliases in Settings.

### Example 1: Morning Development Setup ("Start My Day")
```json
[
  { "type": "OPEN_APP", "appId": "vscode" },
  { "type": "OPEN_URL", "url": "https://github.com" },
  { "type": "LAUNCH_APP", "name": "Spotify" }
]
```
Say: **"Start my day"** &rarr; VS Code launches, GitHub opens in your browser, and Spotify starts playing.

### Example 2: Focus / Deep Work Mode ("Deep Work")
```json
[
  { "type": "WINDOW_SNAP", "mode": "maximize" },
  { "type": "PRESS_KEYS", "keys": "^%i" }
]
```

---

## Configuration & Settings

Access settings by pressing `Ctrl + ,` or clicking the gear icon on the HUD.

| Setting | Description | Default |
|---|---|---|
| `hotkey` | Primary global hotkey to show/focus the HUD | `CapsLock` |
| `fallbackHotkey` | Fallback hotkey if primary is reserved by Windows | `CommandOrControl+Shift+Space` |
| `autoRunDelayMs` | Cancellation countdown before non-risky actions run | `1500` ms |
| `confirmAll` | Require manual confirmation for every single action | `false` |
| `approvedLocations` | Allowlisted root directories for folder creation | `Documents`, `Desktop`, `Downloads` |
| `apps.vscode.exe` | Explicit path to VS Code executable | `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe` |
| `apps.browser.exe` | Explicit browser executable (empty = system default) | `""` |
| `copilotShortcut` | SendKeys string for Copilot Chat trigger in VS Code | `^%i` (`Ctrl+Alt+I`) |
| `llm.enabled` | Enable AI natural language fallback parser | `false` |
| `llm.provider` | Provider for AI fallback (`openai` / `gemini` / `anthropic`) | `openai` |
| `llm.apiKey` | Encrypted API key (saved via Electron `safeStorage`) | `""` |

---

## Installation & Developer Guide

### Prerequisites
- **Operating System**: Windows 10 or 11 (64-bit).
- **Node.js**: Version 20.x or later.
- **PowerShell**: Windows PowerShell 5.1 (standard built-in `powershell.exe`).
- **Dictation**: [Wispr Flow](https://wisprflow.ai/) (recommended) or Windows Speech Recognition.

### 1. Clone & Install Dependencies
```powershell
git clone https://github.com/KrishnaKapoor612/onekey.git
cd onekey
npm install
```

### 2. Run in Development Mode
```powershell
npm start
```
The OneKey floating HUD will appear at the bottom center of your display.

### 3. Run Automated Test Suite
```powershell
npm test
```
Runs 45 comprehensive unit and integration tests across deterministic parsing, schema validation, macro aliasing, and OS call simulations.

### 4. Package for Production (Installer)
```powershell
npm run dist
```
Uses `electron-builder` to package an optimized NSIS standalone Windows installer inside the `dist/` directory.

---

## Verification & Automated Testing

OneKey includes an extensive suite of automated tests (`test/`) ensuring zero-regression stability:

```powershell
node --test
```

Key test coverages:
- **`parser.test.js`**: Verifies exact regex parsing, folder parameter resolution, line number conversions, trailing trigger stripping (`Wispr Flow`, `enter`), and URL normalization.
- **`generic.test.js`**: Tests window snap calculations, mouse movement parameters, start-menu app fuzzy matching, and power state changes.
- **`pipeline.test.js`**: Tests state machine transitions (`idle` &rarr; `pending` &rarr; `executing` &rarr; `success`), cancellation timers, and confirmation blocks.
- **`executor.test.js`**: Validates mock-based execution paths, non-empty directory undo protection, and safe clipboard restore cycles.

---

## Privacy & Local-First Guarantee

- **Zero Cloud Recording**: OneKey never streams or stores your raw voice audio. Dictation is processed locally or handed to your chosen speech provider (Wispr Flow / Windows Speech API).
- **Local History & Settings**: Command history (last 30 entries), aliases, and configuration files are stored exclusively on your local machine in `%APPDATA%\onekey`.
- **Encrypted Secrets**: Sensitive API keys entered for optional LLM fallbacks are encrypted on disk using Electron's native `safeStorage` (backed by Windows DPAPI).
- **Open & Auditable**: Every single PowerShell command executed by OneKey is inspectable in plain text inside the `ps/` directory.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <b>OneKey</b> — Free your hands. Speak your commands. Replace the keyboard.<br>
  <i>Submitted for the Wispr Flow — No Hands Challenge (WeMakeDevs)</i>
</p>
