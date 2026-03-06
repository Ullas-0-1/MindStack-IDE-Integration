import * as vscode from 'vscode';
import { API_BASE_URL } from '../extension';
import { SessionManager } from '../sessionManager';
import { getErrorFingerprint } from './errorFingerprint';
import { DiffEngine } from './diffEngine';
import { DebugActionTracker, DebugAction } from './debugActionTracker';
import { v4 as uuidv4 } from 'uuid';

type EpisodeStatus = 'IDLE' | 'DEBUGGING' | 'RESOLVED' | 'ABANDONED';

export interface DebugEpisode {
    episode_id: string;
    session_id: string;
    workspace_id: string | null;
    project_id: string | null;
    status: EpisodeStatus;
    timestamp_start: number;
    timestamp_end?: number;

    initial_command: string;
    initial_error_message: string;
    initial_stacktrace: string;
    active_file: string;

    start_git_diff: string;
    start_repo_tree: string;

    local_file_backup: string;
}

export class DebugEpisodeManager {
    public currentEpisode: DebugEpisode | null = null;
    private tracker: DebugActionTracker;
    private episodeTimeout: NodeJS.Timeout | null = null;
    public pendingCommand: string = "unknown";

    public totalEpisodes: number = 0;
    public resolvedBugs: number = 0;
    public abandonedBugs: number = 0;

    constructor(
        private context: vscode.ExtensionContext,
        private sessionManager: SessionManager
    ) {
        this.tracker = new DebugActionTracker();
    }

    public setPendingCommand(cmd: string) {
        this.pendingCommand = cmd;
    }

    public async startEpisode(
        errorLog: string,
        activeFile: string,
        workspacePath: string,
        repoTree: string,
        gitDiff: string
    ) {
        const sessionId = this.sessionManager.getSessionId();
        if (!sessionId) return;

        if (this.currentEpisode && this.currentEpisode.status === 'DEBUGGING') {
            await this.abandonEpisode();
        }

        const episodeId = uuidv4();
        const fingerprint = getErrorFingerprint(errorLog);

        let localFileBackup = "";
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.fileName.includes(activeFile)) {
            localFileBackup = editor.document.getText();
        }

        this.currentEpisode = {
            episode_id: episodeId,
            session_id: sessionId,
            workspace_id: this.sessionManager.getTargetType() === 'workspace' ? this.sessionManager.getTargetId() : null,
            project_id: this.sessionManager.getTargetType() === 'project' ? this.sessionManager.getTargetId() : null,
            status: 'DEBUGGING',
            timestamp_start: Date.now(),
            initial_command: this.pendingCommand,
            initial_error_message: errorLog.substring(0, 200),
            initial_stacktrace: errorLog,
            active_file: activeFile,
            start_git_diff: gitDiff,
            start_repo_tree: repoTree,
            local_file_backup: localFileBackup
        };

        this.totalEpisodes++;
        this.tracker.startTracking();

        vscode.window.showInformationMessage("MindStack: Bug Detected! Tracking Debug Episode...");

        await this.sendEpisodeUpdate('IDE_DEBUG_EPISODE_START', {
            ...this.currentEpisode,
            fingerprint
        });

