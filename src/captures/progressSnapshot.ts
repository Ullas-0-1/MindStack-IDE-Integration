import * as vscode from 'vscode';
import * as cp from 'child_process';
import { API_BASE_URL } from '../extension';
import { SessionManager } from '../sessionManager';

export function registerProgressSnapshot(context: vscode.ExtensionContext, sessionManager: SessionManager) {

    // Trigger every 30 minutes
    setInterval(async () => {
        const sessionId = sessionManager.getSessionId();
        if (!sessionId) return;
        await captureSnapshot(sessionManager, context);
    }, 3 * 60 * 1000);

    // Also trigger on git commit if possible.
    // VS Code's core API doesn't easily notify on git commits natively without depending on the `vscode.git` extension directly.
    // For simplicity without external dependencies, we use the 30-min timer as the primary driver per requirements. We can optionally hook into workspace saves.
}

async function captureSnapshot(sessionManager: SessionManager, context: vscode.ExtensionContext) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const workspacePath = workspaceFolders[0].uri.fsPath;

    let repoTree = '';
    let diff = '';

    try {
        repoTree = await getRepoTree(workspacePath);
    } catch (e) {
        console.warn("Failed to generate repo tree", e);
    }

    try {
        diff = await getFullGitDiff(workspacePath);
    } catch (e) {
        console.warn("Failed to generate git diff", e);
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
                    session_id: sessionManager.getSessionId(),
                    [sessionManager.getTargetType() === 'workspace' ? 'workspace_id' : 'project_id']: sessionManager.getTargetId(),
                    capture_type: "IDE_PROGRESS_SNAPSHOT",
                    ide_code_diff: diff || undefined,
                    repo_tree: repoTree || undefined,
                    priority: 1
                })
            });
        } catch (e) {
            console.error("Failed to send IDE_PROGRESS_SNAPSHOT", e);
        }
    }
}

function getRepoTree(workspacePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // Find files but ignore node_modules, .git, dist, build, .next, out, .env
        const command = `find . -type d \\( -path "./node_modules" -o -path "./.git" -o -path "./dist" -o -path "./build" -o -path "./.next" -o -path "./out" \\) -prune -o -name ".env*" -prune -o -print`;

        cp.exec(command, { cwd: workspacePath, maxBuffer: 1024 * 500 }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            // Limit to 20k chars
            const tree = stdout.length > 20000 ? stdout.substring(0, 20000) + '\n...[TRUNCATED]' : stdout;
            resolve(tree);
        });
    });
}

function getFullGitDiff(workspacePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        cp.exec(`git diff HEAD`, { cwd: workspacePath, maxBuffer: 1024 * 1024 * 5 }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            // Limit to 50k chars
            const truncatedDiff = stdout.length > 50000 ? stdout.substring(0, 50000) + '\n...[TRUNCATED]' : stdout;
            resolve(truncatedDiff);
        });
    });
}
