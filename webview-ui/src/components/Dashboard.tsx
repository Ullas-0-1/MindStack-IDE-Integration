import { useState, useEffect } from 'react';
import { vscode, proxyFetch } from '../utils/vscode';
import { Dropzone } from './Dropzone';

export function Dashboard() {
    const [viewMode, setViewMode] = useState<'project' | 'workspace'>('project');
    const [projects, setProjects] = useState<any[]>([]);
    const [workspaces, setWorkspaces] = useState<any[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>('');
    const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');

    const [sessionActive, setSessionActive] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [activeSessionType, setActiveSessionType] = useState<'project' | 'workspace' | null>(null);
    const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
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
                    // We save these to lock the vault UI to the correct target while active:
                    setActiveSessionType(message.targetType);
                    setActiveTargetId(message.targetId);
                    vscode.postMessage({ command: 'onInfo', value: 'Session Started successfully.' });
                } else {
                    vscode.postMessage({ command: 'onError', value: 'Failed to start session.' });
                }
            } else if (message.command === 'sessionStopped') {
                setSessionActive(false);
                setSessionId(null);
                setActiveSessionType(null);
                setActiveTargetId(null);
                vscode.postMessage({ command: 'onInfo', value: 'Session Stopped.' });
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Fetch workspaces when viewMode switches to workspace
    useEffect(() => {
        if (viewMode === 'workspace' && workspaces.length === 0) {
            proxyFetch('/api/workspaces')
                .then(res => {
                    if (res.status === 401) {
                        vscode.postMessage({ command: 'logout' });
                        throw new Error('JWT expired');
                    }
                    return res.json();
                })
                .then(data => {
                    let fetchedWorkspaces: any[] = [];
                    if (Array.isArray(data)) {
                        fetchedWorkspaces = data;
                    } else if (data && typeof data === 'object') {
                        if (Array.isArray(data.workspaces)) {
                            fetchedWorkspaces = data.workspaces;
                        } else if (Array.isArray(data.data)) {
                            fetchedWorkspaces = data.data;
                        } else {
                            const arrayProp = Object.values(data).find(val => Array.isArray(val));
                            if (arrayProp) fetchedWorkspaces = arrayProp as any[];
                        }
                    }
                    setWorkspaces(fetchedWorkspaces);
                    if (fetchedWorkspaces.length > 0) {
                        setSelectedWorkspace(fetchedWorkspaces[0].id);
                    }
                })
                .catch(err => {
                    console.error("Failed to fetch workspaces", err);
                });
        }
    }, [viewMode, workspaces.length]);

    const handleStartSession = () => {
        const targetId = viewMode === 'project' ? selectedProject : selectedWorkspace;
        if (!targetId) return;
        vscode.postMessage({
            command: 'startSession',
            targetId,
            targetType: viewMode
        });
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
                [activeSessionType === 'workspace' ? 'workspace_id' : 'project_id']: activeTargetId,
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
            {/* SLEEK TOGGLE */}
            <div style={{ display: 'flex', backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--vscode-widget-border)' }}>
                <button
                    onClick={() => setViewMode('project')}
                    disabled={sessionActive}
                    style={{ flex: 1, padding: '6px', cursor: sessionActive ? 'not-allowed' : 'pointer', backgroundColor: viewMode === 'project' ? 'var(--vscode-button-background)' : 'transparent', color: viewMode === 'project' ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)', border: 'none' }}
                >
                    Personal
                </button>
                <button
                    onClick={() => setViewMode('workspace')}
                    disabled={sessionActive}
                    style={{ flex: 1, padding: '6px', cursor: sessionActive ? 'not-allowed' : 'pointer', backgroundColor: viewMode === 'workspace' ? 'var(--vscode-button-background)' : 'transparent', color: viewMode === 'workspace' ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)', border: 'none' }}
                >
                    Team
                </button>
            </div>

            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <h3 style={{ margin: 0 }}>Select {viewMode === 'project' ? 'Project' : 'Workspace'}</h3>
                    {viewMode === 'project' && (
                        <button
                            onClick={handleCreateProject}
                            disabled={sessionActive}
                            style={{ padding: '4px 8px', fontSize: '0.8em', backgroundColor: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)' }}
                        >
                            + New
                        </button>
                    )}
                </div>

                {viewMode === 'project' ? (
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
                ) : (
                    <select
                        value={selectedWorkspace}
                        onChange={(e) => setSelectedWorkspace(e.target.value)}
                        disabled={sessionActive || workspaces.length === 0}
                        style={{ width: '100%', padding: '6px' }}
                    >
                        {workspaces.length === 0 && <option value="">No workspaces found...</option>}
                        {workspaces.map(w => (
                            <option key={w.id} value={w.id}>{w.name || w.display_name || 'Unnamed Workspace'}</option>
                        ))}
                    </select>
                )}
            </div>

            <div>
                {!sessionActive ? (
                    <button
                        onClick={handleStartSession}
                        style={{ width: '100%', backgroundColor: 'var(--vscode-testing-iconPassed)' }}
                        disabled={viewMode === 'project' ? !selectedProject : !selectedWorkspace}
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
                        targetId={activeTargetId}
                        targetType={activeSessionType}
                        disabled={!sessionActive}
                    />
                </div>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
                <button
                    onClick={() => vscode.postMessage({ command: 'logout' })}
                    style={{ width: '100%', padding: '6px', backgroundColor: 'transparent', color: 'var(--vscode-testing-iconFailed)', border: '1px solid var(--vscode-testing-iconFailed)' }}
                >
                    Log Out
                </button>
            </div>
        </div>
    );
}
