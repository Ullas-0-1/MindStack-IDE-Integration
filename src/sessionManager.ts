import * as vscode from 'vscode';
import { API_BASE_URL } from './extension';

export class SessionManager {
    private sessionId: string | null = null;
    private targetId: string | null = null;
    private targetType: 'project' | 'workspace' | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    constructor(private context: vscode.ExtensionContext) { }

    public async startSession(targetId: string, targetType: 'project' | 'workspace'): Promise<boolean> {
        const token = await this.context.secrets.get('mindstack_jwt');
        if (!token) {
            vscode.window.showErrorMessage('Not authenticated. Please log in.');
            return false;
        }

        try {
            const resp = await fetch(`${API_BASE_URL}/api/sessions/start`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(targetType === 'workspace' ? { workspace_id: targetId } : { project_id: targetId })
            });

            if (!resp.ok) {
                const errorText = await resp.text();
                throw new Error(`Backend Error ${resp.status}: ${errorText}`);
            }

            const data: any = await resp.json();
            this.sessionId = data.session_id;
            this.targetId = targetId;
            this.targetType = targetType;

            this.startHeartbeat();
            return true;
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to start session: ${e.message}`);
            return false;
        }
    }

    public async stopSession() {
        if (!this.sessionId) return;

        const token = await this.context.secrets.get('mindstack_jwt');
        if (token) {
            try {
                await fetch(`${API_BASE_URL}/api/sessions/end`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ session_id: this.sessionId })
                });
            } catch (e) {
                console.error('Error ending session', e);
            }
        }

        this.sessionId = null;
        this.targetId = null;
        this.targetType = null;
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private startHeartbeat() {
        // 5 minutes
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, 5 * 60 * 1000);
    }

    private async sendHeartbeat() {
        if (!this.sessionId) return;

        const token = await this.context.secrets.get('mindstack_jwt');
        if (!token) return;

        const editor = vscode.window.activeTextEditor;
        let contextString = '';
        if (editor) {
            contextString = `${editor.document.fileName}\n${editor.document.getText()}`;
        }

        try {
            await fetch(`${API_BASE_URL}/api/sessions/heartbeat`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    active_file_context: contextString
                })
            });
        } catch (e) {
            console.error("Heartbeat failed", e);
        }
    }

    public getSessionId(): string | null {
        return this.sessionId;
    }

    public getTargetId(): string | null {
        return this.targetId;
    }

    public getTargetType(): 'project' | 'workspace' | null {
        return this.targetType;
    }

    public async getToken(): Promise<string | undefined> {
        return await this.context.secrets.get('mindstack_jwt');
    }
}
