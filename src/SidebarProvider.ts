import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { API_BASE_URL } from './extension';

export class SidebarProvider implements vscode.WebviewViewProvider {
    _view?: vscode.WebviewView;
    _doc?: vscode.TextDocument;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _sessionManager: SessionManager
    ) { }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case 'saveToken': {
                    await this._context.secrets.store('mindstack_jwt', data.token);
                    webviewView.webview.postMessage({ command: 'tokenSaved' });
                    break;
                }
                case 'getToken': {
                    const token = await this._context.secrets.get('mindstack_jwt');
                    webviewView.webview.postMessage({ command: 'setToken', token: token || null });
                    break;
                }
                case 'fetchProjects': {
                    const token = await this._context.secrets.get('mindstack_jwt');
                    if (!token) {
                        webviewView.webview.postMessage({ command: 'projectsFetched', error: 'No token' });
                        return;
                    }
                    try {
                        const resp = await fetch(`${API_BASE_URL}/api/projects`, {
                            headers: { Authorization: `Bearer ${token}` }
                        });

                        // Handle 401s specifically for JWT expiry
                        if (resp.status === 401) {
                            webviewView.webview.postMessage({ command: 'projectsFetched', status: 401, error: 'JWT expired' });
                            return;
                        }

                        const json = await resp.json();
                        console.log('RAW PROJECTS API RESPONSE:', JSON.stringify(json, null, 2));
                        webviewView.webview.postMessage({ command: 'projectsFetched', data: json });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ command: 'projectsFetched', error: e.message });
                    }
                    break;
                }
                case 'logout': {
                    console.log('HOST RECEIVED LOGOUT COMMAND. CLEARING TOKENS AND RESETTING VIEW.');
                    await this._context.secrets.delete('mindstack_jwt');
                    await this._sessionManager.stopSession();
                    webviewView.webview.postMessage({ command: 'setToken', token: null });
                    break;
                }
                case 'createProjectCmd': {
                    const token = await this._context.secrets.get('mindstack_jwt');
                    if (!token) return;

                    const projectName = await vscode.window.showInputBox({
                        prompt: 'Enter a name for the new MindStack project',
                        placeHolder: 'e.g. E-Commerce Refactor'
                    });

                    if (projectName) {
                        try {
                            const resp = await fetch(`${API_BASE_URL}/api/projects`, {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ name: projectName })
                            });
                            if (resp.ok) {
                                webviewView.webview.postMessage({ command: 'projectCreated' });
                            } else {
                                throw new Error('Failed to create project');
                            }
                        } catch (e: any) {
                            vscode.window.showErrorMessage(`Error creating project: ${e.message}`);
                        }
                    }
                    break;
                }
                case 'startSession': {
                    const { projectId } = data;
                    const success = await this._sessionManager.startSession(projectId);
                    webviewView.webview.postMessage({ command: 'sessionStarted', success, sessionId: this._sessionManager.getSessionId() });
                    break;
                }
                case 'stopSession': {
                    await this._sessionManager.stopSession();
                    webviewView.webview.postMessage({ command: 'sessionStopped' });
                    break;
                }
                case 'apiProxy': {
                    // Proxy for the webview to call external APIs (like Supabase Auth or our MindStack backend)
                    const token = await this._context.secrets.get('mindstack_jwt');

                    // Supabase requests should go to the exact endpoint provided (starts with http). 
                    // MindStack requests are relative (starts with /api).
                    const url = data.endpoint.startsWith('http') ? data.endpoint : `${API_BASE_URL}${data.endpoint}`;

                    const headers: Record<string, string> = {
                        'Content-Type': 'application/json'
                    };

                    // Only attach our JWT if it exists and we're talking to our own backend
                    if (token && !data.endpoint.startsWith('http')) {
                        headers['Authorization'] = `Bearer ${token}`;
                    }

                    // Note: Supabase custom fetch automatically includes the Anon Key in headers it passes,
                    // so we need to merge the incoming custom headers if they exist.
                    if (data.headers) {
                        for (const key of Object.keys(data.headers)) {
                            headers[key] = data.headers[key];
                        }
                    }

                    try {
                        const resp = await fetch(url, {
                            method: data.method || 'GET',
                            headers: headers,
                            body: data.body ? JSON.stringify(data.body) : undefined
                        });

                        // Catch global 401 unauthorized errors
                        if (resp.status === 401) {
                            webviewView.webview.postMessage({ command: 'apiProxyResponse', reqId: data.reqId, status: 401, error: 'JWT expired' });
                            return;
                        }

                        const json = await resp.json();
                        webviewView.webview.postMessage({ command: 'apiProxyResponse', reqId: data.reqId, status: resp.status, data: json });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ command: 'apiProxyResponse', reqId: data.reqId, error: e.message });
                    }
                    break;
                }
                case 's3Upload': {
                    // Special proxy directly to S3
                    try {
                        // Fetch requires native Node fetch or node-fetch. We'll use VS Code's fetch or build-in if Node 18+
                        const resp = await fetch(data.url, {
                            method: 'PUT',
                            // The webview will pass `data.fileBytes` as a base64 string or ArrayBuffer.
                            // Assuming base64 for simplicity across the bridge:
                            body: Buffer.from(data.fileBase64, 'base64')
                        });
                        if (!resp.ok) {
                            throw new Error(`S3 upload failed: ${resp.status}`);
                        }
                        webviewView.webview.postMessage({ command: 's3UploadResponse', reqId: data.reqId, success: true });
                    } catch (e: any) {
                        webviewView.webview.postMessage({ command: 's3UploadResponse', reqId: data.reqId, error: e.message });
                    }
                    break;
                }
                case 'onInfo': {
                    if (!data.value) {
                        return;
                    }
                    vscode.window.showInformationMessage(data.value);
                    break;
                }
                case 'onError': {
                    if (!data.value) {
                        return;
                    }
                    vscode.window.showErrorMessage(data.value);
                    break;
                }
            }
        });
    }

    public revive(panel: vscode.WebviewView) {
        this._view = panel;
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Determine path to generated React build
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'media', 'webview', 'index.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'media', 'webview', 'index.css')
        );

        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <!--
          Use a content security policy to only allow loading images from https or from our extension directory,
          and only allow scripts that have a specific nonce.
        -->
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:; connect-src https:;">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri}" rel="stylesheet">
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            window.vscode = vscode;
        </script>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
