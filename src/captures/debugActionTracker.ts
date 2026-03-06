import * as vscode from 'vscode';

export type DebugActionType = 'edit' | 'save' | 'command';

export interface DebugAction {
    type: DebugActionType;
    file_path?: string;
    command?: string;
    timestamp: number;
    change_size?: number;
}

export class DebugActionTracker {
    private actions: DebugAction[] = [];
    private subscriptions: vscode.Disposable[] = [];

    // We throttle edit actions so we don't log a million keystrokes
    private lastEditTime: { [filePath: string]: number } = {};

    constructor() { }

    public startTracking() {
        this.clear();

        // Track file saves
        this.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
            this.actions.push({
                type: 'save',
                file_path: vscode.workspace.asRelativePath(doc.uri),
                timestamp: Date.now()
            });
        }));

        // Track file edits (throttled to 1 edit action per minute per file)
        this.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => {
            const filePath = vscode.workspace.asRelativePath(e.document.uri);
            const now = Date.now();
            if (!this.lastEditTime[filePath] || (now - this.lastEditTime[filePath] > 60000)) {
                this.actions.push({
                    type: 'edit',
                    file_path: filePath,
                    change_size: e.contentChanges.reduce((acc, c) => acc + c.text.length, 0),
                    timestamp: now
                });
                this.lastEditTime[filePath] = now;
            }
        }));
    }

    public trackCommand(command: string) {
        this.actions.push({
            type: 'command',
            command: command,
            timestamp: Date.now()
        });
    }

    public stopTracking() {
        this.subscriptions.forEach(s => s.dispose());
        this.subscriptions = [];
    }

    public getActionsAndClear(): DebugAction[] {
        const result = [...this.actions];
        this.actions = [];
        return result;
    }

    private clear() {
        this.actions = [];
        this.lastEditTime = {};
    }
}
