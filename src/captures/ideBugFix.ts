import * as vscode from 'vscode';
import * as cp from 'child_process';
import { SessionManager } from '../sessionManager';
import { DebugEpisodeManager } from './debugEpisodeManager';
import { DiffEngine } from './diffEngine';

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function cleanTerminalString(str: string): string {
    return str
        .replace(ANSI_REGEX, '')
        .replace(/\r/g, '') // remove carriage returns
        .replace(/\]633;[^\x07]+\x07/g, '') // strip VS Code specific marks
        .replace(/\]633;[^\s]+/g, '') // strip more VS Code specific marks
        .trim();
}

let lastErrorLog: string | null = null;
let lastErrorTime: number = 0;
let errorDebounceTimer: NodeJS.Timeout | null = null;
let terminalBuffer: string = '';

export function registerIdeBugFixCapture(context: vscode.ExtensionContext, sessionManager: SessionManager, debugManager: DebugEpisodeManager) {
    context.subscriptions.push(
        (vscode.window as any).onDidWriteTerminalData((e: any) => {
            const sessionId = sessionManager.getSessionId();
            if (!sessionId) return;

            terminalBuffer += e.data;

            // Loop through all complete lines in the buffer
            while (true) {
                const newlineIndex = terminalBuffer.search(/[\r\n]/);
                if (newlineIndex === -1) break;

                const rawLine = terminalBuffer.substring(0, newlineIndex);
                terminalBuffer = terminalBuffer.substring(newlineIndex + 1);

                if (!rawLine.trim()) continue;

                const plainText = cleanTerminalString(rawLine);
                const lowerData = plainText.toLowerCase();

                const isCommandEcho = rawLine.includes('npm') || rawLine.includes('yarn') || rawLine.includes('node ') || rawLine.includes('python ');

                // If an episode is active, monitor for success flags OR command retries
                if (debugManager.isDebugging()) {
                    if (lowerData.includes('success') || lowerData.includes('done') || lowerData.includes('compiled') || lowerData.includes('passing')) {
                        debugManager.resolveEpisode(debugManager.currentEpisode?.initial_command);
                    } else if (isCommandEcho) {
                        const runCmd = plainText.substring(0, 100);
                        debugManager.trackTerminalCommand(runCmd);

                        // We assume the command ran. We wait 3 seconds. 
                        // If no new 'error' appeared in the buffer since THIS command, we assume it resolved!
                        const commandTime = Date.now();
                        setTimeout(() => {
                            if (debugManager.isDebugging() && lastErrorTime < commandTime) {
                                debugManager.resolveEpisode(runCmd);
                            }
                        }, 3000);
                    }
                }

                if (lowerData.includes('error') || lowerData.includes('failed') || lowerData.includes('command not found') || lowerData.includes('fatal') || lowerData.includes('exception')) {
                    if (Date.now() - lastErrorTime > 10000) {
                        lastErrorLog = plainText;
                        if (!debugManager.isDebugging() && isCommandEcho) {
                            debugManager.setPendingCommand(plainText.substring(0, 100));
                        }
                    } else {
                        lastErrorLog = (lastErrorLog + '\n' + plainText).slice(-2000);
                    }
                    lastErrorTime = Date.now();

                    if (errorDebounceTimer) {
                        clearTimeout(errorDebounceTimer);
                    }

                    errorDebounceTimer = setTimeout(async () => {
                        await triggerEpisodeStart(context, sessionManager, debugManager);
                    }, 2000);
                }
            }
        })
    );
}

async function triggerEpisodeStart(context: vscode.ExtensionContext, sessionManager: SessionManager, debugManager: DebugEpisodeManager) {
    if (!lastErrorLog) return;
    const sessionId = sessionManager.getSessionId();
    if (!sessionId) return;

    const activeEditor = vscode.window.activeTextEditor || vscode.window.visibleTextEditors[0];
    let filePath = '';
    let diff = '';
    let repoTree = '';
    let workspacePath = '';

    if (activeEditor) {
        filePath = activeEditor.document.fileName;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
        if (workspaceFolder) {
            workspacePath = workspaceFolder.uri.fsPath;
            try {
                diff = await DiffEngine.getGitDiff(workspacePath);

                const command = `find . -type d \\( -path "./node_modules" -o -path "./.git" -o -path "./dist" -o -path "./build" -o -path "./.next" -o -path "./out" \\) -prune -o -name ".env*" -prune -o -print`;
                repoTree = await new Promise((res) => {
                    cp.exec(command, { cwd: workspacePath, maxBuffer: 1024 * 500 }, (error: any, stdout: string) => {
                        res(stdout ? (stdout.length > 20000 ? stdout.substring(0, 20000) + '\n...[TRUNCATED]' : stdout) : '');
                    });
                });

                filePath = vscode.workspace.asRelativePath(activeEditor.document.uri);
            } catch (e) {
                console.log("Failed to gather full snapshot context for episode start", e);
            }
        }
    }

    await debugManager.startEpisode(lastErrorLog, filePath, workspacePath, repoTree, diff);
    lastErrorLog = null;
}
