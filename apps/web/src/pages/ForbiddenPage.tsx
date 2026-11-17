import { STRINGS } from '@athleteverse/shared';
import { Link } from 'react-router';
import { useDocumentTitle } from '../useDocumentTitle';
import { PageHeading } from '../ui/PageHeading';
import { Icon } from '../ui/Icon';

export function ForbiddenPage() {
  useDocumentTitle(STRINGS.forbidden.title);
  return (
    <div className="av-panel mx-auto max-w-2xl py-12 text-center"><span className="av-action-icon mx-auto !h-18 !w-18"><Icon name="shield" size={32}/></span><span className="av-eyebrow mt-6">Access protection</span><PageHeading>{STRINGS.forbidden.title}</PageHeading><p className="av-prose mx-auto mb-4">{STRINGS.forbidden.body}</p><Link to="/home" className="av-link">{STRINGS.forbidden.back}<Icon name="arrow" size={16}/></Link></div>
  );
}
