/**
 * AuthContext.tsx — v2
 *
 * Handles both admin (email+password) and resident (username+password / Google OAuth) auth.
 * Removed: subscriber/signup flows (portal registration is a separate wizard).
 */

import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authService } from '../services/api/auth.service';
import { devService } from '../services/api/dev.service';
import type { AuthContextType, User } from '../types/auth';
import { logger } from '../utils/logger';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const currentUser = await authService.getCurrentUser();
        setUser(currentUser);
      } catch {
        setUser(null);
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const login = async (
    credentials:
      | { username: string; password: string }    // portal resident
      | { email: string; password: string },       // admin
    isAdmin = false,
    isDev = false
  ) => {
    try {
      if (isDev && 'email' in credentials) {
        const { user, token } = await devService.devLogin(credentials as any);
        setUser(user as any);
        return { user, token };
      }

      if (isAdmin && 'email' in credentials) {
        const { user, token } = await authService.adminLogin(credentials as { email: string; password: string });
        setUser(user);
        return { user, token };
      }

      // Portal resident login (username + password)
      const { resident, token } = await authService.portalLogin(
        credentials as { username: string; password: string }
      );

      const firstName = resident.firstName || '';
      const lastName = resident.lastName || '';
      const middleName = resident.middleName || '';
      const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ').trim();

      const userData: User = {
        id: resident.id,
        name: fullName || resident.username || 'Resident',
        email: resident.email || '',
        username: resident.username,
        residentId: resident.residentId,
        role: 'resident',
        status: resident.status,
        createdAt: resident.createdAt || new Date().toISOString(),
      } as any;

      setUser(userData);
      return { resident, token };
    } catch (error: any) {
      throw new Error(error.message || 'Login failed');
    }
  };

  const logout = async () => {
    try {
      await authService.logout();
    } catch (error) {
      logger.error('Logout error:', error);
    }
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
