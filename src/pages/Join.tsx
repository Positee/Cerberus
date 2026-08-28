import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, TriangleAlert } from 'lucide-react';
import { ApiFailure, acceptInvitation, previewInvitation } from '../app/api';
import { useToast } from '../app/toast';
import { ROLE_BLURB, ROLE_LABEL } from '../../shared/permissions';
import type { InvitationPreview } from '../../shared/api';

/**
 * The other end of an invitation link.
 *
 * It sits outside the workspace shell, because whoever opens it may not be
 * signed in and may not belong to any workspace yet. It shows what is being
 * offered before it asks anybody to accept, so nobody joins something blind.
 */

export default function Join({ signedIn }: { signedIn: boolean }) {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;

    previewInvitation(token)
      .then((result) => {
        if (alive) setPreview(result);
      })
      .catch((caught) => {
        if (!alive) return;
        setProblem(
          caught instanceof ApiFailure
            ? caught.message
            : 'Cerberus cannot read that invitation. Ask for a new link.',
        );
      });

    return () => {
      alive = false;
    };
  }, [token]);

  async function accept() {
    setBusy(true);
    try {
      const result = await acceptInvitation(token);
      toast.done(`You are in ${result.workspaceName}.`);
      // A full load, so the session and the sidebar rebuild for the new workspace.
      window.location.assign('/dashboard');
    } catch (caught) {
      const why = caught instanceof ApiFailure ? caught.message : 'Something failed. Try again.';
      setProblem(why);
      toast.fail(why);
      setBusy(false);
    }
  }

  return (
    <main className="join-screen">
      <img src="/cerberus-mark.webp" alt="" width={224} height={140} />

      {problem ? (
        <section className="join-card">
          <p className="auth-error" role="alert">
            <TriangleAlert size={15} aria-hidden="true" />
            {problem}
          </p>
          <button type="button" className="ghost-button" onClick={() => navigate('/login')}>
            Go to sign in
          </button>
        </section>
      ) : preview === null ? (
        <p className="join-waiting" role="status">
          Reading the invitation.
        </p>
      ) : (
        <section className="join-card">
          <h1>Join {preview.workspaceName}</h1>
          <p className="join-blurb">
            {preview.invitedBy ? `${preview.invitedBy} invited ` : 'You were invited as '}
            <strong>{preview.email}</strong>
            {preview.invitedBy ? ' to this workspace.' : '.'}
          </p>

          <dl className="join-facts">
            <div>
              <dt>Your role</dt>
              <dd>
                <strong>{ROLE_LABEL[preview.role]}</strong>
                <small>{ROLE_BLURB[preview.role]}</small>
              </dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>
                <strong>{preview.workspaceName}</strong>
                <small>{preview.workspaceKind === 'organization' ? 'An organization' : 'A personal workspace'}</small>
              </dd>
            </div>
          </dl>

          {signedIn ? (
            <button type="button" className="primary-button" disabled={busy} onClick={() => void accept()}>
              <Check size={15} aria-hidden="true" />
              {busy ? 'Joining' : `Join ${preview.workspaceName}`}
            </button>
          ) : (
            <>
              <p className="join-note">
                Sign in as <strong>{preview.email}</strong> to accept. The invitation waits until you do.
              </p>
              <button
                type="button"
                className="primary-button"
                // The link is kept, so signing in returns here rather than dropping
                // somebody on the dashboard with the invitation lost.
                onClick={() => navigate(`/login?next=${encodeURIComponent(`/join/${token}`)}`)}
              >
                Sign in to accept
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
}
