/** /login, /signup, /forgot-password, /reset-password, /verify-email (PROJECT.md section 8). */
import {
  forgotSchema,
  loginSchema,
  resetSchema,
  signupSchema,
  PASSWORD_MIN,
} from '@cleanify/shared';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiError, auth } from '../api/client';
import { errorMessage, useMe, useRefreshMe } from '../api/queries';
import { Alert, Field, SubmitButton } from '../components/Form';
import { APP_NAME } from '../config';

type Errors = Record<string, string>;
type Issue = { path: PropertyKey[]; message: string };

/** The part of a zod schema the forms use (the web app doesn't depend on zod itself). */
interface Schema<T> {
  safeParse(
    v: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: Issue[] } };
}

/** Field errors from a zod failure, or from the API's validation details. */
function fieldErrors(issues: Issue[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? '');
    out[k] ??= i.message;
  }
  return out;
}

function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
  }, [title]);
}

/** Validates with the shared schema, then calls the API; returns false on any problem. */
function useForm<T>(schema: Schema<T>) {
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (values: unknown, send: (body: T) => Promise<void>) => {
    setProblem(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return false;
    }
    setErrors({});
    setBusy(true);
    try {
      await send(parsed.data);
      return true;
    } catch (e) {
      const details = e instanceof ApiError ? e.details : undefined;
      if (Array.isArray(details)) setErrors(fieldErrors(details as Issue[]));
      setProblem(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { errors, problem, busy, submit };
}

function AuthShell({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useTitle(title);
  return (
    <div className="mx-auto grid w-full max-w-sm gap-5 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
      {footer && <div className="text-sm text-muted">{footer}</div>}
    </div>
  );
}

const GOOGLE_ERRORS: Record<string, string> = {
  google_unavailable: 'Google sign-in isn’t set up on this server.',
  google_failed: 'Google sign-in didn’t finish. Try again.',
  google_unverified: 'That Google account’s email isn’t verified.',
};

function GoogleButton() {
  const me = useMe();
  if (!me.data?.google.enabled) return null;
  return (
    <>
      <a
        href="/api/auth/google"
        className="rounded-lg border border-border px-4 py-2 text-center font-medium hover:bg-surface-2"
      >
        Continue with Google
      </a>
      <p className="flex items-center gap-3 text-xs text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        or with email
      </p>
    </>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const refreshMe = useRefreshMe();
  const me = useMe();
  const form = useForm(loginSchema);
  const googleError = GOOGLE_ERRORS[params.get('error') ?? ''];
  const next = safeNext(params.get('next'));

  if (me.data?.user) return <Navigate to={next} replace />;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await form.submit(
      { email: f.get('email'), password: f.get('password') },
      async (b) => {
        await auth.login(b);
      },
    );
    if (ok) {
      await refreshMe();
      navigate(next, { replace: true });
    }
  };

  return (
    <AuthShell
      title="Log in"
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="text-accent-text underline">
            Create an account
          </Link>
        </>
      }
    >
      {googleError && <Alert>{googleError}</Alert>}
      <GoogleButton />
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={form.errors['email']}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={form.errors['password']}
        />
        {form.problem && <Alert>{form.problem}</Alert>}
        <SubmitButton busy={form.busy}>Log in</SubmitButton>
        <Link to="/forgot-password" className="text-sm text-accent-text underline">
          Forgot your password?
        </Link>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const refreshMe = useRefreshMe();
  const me = useMe();
  const form = useForm(signupSchema);

  if (me.data?.user) return <Navigate to="/app" replace />;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get('name') ?? '').trim();
    const ok = await form.submit(
      { email: f.get('email'), password: f.get('password'), ...(name ? { name } : {}) },
      async ({ name: n, ...rest }) => {
        await auth.signup(n ? { ...rest, name: n } : rest);
      },
    );
    if (ok) {
      await refreshMe();
      navigate('/app', { replace: true });
    }
  };

  return (
    <AuthShell
      title="Create an account"
      footer={
        <>
          Already have one?{' '}
          <Link to="/login" className="text-accent-text underline">
            Log in
          </Link>
        </>
      }
    >
      <p className="text-sm text-muted">
        Free. Keeps your cloud jobs, saved files and replacement rules. Browser mode works without
        an account.
      </p>
      <GoogleButton />
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field
          label="Name (optional)"
          name="name"
          autoComplete="name"
          error={form.errors['name']}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={form.errors['email']}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint={`At least ${PASSWORD_MIN} characters.`}
          error={form.errors['password']}
        />
        {form.problem && <Alert>{form.problem}</Alert>}
        <SubmitButton busy={form.busy}>Create account</SubmitButton>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const form = useForm(forgotSchema);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (
      await form.submit({ email: f.get('email') }, async (b) => void (await auth.forgot(b.email)))
    )
      setSent(true);
  };

  return (
    <AuthShell
      title="Reset your password"
      footer={
        <Link to="/login" className="text-accent-text underline">
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <Alert tone="ok">
          If an account uses that email, a reset link is on its way. It works for 1 hour.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            error={form.errors['email']}
          />
          {form.problem && <Alert>{form.problem}</Alert>}
          <SubmitButton busy={form.busy}>Send reset link</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const form = useForm(resetSchema);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (
      await form.submit(
        { token, password: f.get('password') },
        async (b) => void (await auth.reset(b.token, b.password)),
      )
    )
      setDone(true);
  };

  return (
    <AuthShell title="Choose a new password">
      {done ? (
        <Alert tone="ok">
          Password changed.{' '}
          <Link to="/login" className="text-accent-text underline">
            Log in
          </Link>
        </Alert>
      ) : !token ? (
        <Alert>
          This link is incomplete. Open the link from the email again, or{' '}
          <Link to="/forgot-password" className="underline">
            ask for a new one
          </Link>
          .
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <Field
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            hint={`At least ${PASSWORD_MIN} characters.`}
            error={form.errors['password']}
          />
          {(form.problem || form.errors['token']) && (
            <Alert>{form.errors['token'] ? 'This link is not valid.' : form.problem}</Alert>
          )}
          <SubmitButton busy={form.busy}>Change password</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const refreshMe = useRefreshMe();
  const [state, setState] = useState<'working' | 'ok' | string>('working');
  const started = useRef(false);

  useEffect(() => {
    // Once only: StrictMode runs effects twice, and a token can be used once.
    if (started.current || !token) return;
    started.current = true;
    auth
      .verify(token)
      .then(() => {
        setState('ok');
        void refreshMe();
      })
      .catch((e) => setState(errorMessage(e)));
  }, [token, refreshMe]);

  return (
    <AuthShell title="Confirm your email">
      {!token ? (
        <Alert>This link is incomplete. Open the link from the email again.</Alert>
      ) : state === 'working' ? (
        <p role="status">Checking the link…</p>
      ) : state === 'ok' ? (
        <Alert tone="ok">
          Email confirmed.{' '}
          <Link to="/app" className="text-accent-text underline">
            Go to your dashboard
          </Link>
        </Alert>
      ) : (
        <Alert>{state}</Alert>
      )}
    </AuthShell>
  );
}

/** Only same-site paths, so ?next= can't send people to another site. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}
