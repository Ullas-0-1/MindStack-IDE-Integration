# MindStack Code Observer 🚀

MindStack is an automated code context engine that lives inside VS Code. It watches your workspace and securely streams terminal errors, file changes, and context highlights straight to the MindStack web dashboard.

## 📥 How to Install

Because MindStack uses advanced VS Code API proposals to silently read terminal errors, you cannot install it directly from the marketplace yet. You must install it from the provided `.vsix` file.

1. Download the `mindstack-0.0.1.vsix` file to your computer.
2. **CRITICAL:** You must launch VS Code with the proposed API flag enabled. Open your computer's terminal (like iTerm or the default Mac/Windows Terminal) and type:
   ```bash
   code --enable-proposed-api mindstack.mindstack
   ```
3. Once VS Code opens, click the **Extensions** icon on the left sidebar (or press `Ctrl+Shift+X`).
4. Look at the top right of the extensions panel and click the `...` (Views and More Actions) button.
5. Click **"Install from VSIX..."**
6. Select the `mindstack-0.0.1.vsix` file you downloaded. 
7. You should now see the MindStack logo appear in your left Activity Bar!

> **Note:** To uninstall it later, simply search for "MindStack Code Observer" in your Extensions panel and click Uninstall.

---

## 🛠️ Features & Use Cases

### 1. Auto Bug Tracking (`IDE_BUG_FIX`)
**What it does:** MindStack silently listens to your integrated terminal. If a command fails and prints an error (like `npm install` failing), it caches the error. If you then edit a file and save it within 2 minutes, MindStack assumes you tried to fix the bug. It grabs your `git diff` and the error log and sends them both to the MindStack dashboard.
**How to use:** Do absolutely nothing! Just code normally. MindStack catches it in the background.

### 2. Auto Progress Snapshots (`IDE_PROGRESS_SNAPSHOT`)
**What it does:** Every 30 minutes, MindStack generates a safe, condensed tree map of your entire project directory and the current `git diff` of all your changes. It syncs this to the server so the AI always knows your repository structure.
**How to use:** Completely automatic. It runs silently as long as you have an active session.

### 3. Manual Context Highlighting
**What it does:** If you are reading a complex function or documentation file and want the AI to remember it, you can manually send it to the vault.
**How to use:** 
1. Highlight any text in your editor.
2. Right-click the highlighted text. 
3. Click `"Send to MindStack"`. 
4. Type an optional note and hit enter.

### 4. Sidebar Vault & Dropzone
**What it does:** A fast way to upload architecture diagrams, PDFs, or manual notes straight into your project's AI context.
**How to use:** 
1. Open the MindStack sidebar. 
2. Either type a text note and click "Save Note", or drag-and-drop a PDF/Image into the dashed Dropzone (or click the Dropzone to open your file picker). It uploads directly to AWS S3 and links to your session!

---

## 🔒 Session Management
When you open a local project folder on your computer:
1. Open the MindStack sidebar.
2. Click **"+ New Project"** and name it after your current folder (e.g., `my-cool-website`). This creates a bucket on the backend.
3. Select the project from the dropdown and click **"Start Session"**.
4. All automated background tracking will now securely sync to that specific project bucket!
