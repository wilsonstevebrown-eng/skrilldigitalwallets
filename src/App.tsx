import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { AuthScreen } from '@/components/AuthScreen';
import { Dashboard } from '@/components/Dashboard';
import { AdminDashboard } from '@/components/AdminDashboard';

type AuthMode = 'login' | 'signup' | 'reset-request' | 'reset-password';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [isLoading, setIsLoading] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let isMounted = true;
    const loadProfile = async (nextSession: Session | null) => {
      if (!nextSession) {
        if (isMounted) { setSession(null); setProfile(null); setIsLoading(false); }
        return;
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('display_name, account_id, balance, role, created_at')
        .eq('id', nextSession.user.id)
        .maybeSingle();
      if (!isMounted) return;
      if (error || !data) {
        console.error('profile load failed', error);
        setAuthError('We could not load your wallet profile. Please sign in again.');
        await supabase.auth.signOut();
        return;
      }
      setSession(nextSession);
      setProfile(data as Profile);
      setIsLoading(false);
      setAuthError('');
    };

    void supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
        setSession(null);
        setProfile(null);
        setIsLoading(false);
        setAuthMode('reset-password');
        return;
      }
      setIsRecovery(false);
      void loadProfile(nextSession);
    });
    return () => { isMounted = false; listener.subscription.unsubscribe(); };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  if (isLoading) return <main className="loading-shell"><div className="auth-brand">Skrill</div><p>Preparing your secure wallet…</p></main>;

  if (session && profile && !isRecovery) {
    if (profile.role === 'admin') return <AdminDashboard session={session} profile={profile} onLogout={handleLogout} />;
    return <Dashboard session={session} profile={profile} onLogout={handleLogout} />;
  }

  return (
    <>
      <AuthScreen initialMode={authMode} onModeChange={setAuthMode} />
      {authError && <div className="auth-error-banner">{authError}</div>}
    </>
  );
}

export default App;
