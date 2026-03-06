import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { SessionManager } from './sessionManager';
import { registerIdeBugFixCapture } from './captures/ideBugFix';
import { registerProgressSnapshot, captureSnapshot } from './captures/progressSnapshot';
import { registerManualHighlight } from './captures/manualHighlight';

import { DebugEpisodeManager } from './captures/debugEpisodeManager';

export const API_BASE_URL = 'https://mind-stack-theta.vercel.app';

export function activate(context: vscode.ExtensionContext) {
    console.log('MindStack extension is now active!');

    // Initialize Session Manager
    const sessionManager = new SessionManager(context);

    // Initialize Advanced Telemetry Managers
    const debugEpisodeManager = new DebugEpisodeManager(context, sessionManager);
    sessionManager.setDebugManager(debugEpisodeManager);
    sessionManager.setFinalSnapshotCallback(captureSnapshot);

    // Register Webview
    const sidebarProvider = new SidebarProvider(context, sessionManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'mindstack.sidebar',
            sidebarProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                }
            }
        )
    );

    // Register Captures
    registerIdeBugFixCapture(context, sessionManager, debugEpisodeManager);
    registerProgressSnapshot(context, sessionManager, debugEpisodeManager);
    registerManualHighlight(context, sessionManager);
}

export function deactivate() {
    // SessionManager will handle cleanup
}
