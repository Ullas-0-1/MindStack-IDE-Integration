import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { SessionManager } from './sessionManager';
import { registerIdeBugFixCapture } from './captures/ideBugFix';
import { registerProgressSnapshot } from './captures/progressSnapshot';
import { registerManualHighlight } from './captures/manualHighlight';

export const API_BASE_URL = 'https://mind-stack-theta.vercel.app';

export function activate(context: vscode.ExtensionContext) {
    console.log('MindStack extension is now active!');

    // Initialize Session Manager
    const sessionManager = new SessionManager(context);

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
    registerIdeBugFixCapture(context, sessionManager);
    registerProgressSnapshot(context, sessionManager);
    registerManualHighlight(context, sessionManager);
}

export function deactivate() {
    // SessionManager will handle cleanup
}
