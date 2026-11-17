// Who is signed in. The server is the only authority (FR-1.11): this only remembers the answer of GET /me so the screens
// can show the right thing, and it forgets it the moment the API says the session is gone.
import { ApiError, type AuthUser, type RegisterRequest } from '@athleteverse/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApi } from '../api/ApiContext';
import type { SessionLostReason } from '../api/client';

export type AuthState = { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; user: AuthUser };

interface AuthContextValue {
  state: AuthState;
  /** Why the user was signed out behind their back, to explain it on the sign-in page. */
  notice: SessionLostReason | null;
  signIn(email: string, password: string): Promise<AuthUser>;
  register(input: RegisterRequest): Promise<void>;
  verifyEmail(email: string, code: string): Promise<AuthUser>;
  resendCode(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Asks the server again who we are (for example after the profile was completed). */
  refreshUser(): Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface Snapshot {
  state: AuthState;
  notice: SessionLostReason | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [snapshot, setSnapshot] = useState<Snapshot>({ state: { status: 'loading' }, notice: null });

  // On start: is there a session already? GET /me refreshes an expired access token by itself.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ user: AuthUser }>('/me')
      .then(({ user }) => !cancelled && setSnapshot({ state: { status: 'authenticated', user }, notice: null }))
      .catch((error: unknown) => {
        if (cancelled) return;
        const suspended = error instanceof ApiError && error.code === 'ACCOUNT_SUSPENDED';
        setSnapshot({ state: { status: 'anonymous' }, notice: suspended ? 'suspended' : null });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Later: the API could not keep the session alive, or the account was suspended while the page was open.
  useEffect(
    () =>
      api.onSessionLost((reason) =>
        setSnapshot((prev) => (prev.state.status === 'authenticated' ? { state: { status: 'anonymous' }, notice: reason } : prev)),
      ),
    [api],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { user } = await api.post<{ user: AuthUser }>('/auth/login', { email, password });
      setSnapshot({ state: { status: 'authenticated', user }, notice: null });
      return user;
    },
    [api],
  );

  const verifyEmail = useCallback(
    async (email: string, code: string) => {
      const { user } = await api.post<{ user: AuthUser }>('/auth/verify-email', { email, code });
      setSnapshot({ state: { status: 'authenticated', user }, notice: null });
      return user;
    },
    [api],
  );

  const register = useCallback(async (input: RegisterRequest) => void (await api.post('/auth/register', input)), [api]);
  const resendCode = useCallback(async (email: string) => void (await api.post('/auth/resend-otp', { email })), [api]);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Signing out must always work on this device, even when the server cannot be reached.
    }
    setSnapshot({ state: { status: 'anonymous' }, notice: null });
  }, [api]);

  const refreshUser = useCallback(async () => {
    const { user } = await api.get<{ user: AuthUser }>('/me');
    setSnapshot({ state: { status: 'authenticated', user }, notice: null });
    return user;
  }, [api]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...snapshot, signIn, register, verifyEmail, resendCode, signOut, refreshUser }),
    [snapshot, signIn, register, verifyEmail, resendCode, signOut, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
