import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type AuthMode = 'login' | 'signup' | 'reset-request' | 'reset-password';

function friendlyAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login')) return 'The email or password is incorrect.';
  if (normalized.includes('password')) return 'Use a password with at least 6 characters.';
  if (normalized.includes('already registered') || normalized.includes('already been registered')) return 'That email is already registered. Try signing in.';
  return 'We could not complete that request. Please try again.';
}

export function AuthScreen({ initialMode, onModeChange }: { initialMode: AuthMode; onModeChange: (mode: AuthMode) => void }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => { setMode(initialMode); }, [initialMode]);

  const changeMode = (nextMode: AuthMode) => {
    setMessage('');
    setPassword('');
    setNewPassword('');
    setMode(nextMode);
    onModeChange(nextMode);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setIsBusy(true);

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } },
        });
        if (error) throw error;
        setMessage('Your account is ready. You can now sign in.');
        changeMode('login');
      } else if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'reset-request') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setMessage('If that email is registered, a reset link is on its way.');
      } else {
        if (newPassword.length < 6) {
          setMessage('Use a new password with at least 6 characters.');
          return;
        }
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        await supabase.auth.signOut();
        setMessage('Your password was updated.');
        changeMode('login');
      }
    } catch (error) {
      console.error('authentication request failed', error);
      setMessage(friendlyAuthError(error instanceof Error ? error.message : 'request failed'));
    } finally {
      setIsBusy(false);
    }
  };

  const isReset = mode === 'reset-request' || mode === 'reset-password';
  return (
    <main className="auth-shell">
      <div className="auth-orb auth-orb-one" />
      <div className="auth-orb auth-orb-two" />
      <section className="auth-card">
        <div className="auth-brand">Skrill</div>
        <div className="auth-heading">
          <div className="auth-kicker"><Sparkles size={16} fill="currentColor" /> Private wallet access</div>
          <h1>{mode === 'signup' ? 'Create your account' : mode === 'reset-request' ? 'Reset your password' : mode === 'reset-password' ? 'Choose a new password' : 'Welcome back'}</h1>
          <p>{mode === 'signup' ? 'Set up your personal wallet in a few simple steps.' : mode === 'reset-request' ? 'Enter your email and we&apos;ll send a secure reset link.' : mode === 'reset-password' ? 'Your new password will protect your wallet account.' : 'Sign in to see your balance and recent activity.'}</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'signup' && <label>Full name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Bestdaddy" required autoComplete="name" /></label>}
          {mode !== 'reset-password' && <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required autoComplete="email" /></label>}
          {(mode === 'login' || mode === 'signup') && <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>}
          {mode === 'reset-password' && <label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 6 characters" required minLength={6} autoComplete="new-password" /></label>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="auth-submit" type="submit" disabled={isBusy}>{isBusy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'reset-request' ? 'Send reset link' : mode === 'reset-password' ? 'Update password' : 'Sign in'}</button>
        </form>
        <div className="auth-links">
          {mode === 'login' && <><button onClick={() => changeMode('reset-request')}>Forgot password?</button><p>New to Skrill? <button onClick={() => changeMode('signup')}>Create an account</button></p></>}
          {mode === 'signup' && <p>Already have an account? <button onClick={() => changeMode('login')}>Sign in</button></p>}
          {isReset && <button onClick={() => changeMode('login')}>Back to sign in</button>}
        </div>
      </section>
    </main>
  );
}
