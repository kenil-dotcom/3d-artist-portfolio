'use client';

/**
 * Client wrapper around the login server action.
 *
 * Uses `useFormState` to render the latest action result (error message,
 * preserved username) without losing the user's input on a failed attempt.
 */

import { useFormState, useFormStatus } from 'react-dom';
import type { ReactElement } from 'react';

import type { LoginActionState } from '@/app/admin/login/actions';

interface LoginFormClientProps {
  readonly action: (
    state: LoginActionState,
    formData: FormData,
  ) => Promise<LoginActionState>;
  readonly initialState: LoginActionState;
}

export function LoginFormClient({
  action,
  initialState,
}: LoginFormClientProps): ReactElement {
  const [state, formAction] = useFormState(action, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {state.error !== null ? (
        <p
          role="alert"
          className="rounded-2xl border-2 border-foreground bg-[hsl(var(--color-pop-amber)/0.25)] px-4 py-3 text-sm font-medium text-foreground"
        >
          {state.error}
        </p>
      ) : null}

      <div>
        <label htmlFor="admin-username" className="label-field">
          Username
        </label>
        <input
          id="admin-username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={60}
          defaultValue={state.username}
          className="input-field"
        />
      </div>

      <div>
        <label htmlFor="admin-password" className="label-field">
          Password
        </label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={1}
          maxLength={200}
          className="input-field"
        />
      </div>

      <SubmitButton />
    </form>
  );
}

function SubmitButton(): ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-primary w-full"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}
