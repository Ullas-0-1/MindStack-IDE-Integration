import * as vscode from 'vscode';
import * as cp from 'child_process';
import { API_BASE_URL } from '../extension';
import { SessionManager } from '../sessionManager';
import { DebugEpisodeManager } from './debugEpisodeManager';
import { DiffEngine } from './diffEngine';

export function registerProgressSnapshot(context: vscode.ExtensionContext, sessionManager: SessionManager, debugManager: DebugEpisodeManager) {
    // Trigger every 30 minutes
    setInterval(async () => {
        const sessionId = sessionManager.getSessionId();
        if (!sessionId) return;
        await captureSnapshot(sessionManager, context, debugManager, "IDE_PROGRESS_SNAPSHOT");
    }, 3 * 60 * 1000);
}

export async function captureSnapshot(
    sessionManager: SessionManager,
    context: vscode.ExtensionContext,
    debugManager: DebugEpisodeManager | null = null,
    captureType: string = "IDE_PROGRESS_SNAPSHOT"
) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    const workspacePath = workspaceFolders[0].uri.fsPath;
    let repoTree = '';
    let gitDiffSinceCommit = '';

    try { repoTree = await getRepoTree(workspacePath); } catch (e) { }
    try { gitDiffSinceCommit = await DiffEngine.getGitDiff(workspacePath); } catch (e) { }

    const metrics = computeDiffMetrics(gitDiffSinceCommit);

    // Active files
    let activeFile = '';
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file') {
        activeFile = vscode.workspace.asRelativePath(editor.document.uri);
    }

    const openFiles = vscode.workspace.textDocuments
        .filter(doc => doc.uri.scheme === 'file')
        .map(doc => vscode.workspace.asRelativePath(doc.uri));

    const token = await sessionManager.getToken();
    if (token) {

        const requestBody: any = {
            session_id: sessionManager.getSessionId(),
            [sessionManager.getTargetType() === 'workspace' ? 'workspace_id' : 'project_id']: sessionManager.getTargetId(),
            capture_type: captureType,
            priority: 1,

            repo_tree: repoTree || undefined,
            git_diff_since_commit: gitDiffSinceCommit || undefined,

            payload: {
                files_changed: metrics.filesChanged,
                files_added: metrics.filesAdded,
                files_deleted: metrics.filesDeleted,

                lines_added: metrics.linesAdded,
                lines_removed: metrics.linesRemoved,

                modules_changed: Array.from(metrics.modules),
                languages_detected: Array.from(metrics.languages),

                active_file: activeFile,
                open_files: openFiles
            }
        };

        // If FINAL snapshot, append session data
        if (captureType === "IDE_SESSION_FINAL_SNAPSHOT" && debugManager) {
            requestBody.payload.debug_episodes_count = debugManager.totalEpisodes;
            requestBody.payload.resolved_bugs = debugManager.resolvedBugs;
            requestBody.payload.abandoned_bugs = debugManager.abandonedBugs;
            requestBody.payload.session_duration = sessionManager.getSessionDurationSeconds();
        }

        try {
            const resp = await fetch(`${API_BASE_URL}/api/ingest/ide`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!resp.ok && captureType === "IDE_SESSION_FINAL_SNAPSHOT") {
                const text = await resp.text();
                vscode.window.showErrorMessage(`MindStack Warning: Final Snapshot rejected by Backend: ${resp.status} ${text}`);
            }
        } catch (e) {
            if (captureType === "IDE_SESSION_FINAL_SNAPSHOT") {
                vscode.window.showErrorMessage(`MindStack Network Error: Could not send Final Snapshot.`);
            }
            console.error(`Failed to send ${captureType}`, e);
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

function computeDiffMetrics(diff: string) {
    const lines = diff.split('\n');
    let filesChanged = 0;
    let filesAdded = 0;
    let filesDeleted = 0;
    let linesAdded = 0;
    let linesRemoved = 0;

    const modules: Set<string> = new Set();
    const languages: Set<string> = new Set();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('diff --git')) {
            filesChanged++;

            // Extract file path info `a/src/file.ts b/src/file.ts`
            const parts = line.split(' ');
            if (parts.length > 2) {
                const filePath = parts[2].substring(2); // remove a/

                // Module
                const pathParts = filePath.split('/');
                if (pathParts.length > 1) {
                    modules.add(pathParts[0]);
                }

                // Extension
                const extIndex = filePath.lastIndexOf('.');
                if (extIndex > 0) {
                    languages.add(filePath.substring(extIndex));
                }
            }
        } else if (line.startsWith('new file mode')) {
            filesAdded++;
        } else if (line.startsWith('deleted file mode')) {
            filesDeleted++;
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            linesAdded++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            linesRemoved++;
        }
    }

    return { filesChanged, filesAdded, filesDeleted, linesAdded, linesRemoved, modules, languages };
}