        if (this.episodeTimeout) clearTimeout(this.episodeTimeout);
        this.episodeTimeout = setTimeout(() => {
            this.abandonEpisode();
        }, 15 * 60 * 1000); // 15-minute timeout
    }

    public trackTerminalCommand(command: string) {
        if (this.currentEpisode && this.currentEpisode.status === 'DEBUGGING') {
            this.tracker.trackCommand(command);
            this.sendOngoingActions();
        }
    }

    public async resolveEpisode(commandRun?: string) {
        if (!this.currentEpisode || this.currentEpisode.status !== 'DEBUGGING') return;

        this.currentEpisode.status = 'RESOLVED';
        this.currentEpisode.timestamp_end = Date.now();
        this.resolvedBugs++;

        if (this.episodeTimeout) clearTimeout(this.episodeTimeout);

        this.tracker.stopTracking();
        const actions = this.tracker.getActionsAndClear();

        const fingerprint = getErrorFingerprint(this.currentEpisode.initial_stacktrace);

        // Calculate hybrid local diff 
        let localDiffFix = "";
        let gitDiffFix = "";
        try {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.fileName.includes(this.currentEpisode.active_file)) {
                localDiffFix = await DiffEngine.computeTextDiff(this.currentEpisode.local_file_backup, editor.document.getText(), editor.document.fileName);
            }

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                gitDiffFix = await DiffEngine.getGitDiff(workspaceFolder.uri.fsPath);
            }
        } catch (e) { }

        const filesChanged = Array.from(new Set(actions.filter(a => a.type === 'edit' && a.file_path).map(a => a.file_path)));

        vscode.window.showInformationMessage("MindStack: Bug Resolved! Sending fix to Knowledge Base...");

        await this.sendEpisodeUpdate('IDE_DEBUG_EPISODE_RESOLVED', {
            episode_id: this.currentEpisode.episode_id,
            session_id: this.currentEpisode.session_id,
            workspace_id: this.currentEpisode.workspace_id,
            project_id: this.currentEpisode.project_id,
            status: 'RESOLVED',
            fingerprint: fingerprint,
            resolution_command: commandRun || "unknown",
            git_diff_fix: gitDiffFix || undefined,
            local_diff_fix: localDiffFix || undefined,
            files_changed: filesChanged
        });

        this.currentEpisode = null;
    }

    public async abandonEpisode() {
        if (!this.currentEpisode || this.currentEpisode.status !== 'DEBUGGING') return;

        this.currentEpisode.status = 'ABANDONED';
        this.abandonedBugs++;
        this.tracker.stopTracking();

        if (this.episodeTimeout) clearTimeout(this.episodeTimeout);

        const actions = this.tracker.getActionsAndClear();

        await this.sendEpisodeUpdate('IDE_DEBUG_EPISODE_UPDATE', {
            episode_id: this.currentEpisode.episode_id,
            session_id: this.currentEpisode.session_id,
            workspace_id: this.currentEpisode.workspace_id,
            project_id: this.currentEpisode.project_id,
            actions_log: actions,
            status: 'ABANDONED'
        });

        this.currentEpisode = null;
    }

    private async sendOngoingActions() {
        if (!this.currentEpisode || this.currentEpisode.status !== 'DEBUGGING') return;

        const actions = this.tracker.getActionsAndClear();
        if (actions.length === 0) return;

        await this.sendEpisodeUpdate('IDE_DEBUG_EPISODE_UPDATE', {
            episode_id: this.currentEpisode.episode_id,
            session_id: this.currentEpisode.session_id,
            workspace_id: this.currentEpisode.workspace_id,
            project_id: this.currentEpisode.project_id,
            actions_log: actions
        });
    }

    private async sendEpisodeUpdate(captureType: string, telemetryPayload: any) {
        const token = await this.sessionManager.getToken();
        if (!token) return;

        const { session_id, workspace_id, project_id, ...data } = telemetryPayload;

        if (!data.fingerprint && this.currentEpisode) {
            data.fingerprint = getErrorFingerprint(this.currentEpisode.initial_stacktrace);
        }

        try {
            const resp = await fetch(`${API_BASE_URL}/api/ingest/ide`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: session_id || this.sessionManager.getSessionId(),
                    ...(workspace_id ? { workspace_id } : {}),
                    ...(project_id ? { project_id } : {}),
                    capture_type: captureType,
                    priority: 1,
                    payload: data
                })
            });

            if (!resp.ok) {
                const text = await resp.text();
                vscode.window.showErrorMessage(`MindStack Warning: Failed to send ${captureType}. Backend replied: ${resp.status} ${text}`);
            }
        } catch (e) {
            vscode.window.showErrorMessage(`MindStack Target Error: Could not connect to backend to save bug episode.`);
            console.error(`Failed to send ${captureType}`, e);
        }
    }

    public isDebugging(): boolean {
        return this.currentEpisode !== null && this.currentEpisode.status === 'DEBUGGING';
    }
}
