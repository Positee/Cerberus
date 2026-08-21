import { FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ImageUp, Trash2, TriangleAlert } from 'lucide-react';
import AvatarCropper from '../components/AvatarCropper';
import { ApiFailure, avatarUrl, deleteAccount, removeAvatar, updateEmail, updatePassword, updateProfile, uploadAvatar } from '../app/api';
import { initials, type Session } from '../app/session';
import { gradePassword } from '../../shared/password';
import type { PublicUser } from '../../shared/api';

/**
 * The profile page.
 *
 * Each card owns one change and one request. A card reports its own result,
 * so a failure in one never clears what somebody typed in another.
 */

/** The largest file the picker accepts, before the browser crops it. */
const SOURCE_MAX_BYTES = 12 * 1024 * 1024;

type Props = {
  session: Session;
  onUserChange: (user: PublicUser) => void;
  onSignedOut: () => void;
};

type CardState = {
  busy: boolean;
  error: string | null;
  fields: Record<string, string>;
  done: string | null;
};

const IDLE: CardState = { busy: false, error: null, fields: {}, done: null };

/** Holds the state of one card and turns an ApiFailure into its messages. */
function useCard() {
  const [state, setState] = useState<CardState>(IDLE);

  const start = () => setState({ ...IDLE, busy: true });
  const succeed = (done: string) => setState({ ...IDLE, done });

  const failWith = (error: unknown) => {
    const failure = error instanceof ApiFailure ? error : null;
    setState({
      busy: false,
      error: failure?.message ?? 'Something failed. Try again.',
      fields: failure?.fields ?? {},
      done: null,
    });
  };

  return { state, start, succeed, failWith };
}

function CardResult({ state }: { state: CardState }) {
  if (state.error) {
    return (
      <p className="auth-error" role="alert">
        <TriangleAlert size={15} aria-hidden="true" />
        {state.error}
      </p>
    );
  }

  if (state.done) {
    return (
      <p className="save-note" role="status">
        <Check size={15} aria-hidden="true" />
        {state.done}
      </p>
    );
  }

  return null;
}

