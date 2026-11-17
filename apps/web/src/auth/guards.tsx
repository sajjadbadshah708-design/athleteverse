import { ROLES, type Role, type UserStatus } from '@athleteverse/shared';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { LoadingScreen } from '../ui/LoadingScreen';
import { useAuth } from './AuthProvider';

export const ALL_ROLES: readonly Role[] = ROLES;

/**
 * Screens for signed-in users of the listed roles (and account statuses, ACTIVE by default). This is only a courtesy:
 * hiding a screen protects nothing, because the API checks role, status and ownership on every request (FR-1.11, SEC-3).
 */
export function RequireRole({
  roles,
  statuses = ['ACTIVE'],
  children,
}: {
  roles: readonly Role[];
  statuses?: readonly UserStatus[];
  children: ReactNode;
}) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <LoadingScreen />;
  if (state.status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!roles.includes(state.user.role) || !statuses.includes(state.user.status)) return <ForbiddenPage />;
  return <>{children}</>;
}

/** Sign-in and sign-up pages: a signed-in user is sent on to their home page. */
export function PublicOnly() {
  const { state } = useAuth();
  if (state.status === 'loading') return <LoadingScreen />;
  if (state.status === 'authenticated') return <Navigate to="/home" replace />;
  return <Outlet />;
}

/** Only follow redirects that stay inside this site. */
export function safeRedirect(target: unknown, fallback = '/home'): string {
  return typeof target === 'string' && /^\/(?![/\\])/.test(target) ? target : fallback;
}
