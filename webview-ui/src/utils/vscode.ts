export const vscode = {
    postMessage: (message: any) => {
        if (typeof (window as any).vscode !== 'undefined') {
            (window as any).vscode.postMessage(message);
        } else {
            console.log('Would post message to VS Code:', message);
        }
    }
};

/**
 * A proxy fetch function that routes HTTP requests through the VS Code Extension Host
 * to bypass CORS and webview network restrictions.
 */
export async function proxyFetch(endpoint: string, options: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const reqId = Math.random().toString(36).substring(7);

        const listener = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === 'apiProxyResponse' && message.reqId === reqId) {
                window.removeEventListener('message', listener);
                if (message.error) {
                    reject(new Error(message.error));
                } else if (message.status >= 400) {
                    reject(new Error(`API Error ${message.status}: ${JSON.stringify(message.data)}`));
                } else {
                    // For Supabase client compatibility, we need to return an object 
                    // that looks enough like a Response to pass it's internal checks
                    resolve({
                        ok: true,
                        status: message.status || 200,
                        json: async () => message.data,
                        text: async () => JSON.stringify(message.data),
                        headers: new Headers()
                    });
                }
            }
        };

        window.addEventListener('message', listener);

        vscode.postMessage({
            command: 'apiProxy',
            reqId,
            endpoint,
            method: options.method || 'GET',
            headers: options.headers ? Object.fromEntries(new Headers(options.headers).entries()) : undefined,
            body: options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : undefined
        });
    });
}
