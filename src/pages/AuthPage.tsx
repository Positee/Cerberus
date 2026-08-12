import { FormEvent, InputHTMLAttributes, ReactNode, useLayoutEffect, useRef, useState } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  Code2,
  Eye,
  EyeOff,
  Github,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import CerberusBeast from '../components/CerberusBeast';
import MatrixRain from '../components/MatrixRain';
import { EMAIL_PATTERN, gradePassword as sharedGradePassword } from '../../shared/password';

type AuthMode = 'login' | 'signup';
type AccountType = 'personal' | 'organization';

const STEP_LABELS = ['Path', 'Profile', 'Access'];

const accountOptions: Array<{
  id: AccountType;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: 'personal',
    title: 'Personal',
    description: 'For one guardian. Watch your own repositories and open source work.',
    icon: User,
  },
  {
    id: 'organization',
    title: 'Organization',
    description: 'For a legion. One workspace, shared roles, and posture for every team.',
    icon: Building2,
  },
];

const stackOptions = ['TypeScript / Node', 'Python', 'Go', 'Rust', 'Java', 'Ruby', 'PHP', 'Other'];
const roleOptions = ['CEO', 'CTO', 'Security Engineer', 'Engineering Lead', 'DevOps Engineer', 'Other'];
const teamSizes = ['1 to 5', '6 to 20', '21 to 50', '51 to 200', 'More than 200'];
const useCases = ['Product security', 'Open source monitoring', 'Compliance evidence', 'Cloud and runtime posture'];

const signupCopy: Array<{ eyebrow: string; title: string; blurb: string }> = [
  {
    eyebrow: 'Choose your descent',
    title: 'Who approaches the gate?',
    blurb: 'Cerberus guards one builder or a whole legion. Choose the path that fits you.',
  },
  {
    eyebrow: 'Name yourself',
    title: 'The hound needs your scent.',
    blurb: 'We ask only for what shapes your workspace. You can change all of it later.',
  },
  {
    eyebrow: 'Forge your key',
    title: 'Set the words that open it.',
    blurb: 'Choose a passphrase worthy of the underworld. Nothing passes the gate without it.',
  },
];

const orgCopy = {
  eyebrow: 'Muster your legion',
  title: 'Tell us who you guard.',
  blurb: 'This shapes your workspace, your seats, and the first posture checks we turn on.',
};

/* Validation is silent. The interface never marks a field as required. It only
   keeps the forward button disabled until every field holds a usable value. */

/* The rules and the scoring live in shared/password.ts, because the API
   enforces the same policy. Only the labels and colors belong to the browser. */
const STRENGTH = [
  { label: '', color: 'var(--faint)' },
  { label: 'Weak', color: 'var(--danger)' },
  { label: 'Fair', color: 'var(--warn)' },
  { label: 'Good', color: 'var(--accent-dim)' },
  { label: 'Strong', color: 'var(--accent-glow)' },
];

function joinWords(items: string[]) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function gradePassword(value: string) {
  const grade = sharedGradePassword(value);
  return { ...grade, ...STRENGTH[grade.score] };
}

type Values = Record<string, string>;

type BaseFieldProps = {
  label: string;
  icon: LucideIcon;
  name: string;
  value: string;
  onChange: (name: string, value: string) => void;
};

function TextField({
  label,
  icon: Icon,
  name,
  value,
  onChange,
  ...rest
}: BaseFieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'name' | 'value' | 'onChange'>) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-shell">
        <Icon size={16} aria-hidden="true" />
        <input name={name} value={value} onChange={(event) => onChange(name, event.target.value)} {...rest} />
      </div>
    </label>
  );
}

function SelectField({
  label,
  icon: Icon,
  name,
  value,
  onChange,
  placeholder,
  options,
}: BaseFieldProps & { placeholder: string; options: string[] }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-shell">
        <Icon size={16} aria-hidden="true" />
        <select name={name} value={value} onChange={(event) => onChange(name, event.target.value)}>
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <ChevronDown className="select-caret" size={16} aria-hidden="true" />
      </div>
    </label>
  );
}

function PasswordField({
  label,
  icon: Icon,
  name,
  value,
  onChange,
  autoComplete,
}: BaseFieldProps & { autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-shell">
        <Icon size={16} aria-hidden="true" />
        <input
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          placeholder="••••••••••••"
          onChange={(event) => onChange(name, event.target.value)}
        />
        <button
          className="ghost-icon-button"
          type="button"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
    </label>
  );
}

