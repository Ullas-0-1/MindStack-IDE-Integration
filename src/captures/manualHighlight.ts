import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import { API_BASE_URL } from '../extension';

export function registerManualHighlight(context: vscode.ExtensionContext, sessionManager: SessionManager) {
    let disposable = vscode.commands.registerCommand('mindstack.sendHighlight', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active text editor');
            return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection);

        if (!text) {
            vscode.window.showInformationMessage('No text highlighted.');
            return;
        }

        const note = await vscode.window.showInputBox({
            prompt: 'Add an optional note for this highlight',
            placeHolder: 'E.g., "Need to refactor this memory leak"'
        });

        const sessionId = sessionManager.getSessionId();
        const projectId = sessionManager.getProjectId();

        if (!sessionId || !projectId) {
            vscode.window.showErrorMessage('MindStack: Start a Session first to capture highlights.');
            return;
        }

        const token = await sessionManager.getToken();
        if (!token) return;

        const content = `${note ? note + '\n\n' : ''}File: ${vscode.workspace.asRelativePath(editor.document.uri)}\n\`\`\`\n${text}\n\`\`\``;

        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Sending to MindStack...",
                cancellable: false
            }, async (progress) => {
                await fetch(`${API_BASE_URL}/api/ingest/browser`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        session_id: sessionId,
                        project_id: projectId,
                        capture_type: 'USER_NOTE',
                        text_content: content,
                        priority: 5
                    })
                });
                vscode.window.showInformationMessage('Highlight sent to MindStack!');
            });

        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to send highlight: ${e.message}`);
        }
    });

    context.subscriptions.push(disposable);
}
