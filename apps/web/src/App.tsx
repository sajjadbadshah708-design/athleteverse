import { Navigate, Route, Routes } from 'react-router';
import { ALL_ROLES, PublicOnly, RequireRole } from './auth/guards';
import { useAuth } from './auth/AuthProvider';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { VenuePage } from './pages/VenuePage';
import { VenuesPage } from './pages/VenuesPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { ManagerRegisterPage } from './pages/ManagerRegisterPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { CreditPage } from './pages/CreditPage';
import { OperationsPage } from './pages/OperationsPage';
import { ManagerPage } from './pages/ManagerPage';
import { AdminPage } from './pages/AdminPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { Layout } from './ui/Layout';
import { Narrow } from './ui/Narrow';
import { LoadingScreen } from './ui/LoadingScreen';

function RootRedirect() {
  const { state } = useAuth();
  if (state.status === 'loading') return <LoadingScreen />;
  return <Navigate to={state.status === 'authenticated' ? '/home' : '/login'} replace />;
}

/** Later tasks add their routes here, each inside <RequireRole> with the roles the API also enforces. */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="venues" element={<VenuesPage />} />
        <Route path="venues/:id" element={<VenuePage />} />
        <Route element={<Narrow />}>
          <Route index element={<RootRedirect />} />
          <Route element={<PublicOnly />}>
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
            <Route path="register-manager" element={<ManagerRegisterPage />} />
            <Route path="admin-login" element={<AdminLoginPage />} />
            <Route path="accept-invite" element={<AcceptInvitePage />} />
            <Route path="verify-email" element={<VerifyEmailPage />} />
          </Route>
          <Route
            path="home"
            element={
              <RequireRole roles={ALL_ROLES} statuses={['ACTIVE', 'PENDING_APPROVAL', 'REJECTED']}>
                <HomePage />
              </RequireRole>
            }
          />
          <Route
            path="profile"
            element={
              <RequireRole roles={['PLAYER']}>
                <ProfilePage />
              </RequireRole>
            }
          />
          <Route path="bookings" element={<RequireRole roles={['PLAYER']}><MyBookingsPage /></RequireRole>} />
          <Route path="credit" element={<RequireRole roles={['PLAYER']}><CreditPage /></RequireRole>} />
          <Route path="operations" element={<RequireRole roles={['MANAGER','STAFF']}><OperationsPage /></RequireRole>} />
          <Route path="manager" element={<RequireRole roles={['MANAGER']}><ManagerPage /></RequireRole>} />
          <Route path="admin" element={<RequireRole roles={['ADMIN']}><AdminPage /></RequireRole>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
