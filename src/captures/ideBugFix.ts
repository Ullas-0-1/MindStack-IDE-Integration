import * as vscode from 'vscode';
import * as cp from 'child_process';
import { API_BASE_URL } from '../extension';
import { SessionManager } from '../sessionManager';

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function cleanTerminalString(str: string): string {
    return str
        .replace(ANSI_REGEX, '')
        .replace(/\r/g, '') // remove carriage returns
        .replace(/\]633;[^\x07]+\x07/g, '') // strip VS Code specific marks
        .replace(/\]633;[^\s]+/g, '') // strip more VS Code specific marks
        .trim();
}

// Simple cache for the last error log
let lastErrorLog: string | null = null;
let lastErrorTime: number = 0;
let errorDebounceTimer: NodeJS.Timeout | null = null;

export function registerIdeBugFixCapture(context: vscode.ExtensionContext, sessionManager: SessionManager) {
    // 1. Listen to Terminal Output
    context.subscriptions.push(
        vscode.window.onDidWriteTerminalData((e) => {
            const sessionId = sessionManager.getSessionId();
            if (!sessionId) return; // Only capture if session is active

            const lowerData = e.data.toLowerCase();
            if (lowerData.includes('error') || lowerData.includes('failed') || lowerData.includes('command not found') || lowerData.includes('fatal') || lowerData.includes('exception')) {
                const plainText = cleanTerminalString(e.data);

                // Keep the last 2000 chars roughly or append
                if (Date.now() - lastErrorTime > 10000) {
                    lastErrorLog = plainText; // reset if older than 10s
                } else {
                    lastErrorLog = (lastErrorLog + '\n' + plainText).slice(-2000);
                }
                lastErrorTime = Date.now();

                // Clear previous debounce and start a new 2-second countdown
                if (errorDebounceTimer) {
                    clearTimeout(errorDebounceTimer);
                }

                errorDebounceTimer = setTimeout(async () => {
                    await sendBugFixCapture(context, sessionManager);
                }, 2000); // Wait 2 seconds of silence
            }
        })
    );
}

async function sendBugFixCapture(context: vscode.ExtensionContext, sessionManager: SessionManager) {
    if (!lastErrorLog) return;

    const sessionId = sessionManager.getSessionId();
    if (!sessionId) return;

    // Grab active file for context (if any)
    const activeEditor = vscode.window.activeTextEditor;
    let filePath = '';
    let diff = '';

    if (activeEditor) {
        filePath = activeEditor.document.fileName;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
        if (workspaceFolder) {
            try {
                // Get general git diff for the whole workspace, or just the file if preferred.
                // Reverting to the old file-specific diff as requested:
                diff = await getGitDiffForFile(workspaceFolder.uri.fsPath, filePath);
                filePath = vscode.workspace.asRelativePath(activeEditor.document.uri);
            } catch (e) {
                console.log("Git diff failed, sending without diff");
            }
        }
    }

    const token = await sessionManager.getToken();
    if (token) {
        try {
            await fetch(`${API_BASE_URL}/api/ingest/ide`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: sessionId,
                    project_id: sessionManager.getProjectId(),
                    capture_type: "IDE_BUG_FIX", // kept exactly the same per user request
                    ide_error_log: lastErrorLog,
                    ide_code_diff: diff || undefined,
                    ide_file_path: filePath || undefined,
                    priority: 1
                })
            });

            // Clear the error so we don't spam multiple fixes for the same error
            lastErrorLog = null;
        } catch (e) {
            console.error("Failed to send IDE_BUG_FIX", e);
        }
    }
}

function getGitDiffForFile(workspacePath: string, filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // Gets unstaged and staged changes for the file
        cp.exec(`git diff HEAD -- "${filePath}"`, { cwd: workspacePath }, (error, stdout) => {
            if (error) {
                // Not a git repo or file not tracked
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}