export default function Profile({ session, onUserChange, onSignedOut }: Props) {
  const navigate = useNavigate();
  const user = session.user;

  // Picture.
  const picker = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const picture = useCard();

  // Details.
  const [fullName, setFullName] = useState(user.fullName);
  const [githubHandle, setGithubHandle] = useState(user.githubHandle ?? '');
  const [primaryStack, setPrimaryStack] = useState(user.primaryStack ?? '');
  const details = useCard();

  // Email.
  const [email, setEmail] = useState(user.email);
  const [emailPassword, setEmailPassword] = useState('');
  const emailCard = useCard();

  // Password.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const passwordCard = useCard();
  const grade = gradePassword(newPassword);

  // Delete.
  const [armed, setArmed] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const removal = useCard();

  const shown = avatarUrl(user);

  function choose(file: File | undefined) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      picture.failWith(new ApiFailure({ code: 'invalid_request', message: 'Choose an image file.' }));
      return;
    }

    if (file.size > SOURCE_MAX_BYTES) {
      picture.failWith(
        new ApiFailure({ code: 'invalid_request', message: 'That file is larger than 12 MB. Choose a smaller one.' }),
      );
      return;
    }

    setChosen(file);
  }

  async function saveCrop(blob: Blob) {
    picture.start();
    try {
      onUserChange(await uploadAvatar(blob));
      setChosen(null);
      picture.succeed('Your picture is set.');
    } catch (error) {
      setChosen(null);
      picture.failWith(error);
    }
  }

  async function dropPicture() {
    picture.start();
    try {
      onUserChange(await removeAvatar());
      picture.succeed('Your picture is removed.');
    } catch (error) {
      picture.failWith(error);
    }
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    details.start();
    try {
      onUserChange(await updateProfile({ fullName, githubHandle, primaryStack }));
      details.succeed('Your details are saved.');
    } catch (error) {
      details.failWith(error);
    }
  }

  async function saveEmail(event: FormEvent) {
    event.preventDefault();
    emailCard.start();
    try {
      onUserChange(await updateEmail({ email, currentPassword: emailPassword }));
      setEmailPassword('');
      emailCard.succeed('Your email address is changed.');
    } catch (error) {
      emailCard.failWith(error);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    passwordCard.start();
    try {
      await updatePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      passwordCard.succeed('Your password is changed. Every other device is signed out.');
    } catch (error) {
      passwordCard.failWith(error);
    }
  }

  async function removeAccount(event: FormEvent) {
    event.preventDefault();
    removal.start();
    try {
      await deleteAccount({ currentPassword: deletePassword });
      onSignedOut();
      navigate('/login', { replace: true });
    } catch (error) {
      removal.failWith(error);
    }
  }

  const passwordReady =
    currentPassword.length > 0 && grade.valid && newPassword === confirmPassword && !passwordCard.state.busy;

  return (
    <div className="page profile-page">
      <section className="panel">
        <div className="panel-head">
          <h3>Your mark</h3>
          <p>This sits beside your name everywhere you act. Cerberus crops it to a square.</p>
        </div>

        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          ref={picker}
          style={{ display: 'none' }}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            // Clear it, so choosing the same file twice still fires.
            event.target.value = '';
          }}
        />

        <div className="picture-row">
          {shown ? (
            <img className="picture-preview" src={shown} alt="Your current mark" width={96} height={96} />
          ) : (
            <span className="picture-preview letters" aria-hidden="true">
              {initials(session)}
            </span>
          )}

          <div className="picture-actions">
            <div className="picture-buttons">
              <button
                type="button"
                className="primary-button"
                disabled={picture.state.busy}
                onClick={() => picker.current?.click()}
              >
                <ImageUp size={16} aria-hidden="true" />
                {shown ? 'Change your mark' : 'Set your mark'}
              </button>

              {shown && (
                <button type="button" className="ghost-button" disabled={picture.state.busy} onClick={dropPicture}>
                  <Trash2 size={14} aria-hidden="true" />
                  Remove
                </button>
              )}
            </div>

            <p className="field-hint">PNG, JPEG, or WebP. Up to 12 MB.</p>
          </div>
        </div>

        <CardResult state={picture.state} />
      </section>

      <form className="panel" onSubmit={saveDetails}>
        <div className="panel-head">
          <h3>Your details</h3>
          <p>Your name shows on every action you take in the workspace.</p>
        </div>

        <div className="stack-fields">
          <label className="field plain">
            <span>Full name</span>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
            {details.state.fields.fullName && (
              <small className="field-error" role="alert">
                {details.state.fields.fullName}
              </small>
            )}
          </label>

          <div className="split-fields">
            <label className="field plain">
              <span>GitHub handle</span>
              <input
                value={githubHandle}
                onChange={(event) => setGithubHandle(event.target.value)}
                placeholder="janedoe"
              />
            </label>
            <label className="field plain">
              <span>Primary stack</span>
              <input
                value={primaryStack}
                onChange={(event) => setPrimaryStack(event.target.value)}
                placeholder="TypeScript / Node"
              />
            </label>
          </div>
        </div>

        <CardResult state={details.state} />

        <div className="panel-actions">
          <button className="primary-button" type="submit" disabled={details.state.busy || !fullName.trim()}>
            {details.state.busy ? 'Saving' : 'Save details'}
          </button>
        </div>
      </form>

      <form className="panel" onSubmit={saveEmail}>
        <div className="panel-head">
          <h3>Email address</h3>
          <p>This is how you sign in. Your password confirms the change.</p>
        </div>

        <div className="stack-fields">
          <label className="field plain">
            <span>Email address</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            {emailCard.state.fields.email && (
              <small className="field-error" role="alert">
                {emailCard.state.fields.email}
              </small>
            )}
          </label>

          <label className="field plain">
            <span>Current password</span>
            <input
              type="password"
              value={emailPassword}
              onChange={(event) => setEmailPassword(event.target.value)}
              autoComplete="current-password"
            />
            {emailCard.state.fields.currentPassword && (
              <small className="field-error" role="alert">
                {emailCard.state.fields.currentPassword}
              </small>
            )}
          </label>
        </div>

        <CardResult state={emailCard.state} />

        <div className="panel-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={emailCard.state.busy || !emailPassword || email === user.email}
          >
            {emailCard.state.busy ? 'Saving' : 'Change email'}
          </button>
        </div>
      </form>

      <form className="panel" onSubmit={savePassword}>
        <div className="panel-head">
          <h3>Password</h3>
          <p>A change signs out every other device.</p>
        </div>

        <div className="stack-fields">
          <label className="field plain">
            <span>Current password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
            {passwordCard.state.fields.currentPassword && (
              <small className="field-error" role="alert">
                {passwordCard.state.fields.currentPassword}
              </small>
            )}
          </label>

          <div className="split-fields">
            <label className="field plain">
              <span>New password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
              />
              {newPassword && !grade.valid && (
                <small className="field-hint">Add {grade.missing.join(', ')}.</small>
              )}
              {passwordCard.state.fields.newPassword && (
                <small className="field-error" role="alert">
                  {passwordCard.state.fields.newPassword}
                </small>
              )}
            </label>

            <label className="field plain">
              <span>Confirm new password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
              {confirmPassword && confirmPassword !== newPassword && (
                <small className="field-error" role="alert">
                  The two passwords are different.
                </small>
              )}
            </label>
          </div>
        </div>

        <CardResult state={passwordCard.state} />

        <div className="panel-actions">
          <button className="primary-button" type="submit" disabled={!passwordReady}>
            {passwordCard.state.busy ? 'Saving' : 'Change password'}
          </button>
        </div>
      </form>

      <section className="panel danger">
        <div className="panel-head">
          <h3>Delete account</h3>
          <p>
            This removes your account, your workspace, and every session. It cannot be undone.
          </p>
        </div>

        {armed ? (
          <form onSubmit={removeAccount}>
            <div className="stack-fields">
              <label className="field plain">
                <span>Current password</span>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  autoComplete="current-password"
                />
                {removal.state.fields.currentPassword && (
                  <small className="field-error" role="alert">
                    {removal.state.fields.currentPassword}
                  </small>
                )}
              </label>
            </div>

            <CardResult state={removal.state} />

            <div className="panel-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setArmed(false);
                  setDeletePassword('');
                }}
              >
                Cancel
              </button>
              <button className="danger-button" type="submit" disabled={removal.state.busy || !deletePassword}>
                {removal.state.busy ? 'Deleting' : 'Delete my account'}
              </button>
            </div>
          </form>
        ) : (
          <div className="panel-actions">
            <button type="button" className="danger-button" onClick={() => setArmed(true)}>
              <Trash2 size={14} aria-hidden="true" />
              Delete account
            </button>
          </div>
        )}
      </section>

      {chosen && (
        <AvatarCropper
          file={chosen}
          busy={picture.state.busy}
          onCancel={() => setChosen(null)}
          onDone={saveCrop}
        />
      )}
    </div>
  );
}
