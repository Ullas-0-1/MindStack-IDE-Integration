import { useState, useEffect } from 'react';
import { vscode } from '../utils/vscode';
import { Dropzone } from './Dropzone';

export function Dashboard() {
    const [projects, setProjects] = useState<any[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>('');
    const [sessionActive, setSessionActive] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [noteText, setNoteText] = useState('');

    useEffect(() => {
        // Request projects on load
        vscode.postMessage({ command: 'fetchProjects' });

        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === 'projectsFetched') {
                console.log('WEBVIEW RECEIVED PROJECTS DATA:', message.data);

                const errorStr = (message.data?.error || message.error || '').toLowerCase();
                if (errorStr.includes('jwt expired') || message.status === 401) {
                    console.log('EXPIRED JWT DETECTED. TRIGGERING LOGOUT.');
                    vscode.postMessage({ command: 'logout' });
                    return;
                }

                let fetchedProjects: any[] = [];

                // Aggressive extraction: find an array anywhere
                if (Array.isArray(message.data)) {
                    fetchedProjects = message.data;
                } else if (message.data && typeof message.data === 'object') {
                    // It's an object, let's look for known array properties
                    if (Array.isArray(message.data.projects)) {
                        fetchedProjects = message.data.projects;
                    } else if (Array.isArray(message.data.data)) {
                        fetchedProjects = message.data.data;
                    } else {
                        // Last resort: just find the first array property in the object
                        const arrayProp = Object.values(message.data).find(val => Array.isArray(val));
                        if (arrayProp) {
                            fetchedProjects = arrayProp as any[];
                        }
                    }
                }

                console.log('EXTRACTED PROJECTS ARRAY:', fetchedProjects);
                setProjects(fetchedProjects);
                if (fetchedProjects.length > 0) {
                    setSelectedProject(fetchedProjects[0].id);
                }
            } else if (message.command === 'projectCreated') {
                vscode.postMessage({ command: 'onInfo', value: 'Project created successfully!' });
                vscode.postMessage({ command: 'fetchProjects' });
            } else if (message.command === 'sessionStarted') {
                if (message.success) {
                    setSessionActive(true);
                    setSessionId(message.sessionId);
                    vscode.postMessage({ command: 'onInfo', value: 'Session Started successfully.' });
                } else {
                    vscode.postMessage({ command: 'onError', value: 'Failed to start session.' });
                }
            } else if (message.command === 'sessionStopped') {
                setSessionActive(false);
                setSessionId(null);
                vscode.postMessage({ command: 'onInfo', value: 'Session Stopped.' });
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleStartSession = () => {
        if (!selectedProject) return;
        vscode.postMessage({ command: 'startSession', projectId: selectedProject });
    };

    const handleCreateProject = () => {
        vscode.postMessage({ command: 'createProjectCmd' });
    };

    const handleStopSession = () => {
        vscode.postMessage({ command: 'stopSession' });
    };

    const submitNote = () => {
        if (!sessionActive || !noteText.trim()) return;

        const reqId = Math.random().toString(36).substring(7);
        vscode.postMessage({
            command: 'apiProxy',
            reqId,
            endpoint: '/api/ingest/browser',
            method: 'POST',
            body: {
                session_id: sessionId,
                project_id: selectedProject,
                capture_type: 'USER_NOTE',
                text_content: noteText,
                priority: 5
            }
        });

        setNoteText('');
        vscode.postMessage({ command: 'onInfo', value: 'Note sent to MindStack vault!' });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h3 style={{ margin: 0 }}>Select Project</h3>
                    <button
                        onClick={handleCreateProject}
                        disabled={sessionActive}
                        style={{ padding: '4px 8px', fontSize: '0.8em', backgroundColor: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)' }}
                    >
                        + New Project
                    </button>
                </div>
                <select
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    disabled={sessionActive || projects.length === 0}
                    style={{ width: '100%', padding: '6px' }}
                >
                    {projects.length === 0 && <option value="">No projects found...</option>}
                    {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name || 'Unnamed Project'}</option>
                    ))}
                </select>
            </div>

            <div>
                {!sessionActive ? (
                    <button
                        onClick={handleStartSession}
                        style={{ width: '100%', backgroundColor: 'var(--vscode-testing-iconPassed)' }}
                        disabled={!selectedProject}
                    >
                        Start Session
                    </button>
                ) : (
                    <button
                        onClick={handleStopSession}
                        style={{ width: '100%', backgroundColor: 'var(--vscode-testing-iconFailed)' }}
                    >
                        Stop Session (Active)
                    </button>
                )}
            </div>

            <hr style={{ borderColor: 'var(--border-color)', width: '100%' }} />

            <div style={{ opacity: sessionActive ? 1 : 0.5, pointerEvents: sessionActive ? 'auto' : 'none' }}>
                <h3>Vault</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <textarea
                        rows={4}
                        placeholder="Write a quick note for the AI context..."
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                    />
                    <button onClick={submitNote}>Save Note</button>
                </div>

                <div style={{ marginTop: '20px' }}>
                    <Dropzone
                        sessionId={sessionId}
                        projectId={selectedProject}
                        disabled={!sessionActive}
                    />
                </div>
            </div>
        </div>
    );
}
