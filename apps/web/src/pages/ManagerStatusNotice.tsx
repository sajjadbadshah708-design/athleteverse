import { STRINGS, type MyManagerStatus } from '@athleteverse/shared';
import { useApiData } from '../api/useApiData';
import { useAuth } from '../auth/AuthProvider';
import { Alert } from '../ui/Alert';

/** Show the signed-in manager's status immediately; enrich it with the server's reason when available. */
export function ManagerStatusNotice() {
  const { state } = useAuth();
  const { loaded } = useApiData<MyManagerStatus>('/me/manager-status');
  const accountStatus = state.status === 'authenticated' ? state.user.status : null;
  const status = loaded.status === 'ready' ? loaded.data.status : accountStatus;

  if (status === 'PENDING_APPROVAL') {
    return (
      <Alert tone="warning">
        {STRINGS.home.pending}
        {loaded.status === 'ready' && loaded.data.businessName ? ` Business: ${loaded.data.businessName}.` : null}
      </Alert>
    );
  }

  if (status === 'REJECTED') {
    return (
      <Alert tone="error">
        {STRINGS.home.rejected}
        {loaded.status === 'ready' && loaded.data.rejectionReason ? ` Reason: ${loaded.data.rejectionReason}` : null}
      </Alert>
    );
  }

  return null;
}
