import { useState, useEffect } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { vscode } from './utils/vscode';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    vscode.postMessage({ command: 'getToken' });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'setToken') {
        if (message.token) {
          setIsAuthenticated(true);
        } else {
          // Token deliberately cleared (Logout)
          setIsAuthenticated(false);
        }
        setLoading(false);
      }
      if (message.command === 'tokenSaved') {
        // Double verify
        vscode.postMessage({ command: 'getToken' });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading MindStack...</div>;
  }

  return (
    <div className="App">
      {isAuthenticated ? (
        <Dashboard />
      ) : (
        <Auth onLogin={() => setIsAuthenticated(true)} />
      )}
    </div>
  );
}

export default App;
