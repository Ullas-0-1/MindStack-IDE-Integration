# MindStack Code Observer 

MindStack is an intelligent, automated coding context engine that lives securely inside your VS Code Editor. It silently observes your active workspace, captures terminal errors, monitors project structure changes, and builds a powerful context bridge to the MindStack web dashboard.

##  Key Features & Workflows

### 1. Automated Bug Fix Tracking (`IDE_TERMINAL_ERROR`)
* **How it works:** MindStack silently listens to the integrated VS Code terminal for command failures (e.g., `npm ERR!`, `fatal:`, `Exception`). 
* **The Process:** Upon detecting a failure, it waits for a 2-second debounce window to ensure the entire stack trace has printed. It then instantly captures the complete error log, along with a `git diff HEAD` of your currently active file, and sends the exact breaking state straight to the MindStack dashboard.
* **Why:** The AI will have perfect, chronological context of exactly what broke and what your code looked like at the exact millisecond it failed.

### 2. Automated Progress Snapshots (`IDE_PROGRESS_SNAPSHOT`)
* **How it works:** A background interval runs cleanly every 30 minutes while an active session is running.
* **The Process:** It maps your entire directory structure (safely ignoring `.git`, `node_modules`, and `.env` files for privacy) and captures a total repository `git diff`. 
* **Why:** This ensures the backend AI always maintains an up-to-date, structural understanding of your entire codebase without you having to manually upload files.

### 3. Sidebar Vault & S3 Dropzone
* **How it works:** The React-powered sidebar provides an interactive Dropzone for visual context.
* **The Process:** Drag and drop architecture diagrams (Images) or specification documents (PDFs) into the sidebar. The extension converts the file, negotiates a presigned URL, and securely commands the VS Code Host to upload it directly to your AWS S3 bucket.
* **Why:** You can inject heavy visual context straight into your AI session without leaving the editor.

### 4. Code Context Highlighting
* **How it works:** A native VS Code context menu integration (`mindstack.sendHighlight`).
* **The Process:** Highlight any complex code block or documentation in your editor, right-click, and select **"Send to MindStack"**. An input box will prompt you for an optional note, and the selection is immediately synced to the backend vault.

### 5. Multi-Tenant Team Workspaces
* **How it works:** Native support for the MindStack dual-routing architecture.
* **The Process:** Use the sleek toggle at the top of the sidebar to switch between "Personal" projects and shared "Team" workspaces. All background trackers (Error Bug Catcher, Progress Snapshots, Code Highlights, and S3 Dropzone) instantly adapt their API payloads to stream your local context straight to your shared, collaborative team dashboard!

---

##  Project Structure

The extension is built using a modern architecture separating the **Extension Host** (Node.js/TypeScript) from the **Sidebar Webview** (React/Vite).

```text
MindStack_IDE_Extension/
├── src/                        # VS Code Extension Host (Backend)
│   ├── extension.ts            # The main entry point that activates the extension
│   ├── SidebarProvider.ts      # The bridge that connects the React Webview to VS Code APIs
│   ├── sessionManager.ts       # Handles start/stop/heartbeat logic for MindStack sessions
│   ├── supabaseClient.ts       # Supabase database connection and authentication
│   └── captures/               # The brain of the automated features
│       ├── ideBugFix.ts        # Listens to the terminal, captures errors & git diffs
│       ├── progressSnapshot.ts # Runs the 30-minute interval repo snapshot and diff
│       └── manualHighlight.ts  # Adds the right-click context menu "Send to MindStack"
│
├── webview-ui/                 # React & Vite Frontend (Sidebar interface)
│   ├── src/
│   │   ├── components/         # React UI Components
│   │   │   ├── Dashboard.tsx   # Main session controls and project selector
│   │   │   ├── Dropzone.tsx    # Drag-and-drop S3 file upload handler
│   │   │   └── Projects.tsx    # Renders the active projects list
│   │   ├── App.tsx             # Main React application entry
│   │   └── utils/vscode.ts     # The message-passing bridge sending data back to the Host
│   ├── package.json            # Frontend dependencies (React, Vite, Lucide)
│   └── vite.config.ts          # Bundles the React app into a single index.js/css file
│
├── media/                      # Static assets used by the extension
│   └── webview/                # The final compiled React build goes here
│
├── package.json                # Main Extension manifest (defines permissions, commands, API flags)
├── .vscodeignore               # Tells the packager which files to EXCLUDE from the final build
└── .gitignore                  # Tells Git which files to EXCLUDE from GitHub (like node_modules, .env)
```

---

## Installation

Because MindStack utilizes advanced, proposed VS Code APIs to securely read your terminal output, it cannot be installed directly from the public marketplace yet. You must install it manually using the provided `.vsix` file.

1. Ensure you have the `mindstack-0.0.4.vsix` file.
2. Open your computer's terminal (iTerm, Mac Terminal, or Windows Command Prompt).
3. **CRITICAL:** Launch VS Code with the proposed API flag enabled by running:
   ```bash
   code --enable-proposed-api mindstack.mindstack
   ```
4. Once VS Code opens, click the **Extensions** icon on the left sidebar (or press `Ctrl+Shift+X` / `Cmd+Shift+X`).
5. Look at the top right of the extensions panel and click the `...` (Views and More Actions) button.
6. Click **"Install from VSIX..."**
7. Select your `mindstack-0.0.4.vsix` file. 
8. The MindStack logo will appear in your left Activity Bar!

## Uninstallation

1. Open VS Code.
2. Click the **Extensions** icon in the left Activity Bar.
3. Search for **"MindStack Code Observer"** in the top search bar.
4. Click on the extension in the list.
5. Click the **Uninstall** button.
6. A prompt will appear asking you to reload the window. Click **Reload Required**.

---

##  Security & Privacy

* **Local First:** All repository scraping (`git diff`, `find .`) happens completely locally. 
* **Proxy Architecture:** The frontend webview generates no direct outbound network requests. All API and Database calls are securely proxied through the Node.js Extension Host to prevent cross-site scripting vulnerabilities.
* **Explicit Ignore:** The repository scanner explicitly ignores `.git`, `node_modules`, `dist`, `build`, and critically, all `.env` files to ensure local secrets are never dispatched to the server.
