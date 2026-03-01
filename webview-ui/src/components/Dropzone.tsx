import React, { useCallback, useState, useRef } from 'react';
import { vscode, proxyFetch } from '../utils/vscode';
import { UploadCloud, File as FileIcon } from 'lucide-react';

export function Dropzone({ sessionId, projectId, disabled }: { sessionId: string | null, projectId: string | null, disabled: boolean }) {
    const [isDragActive, setIsDragActive] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const onDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragActive(false);

        if (disabled || !sessionId || !projectId) return;

        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;

        const file = files[0]; // just handle 1 for now
        await handleUpload(file);
    }, [sessionId, projectId, disabled]);

    const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled || !sessionId || !projectId) return;
        if (e.target.files && e.target.files.length > 0) {
            await handleUpload(e.target.files[0]);
        }
    };

    const handleUpload = async (file: File) => {
        setUploading(true);
        try {
            // 1. Get Presigned URL via Proxy
            const presignResp = await proxyFetch('/api/vault/presigned-url', {
                method: 'POST',
                body: JSON.stringify({
                    file_name: file.name,
                    file_type: file.type
                })
            });

            const { upload_url, s3_url } = await presignResp.json();

            // 2. Read file as Base64 to send over the message bridge
            // Because we can't do direct PUT from the webview easily without triggering CORS
            const base64 = await toBase64(file);
            const rawB64 = base64.split(',')[1];

            // 3. Command the host to upload it to S3
            const reqId = Math.random().toString(36).substring(7);

            await new Promise<void>((resolve, reject) => {
                const listener = (event: MessageEvent) => {
                    const message = event.data;
                    if (message.command === 's3UploadResponse' && message.reqId === reqId) {
                        window.removeEventListener('message', listener);
                        if (message.success) resolve();
                        else reject(new Error(message.error));
                    }
                };
                window.addEventListener('message', listener);

                vscode.postMessage({
                    command: 's3Upload',
                    reqId,
                    url: upload_url,
                    fileBase64: rawB64
                });
            });

            // 4. Ingest the attachment
            const ingestResp = await proxyFetch('/api/ingest/browser', {
                method: 'POST',
                body: JSON.stringify({
                    session_id: sessionId,
                    project_id: projectId,
                    capture_type: 'RESOURCE_UPLOAD',
                    text_content: "",
                    priority: 5,
                    attachments: [
                        { s3_url, file_type: getNormalizedType(file.type), file_name: file.name }
                    ]
                })
            });

            const { capture_id } = await ingestResp.json();

            // 5. If PDF, trigger extraction worker
            if (file.type === 'application/pdf') {
                await proxyFetch('/api/ingest/process-document', {
                    method: 'POST',
                    body: JSON.stringify({
                        capture_id,
                        project_id: projectId,
                        s3_url
                    })
                });
                vscode.postMessage({ command: 'onInfo', value: `Uploaded ${file.name}. PDF processing started.` });
            } else {
                vscode.postMessage({ command: 'onInfo', value: `Uploaded ${file.name} to vault.` });
            }

        } catch (e: any) {
            vscode.postMessage({ command: 'onError', value: `Upload Failed: ${e.message}` });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div
            onClick={() => { if (!disabled) fileInputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragActive(false); }}
            onDrop={onDrop}
            style={{
                border: `2px dashed ${isDragActive ? 'var(--vscode-focusBorder)' : 'var(--border-color)'}`,
                borderRadius: '8px',
                padding: '32px',
                textAlign: 'center',
                backgroundColor: isDragActive ? 'var(--vscode-list-hoverBackground)' : 'transparent',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px'
            }}
        >
            <input
                type="file"
                ref={fileInputRef}
                onChange={onFileSelect}
                style={{ display: 'none' }}
                accept="application/pdf,image/*"
            />
            {uploading ? (
                <>
                    <UploadCloud size={32} className="animate-pulse" />
                    <p>Uploading to vault...</p>
                </>
            ) : (
                <>
                    <FileIcon size={32} style={{ color: 'var(--vscode-textPreformat-foreground)' }} />
                    <p style={{ margin: 0, fontWeight: 500 }}>Drop PDF or Image here</p>
                    <p style={{ margin: 0, fontSize: '0.8em', opacity: 0.7 }}>Attachments become AI Context immediately</p>
                </>
            )}
        </div>
    );
}

const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
});

function getNormalizedType(mime: string) {
    if (mime === 'application/pdf') return 'PDF';
    if (mime.startsWith('image/')) return 'IMAGE';
    return 'DOC';
}
