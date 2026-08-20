// ============================================================
// Auth Context - React context for authentication state
// ============================================================

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import * as api from '@/lib/api';
import { hydrateStoredApiKey } from '@/store/analysisStore';

interface AuthContextType {
    user: api.User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    hasGithubToken: boolean;
    hasDeepseekKey: boolean;
    login: () => void;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<api.User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasGithubToken, setHasGithubToken] = useState(false);
    const [hasDeepseekKey, setHasDeepseekKey] = useState(false);

    const refreshUser = async () => {
        try {
            const authUser = await api.getCurrentUser();
            if (authUser) {
                setUser(authUser.user);
                setHasGithubToken(authUser.hasGithubToken);
                setHasDeepseekKey(authUser.hasDeepseekKey);
            } else {
                setUser(null);
                setHasGithubToken(false);
                setHasDeepseekKey(false);
            }
        } catch {
            setUser(null);
        }
    };

    useEffect(() => {
        void Promise.all([hydrateStoredApiKey(), refreshUser()]).finally(() => setIsLoading(false));
    }, []);

    // Check for login success query param
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('login') === 'success') {
            refreshUser();
            // Clean URL
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, []);

    const login = () => {
        window.location.href = api.getGitHubLoginUrl();
    };

    const handleLogout = async () => {
        await api.logout();
        setUser(null);
        setHasGithubToken(false);
        setHasDeepseekKey(false);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                isAuthenticated: !!user,
                isLoading,
                hasGithubToken,
                hasDeepseekKey,
                login,
                logout: handleLogout,
                refreshUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
