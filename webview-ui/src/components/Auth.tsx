import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { vscode } from '../utils/vscode';

export function Auth({ onLogin }: { onLogin: () => void }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSignUp, setIsSignUp] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setErrorMsg('');

        try {
            if (isSignUp) {
                const { error, data } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                if (data.session) {
                    vscode.postMessage({ command: 'saveToken', token: data.session.access_token });
                    onLogin();
                } else {
                    setErrorMsg('Check your email for the confirmation link.');
                }
            } else {
                const { error, data } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                if (data.session) {
                    vscode.postMessage({ command: 'saveToken', token: data.session.access_token });
                    onLogin();
                }
            }
        } catch (e: any) {
            setErrorMsg(e.message || 'Authentication error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', marginTop: '32px' }}>
            <h2>{isSignUp ? 'Create Account' : 'Sign In'}</h2>
            <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                />
                {errorMsg && <p style={{ color: 'var(--vscode-errorForeground, red)', fontSize: '0.9em' }}>{errorMsg}</p>}
                <button type="submit" disabled={loading}>
                    {loading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Log In')}
                </button>
            </form>
            <a href="#" style={{ color: 'var(--vscode-textLink-foreground)', textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); setIsSignUp(!isSignUp); }}>
                {isSignUp ? 'Already have an account? Log in' : "Don't have an account? Sign up"}
            </a>
        </div>
    );
}