function StrengthMeter({ value }: { value: string }) {
  const grade = gradePassword(value);
  if (!value) return null;

  return (
    <div className="strength" style={{ '--strength-color': grade.color } as React.CSSProperties}>
      <div className="strength-track" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <span key={segment} data-on={segment <= grade.score} />
        ))}
      </div>
      <p className="strength-note" role="status">
        {grade.valid ? (
          <>
            <strong>{grade.label}</strong> password.
          </>
        ) : (
          <>
            <strong>{grade.label}</strong>. Add {joinWords(grade.missing)}.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Measures its content and animates its own height to match. Without this the
 * card snaps between step heights and the centered layout lurches, which is
 * what read as the page zooming when you opened sign up.
 */
function StepViewport({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    setHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="step-viewport" style={{ height }}>
      <div className="step-inner" ref={inner}>
        {children}
      </div>
    </div>
  );
}

export default function AuthPage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [values, setValues] = useState<Values>({});
  const [agreed, setAgreed] = useState(false);

  const set = (name: string, value: string) => setValues((prev) => ({ ...prev, [name]: value }));
  const val = (name: string) => values[name] ?? '';
  const filled = (name: string) => val(name).trim().length > 0;

  function switchMode(next: AuthMode) {
    setMode(next);
    setStep(0);
    setDirection('forward');
  }

  function goTo(next: number) {
    setDirection(next > step ? 'forward' : 'back');
    setStep(next);
  }

  const passwordGrade = gradePassword(val('password'));

  const canAdvance = (() => {
    if (step === 0) return accountType !== null;
    if (step === 1) {
      return accountType === 'personal'
        ? filled('fullName') && EMAIL_PATTERN.test(val('email').trim()) && filled('github') && filled('stack')
        : filled('orgName') &&
            EMAIL_PATTERN.test(val('workEmail').trim()) &&
            filled('teamSize') &&
            filled('role') &&
            filled('useCase');
    }
    return passwordGrade.valid && val('password') === val('confirmPassword') && agreed;
  })();

  const canLogin = EMAIL_PATTERN.test(val('loginEmail').trim()) && filled('loginPassword');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // No backend yet. Submitting a valid form drops you into the workspace.
    onAuthenticated();
  }

  const heading =
    mode === 'login'
      ? {
          eyebrow: '',
          title: 'The hound remembers your scent',
          blurb: 'Sign in to reach your security workspace.',
        }
      : step === 1 && accountType === 'organization'
        ? orgCopy
        : signupCopy[step];

  return (
    <main className="cerberus-page">
      <section className="brand-panel" aria-label="Cerberus overview">
        <MatrixRain />
        <div className="brand-glow" aria-hidden="true" />
        <div className="brand-content">
          <div className="brand-mark">
            <img className="brand-sigil" src="/cerberus-mark.webp" alt="" width={224} height={140} />
            <span className="wordmark">Cerberus</span>
          </div>

          <div className="brand-stage">
            <CerberusBeast />
          </div>

          <div className="brand-footer">
            <div className="brand-copy">
              <p className="eyebrow">Open source security control plane</p>
              <h1>Three heads. One gate. Nothing passes.</h1>
              <p className="brand-blurb">
                Cerberus pulls scanners, runtime signals, repositories, containers, and cloud posture into one
                workspace.
              </p>
            </div>

            <div className="signal-grid">
              <div>
                <strong>Repos</strong>
                <span>Code and dependency risk</span>
              </div>
              <div>
                <strong>Runtime</strong>
                <span>Wazuh, Falco, osquery</span>
              </div>
              <div>
                <strong>Cloud</strong>
                <span>Posture and IaC checks</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="auth-panel" aria-label={mode === 'login' ? 'Login' : 'Sign up'}>
        <div className="auth-card">
          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'active' : ''}
              type="button"
              onClick={() => switchMode('login')}
            >
              Login
            </button>
            <button
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'active' : ''}
              type="button"
              onClick={() => switchMode('signup')}
            >
              Sign up
            </button>
          </div>

          {mode === 'signup' && (
            <ol className="step-rail" aria-label={`Step ${step + 1} of 3`}>
              {STEP_LABELS.map((label, index) => (
                <li key={label} data-state={index < step ? 'done' : index === step ? 'current' : 'todo'}>
                  <span className="step-dot">{index < step ? <Check size={12} aria-hidden="true" /> : index + 1}</span>
                  <span className="step-label">{label}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="auth-heading">
            {heading.eyebrow && <p className="eyebrow">{heading.eyebrow}</p>}
            <h2>{heading.title}</h2>
            <p className="auth-blurb">{heading.blurb}</p>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleSubmit}>
              <StepViewport>
                <div className="step-pane">
                  <TextField
                    label="Email address"
                    icon={Mail}
                    name="loginEmail"
                    value={val('loginEmail')}
                    onChange={set}
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                  />
                  <PasswordField
                    label="Password"
                    icon={LockKeyhole}
                    name="loginPassword"
                    value={val('loginPassword')}
                    onChange={set}
                    autoComplete="current-password"
                  />
                  <div className="auth-meta">
                    <label>
                      <input type="checkbox" defaultChecked />
                      <span>Remember this device</span>
                    </label>
                    <a href="#">Forgot password?</a>
                  </div>
                </div>
              </StepViewport>

              <button className="submit-button" type="submit" disabled={!canLogin}>
                Log in
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit}>
              <StepViewport>
                <div className="step-pane" key={step} data-direction={direction}>
                  {step === 0 && (
                    <div className="account-picker" role="radiogroup" aria-label="Account type">
                      {accountOptions.map((option) => {
                        const Icon = option.icon;
                        const selected = accountType === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            className={selected ? 'selected' : ''}
                            onClick={() => setAccountType(option.id)}
                          >
                            <span className="account-icon" aria-hidden="true">
                              <Icon size={18} />
                            </span>
                            <span className="account-text">
                              <strong>{option.title}</strong>
                              <small>{option.description}</small>
                            </span>
                            <span className="account-check" aria-hidden="true">
                              {selected && <Check size={14} />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Keyed by branch so React never reuses the personal fields'
                      DOM nodes for the organization fields, and the reverse. */}
                  {step === 1 && accountType === 'personal' && (
                    <div className="branch" key="personal">
                      <TextField
                        label="Full name"
                        icon={User}
                        name="fullName"
                        value={val('fullName')}
                        onChange={set}
                        autoComplete="name"
                        placeholder="Jane Doe"
                      />
                      <TextField
                        label="Email address"
                        icon={Mail}
                        name="email"
                        value={val('email')}
                        onChange={set}
                        type="email"
                        autoComplete="email"
                        placeholder="you@gmail.com"
                      />
                      <div className="split-fields">
                        <TextField
                          label="GitHub handle"
                          icon={Github}
                          name="github"
                          value={val('github')}
                          onChange={set}
                          placeholder="janedoe"
                        />
                        <SelectField
                          label="Primary stack"
                          icon={Code2}
                          name="stack"
                          value={val('stack')}
                          onChange={set}
                          placeholder="Select"
                          options={stackOptions}
                        />
                      </div>
                    </div>
                  )}

                  {step === 1 && accountType === 'organization' && (
                    <div className="branch" key="organization">
                      <TextField
                        label="Organization name"
                        icon={Building2}
                        name="orgName"
                        value={val('orgName')}
                        onChange={set}
                        autoComplete="organization"
                        placeholder="Acme Security"
                      />
                      <TextField
                        label="Work email"
                        icon={Mail}
                        name="workEmail"
                        value={val('workEmail')}
                        onChange={set}
                        type="email"
                        autoComplete="email"
                        placeholder="you@acme.com"
                      />
                      <div className="split-fields">
                        <SelectField
                          label="Team size"
                          icon={Users}
                          name="teamSize"
                          value={val('teamSize')}
                          onChange={set}
                          placeholder="Select"
                          options={teamSizes}
                        />
                        <SelectField
                          label="Your role"
                          icon={ShieldCheck}
                          name="role"
                          value={val('role')}
                          onChange={set}
                          placeholder="Select"
                          options={roleOptions}
                        />
                      </div>
                      <SelectField
                        label="Primary use case"
                        icon={Code2}
                        name="useCase"
                        value={val('useCase')}
                        onChange={set}
                        placeholder="Select a use case"
                        options={useCases}
                      />
                    </div>
                  )}

                  {step === 2 && (
                    <>
                      <p className="recap">
                        <span className="recap-chip">{accountType === 'personal' ? 'Personal' : 'Organization'}</span>
                        {accountType === 'personal' ? val('email') : val('workEmail')}
                      </p>
                      <PasswordField
                        label="Password"
                        icon={LockKeyhole}
                        name="password"
                        value={val('password')}
                        onChange={set}
                        autoComplete="new-password"
                      />
                      <StrengthMeter value={val('password')} />
                      <PasswordField
                        label="Confirm password"
                        icon={KeyRound}
                        name="confirmPassword"
                        value={val('confirmPassword')}
                        onChange={set}
                        autoComplete="new-password"
                      />
                      <div className="auth-meta">
                        <label>
                          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                          <span>I agree to the open source community terms</span>
                        </label>
                      </div>
                    </>
                  )}
                </div>
              </StepViewport>

              <div className="step-actions">
                {step > 0 && (
                  <button className="back-button" type="button" onClick={() => goTo(step - 1)}>
                    Back
                  </button>
                )}
                {step < 2 ? (
                  <button className="submit-button" type="button" disabled={!canAdvance} onClick={() => goTo(step + 1)}>
                    Continue
                  </button>
                ) : (
                  <button className="submit-button" type="submit" disabled={!canAdvance}>
                    Create account
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
