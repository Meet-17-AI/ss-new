import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { setToken, clearToken, getToken } from '../lib/authFetch';
import type { Scope } from '../lib/permissions';

interface User {
  username: string;
  role: string;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  isLoggedIn: boolean;
  login: (userData: User, token?: string) => void;
  logout: () => void;
  loading: boolean;
  /** Dashboards this user may open. Server-supplied; see the note below. */
  scopes: Scope[];
  /** True until the first /api/me/access answer arrives, so guards can wait. */
  scopesLoading: boolean;
  /** Whether the Roles tab is worth showing. The server decides the real thing. */
  canManageAccess: boolean;
  refreshAccess: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  /**
   * Access is held in memory ONLY, never read back from localStorage.
   *
   * The `user` object below is persisted to disk, and anything on disk is
   * editable — a user could add `"scopes":["admin_dashboard"]` to it by hand. It
   * is fetched fresh from /api/me/access instead, so tampering at most renders a
   * dashboard shell whose every request comes back 403.
   *
   * This is a display concern regardless. The server authorises each call against
   * the database; nothing here grants anything.
   */
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [scopesLoading, setScopesLoading] = useState(true);
  const [canManageAccess, setCanManageAccess] = useState(false);

  const refreshAccess = useCallback(async () => {
    if (!getToken()) {
      setScopes([]);
      setCanManageAccess(false);
      setScopesLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/me/access');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setScopes(Array.isArray(data.scopes) ? data.scopes : []);
      setCanManageAccess(Boolean(data.canManageAccess));
    } catch (err) {
      // Leave scopes empty rather than guessing from the role. A wrong guess here
      // would route someone to a dashboard the server will refuse to fill.
      console.error('[access] could not load permissions', err);
      setScopes([]);
      setCanManageAccess(false);
    } finally {
      setScopesLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load session on initial mount
    try {
      const raw = localStorage.getItem('user');
      const loggedInStr = localStorage.getItem('isLoggedIn');
      if (raw && loggedInStr === 'true') {
        const parsed = JSON.parse(raw);
        // Clear stale sessions with old sales_role field just in case
        if ('sales_role' in parsed) {
          localStorage.clear();
        } else if (!getToken()) {
          // Session predates token auth (or the token was cleared after a 401).
          // Without one every API call 401s, so force a fresh login instead of
          // rendering a shell that cannot load any data.
          localStorage.removeItem('user');
          localStorage.removeItem('isLoggedIn');
        } else {
          setUser(parsed);
          setIsLoggedIn(true);
        }
      }
    } catch {
      localStorage.removeItem('user');
      localStorage.removeItem('isLoggedIn');
    } finally {
      setLoading(false);
    }
  }, []);

  // Runs on mount and on every sign-in/sign-out, so a session restored from
  // storage gets its access checked too rather than trusted from disk.
  useEffect(() => {
    if (loading) return;
    if (!isLoggedIn) {
      setScopes([]);
      setCanManageAccess(false);
      setScopesLoading(false);
      return;
    }
    setScopesLoading(true);
    refreshAccess();
  }, [isLoggedIn, loading, refreshAccess]);

  const login = (userData: User, token?: string) => {
    if (token) setToken(token);
    setUser(userData);
    setIsLoggedIn(true);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('isLoggedIn', 'true');
  };

  const logout = () => {
    clearToken();
    setUser(null);
    setIsLoggedIn(false);
    setScopes([]);
    setCanManageAccess(false);
    localStorage.removeItem('user');
    localStorage.removeItem('isLoggedIn');
  };

  return (
    <AuthContext.Provider
      value={{
        user, isLoggedIn, login, logout, loading,
        scopes, scopesLoading, canManageAccess, refreshAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
