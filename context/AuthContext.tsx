import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken, clearToken, getToken } from '../lib/authFetch';

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

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
    localStorage.removeItem('user');
    localStorage.removeItem('isLoggedIn');
  };

  return (
    <AuthContext.Provider value={{ user, isLoggedIn, login, logout, loading }}>
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
