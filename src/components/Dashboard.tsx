import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Bell, CheckCircle2, ChevronRight, CircleDollarSign,
  Copy, EyeOff, FileText, Headphones, Home, KeyRound, LogOut, Moon, Paperclip, Send, Settings, Shield, Sparkles, Sun, UserRound, WalletCards, XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  formatCurrency, formatDate, formatStatus, getMethodLabel,
  type Profile, type Transaction, type WithdrawalRequest, type Transfer, type MoneyRequest,
} from '@/lib/types';
import { WithdrawalModal } from '@/components/WithdrawalModal';
import { TransferModal } from '@/components/TransferModal';
import { RequestModal } from '@/components/RequestModal';
import { SupportChat } from '@/components/SupportChat';
import { CardPanel } from '@/components/CardPanel';
import { BankStatements } from '@/components/BankStatements';

type Tab = 'Home' | 'Activity' | 'Send' | 'Cards' | 'Support' | 'Profile' | 'Statements';
type QuickAction = { label: string; icon: typeof ArrowDownLeft; tone: string };

const quickActions: QuickAction[] = [
  { label: 'Send', icon: ArrowLeftRight, tone: 'plum' },
  { label: 'Request', icon: ArrowDownLeft, tone: 'berry' },
  { label: 'Withdraw', icon: Banknote, tone: 'wine' },
  { label: 'Statements', icon: FileText, tone: 'lilac' },
];

export function Dashboard({ session, profile, onLogout }: { session: Session; profile: Profile; onLogout: () => Promise<void> }) {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [isDark, setIsDark] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Home');
  const [notice, setNotice] = useState('');
  const [isWithdrawalOpen, setIsWithdrawalOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<MoneyRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<MoneyRequest[]>([]);
  const [balance, setBalance] = useState(profile.balance);
  const [monthlyIn, setMonthlyIn] = useState(0);
  const [monthlyOut, setMonthlyOut] = useState(0);
  const [reqBusy, setReqBusy] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [editName, setEditName] = useState(profile.display_name);
  const [showSettingsForm, setShowSettingsForm] = useState(false);
  const [displayName, setDisplayName] = useState(profile.display_name);
  const supportedCurrencies = ['USD', 'GBP', 'CAD', 'AUD', 'EUR'] as const;
  const [displayCurrency, setDisplayCurrency] = useState(() => {
    const savedCurrency = localStorage.getItem('skrill-display-currency');
    return supportedCurrencies.includes(savedCurrency as typeof supportedCurrencies[number]) ? savedCurrency as typeof supportedCurrencies[number] : 'USD';
  });
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ USD: 1 });
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState('');
  const [ratesUnavailable, setRatesUnavailable] = useState(false);
  const currencyNames: Record<string, string> = { USD: 'United States Dollar', GBP: 'British Pound Sterling', CAD: 'Canadian Dollar', AUD: 'Australian Dollar', EUR: 'Euro' };
  const currencyFlags: Record<string, string> = { USD: '🇺🇸', GBP: '🇬🇧', CAD: '🇨🇦', AUD: '🇦🇺', EUR: '🇪🇺' };

  const displayMoney = (amount: number) => {
    const currency = ratesUnavailable && displayCurrency !== 'USD' ? 'USD' : displayCurrency;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount * (exchangeRates[currency] ?? 1));
  };

  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2800); };

  useEffect(() => {
    let active = true;
    fetch('https://open.er-api.com/v6/latest/USD')
      .then((response) => { if (!response.ok) throw new Error('Exchange rates unavailable'); return response.json(); })
      .then((payload: { result?: string; rates?: Record<string, number>; time_last_update_utc?: string }) => {
        if (!active || payload.result !== 'success' || !payload.rates) throw new Error('Exchange rates unavailable');
        setExchangeRates({ USD: 1, ...payload.rates });
        setRatesUpdatedAt(payload.time_last_update_utc ?? '');
        setRatesUnavailable(false);
      })
      .catch(() => { if (active) setRatesUnavailable(true); });
    return () => { active = false; };
  }, []);

  const changeDisplayCurrency = (currency: string) => {
    setDisplayCurrency(currency);
    localStorage.setItem('skrill-display-currency', currency);
  };

  const loadData = useCallback(async () => {
    const { data: txData, error: txError } = await supabase
      .from('transactions')
      .select('id, type, amount, description, created_at')
      .order('created_at', { ascending: false });
    if (txError) { console.error('transactions load failed', txError); }
    else {
      const txs = (txData ?? []) as Transaction[];
      setTransactions(txs);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      let incoming = 0, outgoing = 0;
      for (const tx of txs) {
        const d = new Date(tx.created_at);
        if (d >= monthStart) {
          if (tx.type === 'credit') incoming += tx.amount;
          else outgoing += tx.amount;
        }
      }
      setMonthlyIn(incoming);
      setMonthlyOut(outgoing);
    }

    const { data: wData, error: wError } = await supabase
      .from('withdrawal_requests')
      .select('id, amount, status, payment_method, destination, memo, reference, review_message, created_at')
      .order('created_at', { ascending: false });
    if (wError) { console.error('withdrawals load failed', wError); }
    else setWithdrawals((wData ?? []) as WithdrawalRequest[]);

    const { data: tData, error: tError } = await supabase.rpc('list_my_transfer_receipts');
    if (tError) { console.error('transfers load failed', tError); }
    else setTransfers((tData ?? []) as Transfer[]);

    const { data: rData, error: rError } = await supabase
      .from('money_requests')
      .select('id, from_user_id, to_user_id, amount, memo, status, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (rError) { console.error('requests load failed', rError); }
    else {
      const all = (rData ?? []) as MoneyRequest[];
      setIncomingRequests(all.filter((r) => r.to_user_id === session.user.id));
      setOutgoingRequests(all.filter((r) => r.from_user_id === session.user.id));
    }

    const { data: pData, error: pError } = await supabase
      .from('profiles')
      .select('balance')
      .eq('id', session.user.id)
      .maybeSingle();
    if (pError) { console.error('balance load failed', pError); }
    else if (pData) setBalance(pData.balance);
  }, [session.user.id]);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleAction = (label: string) => {
    if (label === 'Withdraw') { setIsWithdrawalOpen(true); return; }
    if (label === 'Send') { setIsTransferOpen(true); return; }
    if (label === 'Request') { setIsRequestOpen(true); return; }
    if (label === 'Statements') { setActiveTab('Statements'); return; }
    showNotice(`${label} is ready to use`);
  };

  const handleApproveRequest = async (requestId: string) => {
    setReqBusy(requestId);
    const { error } = await supabase.rpc('approve_money_request', { p_request: requestId });
    setReqBusy(null);
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('insufficient')) showNotice('Your balance is too low to approve this request.');
      else showNotice('Could not approve this request.');
      return;
    }
    showNotice('Request approved — money sent.');
    void loadData();
  };

  const handleRejectRequest = async (requestId: string) => {
    setReqBusy(requestId);
    const { error } = await supabase.rpc('reject_money_request', { p_request: requestId });
    setReqBusy(null);
    if (error) { showNotice('Could not reject this request.'); return; }
    showNotice('Request rejected.');
    void loadData();
  };

  const handleCancelRequest = async (requestId: string) => {
    setReqBusy(requestId);
    const { error } = await supabase.rpc('cancel_money_request', { p_request: requestId });
    setReqBusy(null);
    if (error) { showNotice('Could not cancel this request.'); return; }
    showNotice('Request cancelled.');
    void loadData();
  };

  const pendingIncomingCount = incomingRequests.filter((r) => r.status === 'pending').length;

  const handleNav = (label: string) => {
    setActiveTab(label as Tab);
  };

  const firstName = profile.display_name.split(' ')[0] || 'there';

  const timeGreeting = (() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return `Good morning, ${firstName}`;
    if (hour >= 12 && hour < 17) return `Good afternoon, ${firstName}`;
    return `Good evening, ${firstName}`;
  })();

  return (
    <main className={isDark ? 'app-shell dark-mode' : 'app-shell'}>
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <div className="dashboard">
        <header className="topbar">
          <div className="brand-mark" aria-label="Skrill home">Skrill</div>
          <div className="header-actions">
            <button className="icon-button notification-button" onClick={() => setActiveTab('Activity')} aria-label="Notifications">
              <Bell size={21} strokeWidth={2.2} />
              {pendingIncomingCount > 0 && <span className="notification-dot" />}
            </button>
            <button className="icon-button" onClick={() => setIsDark((value) => !value)} aria-label="Toggle theme">{isDark ? <Sun size={21} /> : <Moon size={21} />}</button>
            <button className="profile-avatar-button" onClick={() => setActiveTab('Profile')} aria-label="Open profile">
              <span className="profile-avatar-sm">{firstName.charAt(0).toUpperCase()}</span>
            </button>
          </div>
        </header>

        {activeTab === 'Home' && (
          <>
            <section className="welcome-section">
              <div className="eyebrow"><Sparkles size={18} fill="currentColor" /><span>{timeGreeting.split(',')[0]}</span></div>
              <h1>{timeGreeting}</h1>
              <div className="customer-card">
                <div>
                  <span className="card-label">Customer ID</span>
                  <strong>{profile.account_id}</strong>
                  <small className="account-email">{session.user.email}</small>
                </div>
                <button className="copy-button" onClick={() => { void navigator.clipboard?.writeText(profile.account_id); showNotice('Customer ID copied'); }} aria-label="Copy customer ID"><Copy size={25} /></button>
              </div>
            </section>

            <section className="balance-card">
              <div className="balance-topline"><span>Available balance</span><label className="currency-pill"><span>Display currency</span><select aria-label="Display currency" value={displayCurrency} onChange={(event) => changeDisplayCurrency(event.target.value)}>{supportedCurrencies.map((currency) => <option key={currency} value={currency}>{currencyFlags[currency]} {currency}</option>)}</select></label></div>
              <div className="balance-amount-row">
                <strong>{balanceVisible ? displayMoney(balance) : '••••••••••'}</strong>
                <button className="visibility-button" onClick={() => setBalanceVisible((value) => !value)} aria-label={balanceVisible ? 'Hide balance' : 'Show balance'}>{balanceVisible ? <EyeOff size={22} /> : <CircleDollarSign size={22} />}</button>
              </div>
              <div className="currency-name"><span className="currency-flag">{currencyFlags[displayCurrency] || '💱'}</span> {currencyNames[displayCurrency] || displayCurrency} · converted display estimate</div>{ratesUnavailable && <small className="currency-rate-note">Exchange rates are temporarily unavailable. Showing the original USD amount.</small>}{!ratesUnavailable && ratesUpdatedAt && displayCurrency !== 'USD' && <small className="currency-rate-note">Rates updated {ratesUpdatedAt}. Display only; your stored account balance remains USD.</small>}
              <div className="balance-divider" />
              <div className="monthly-summary">
                <div><span>In this month</span><strong>+{displayMoney(monthlyIn)}</strong></div>
                <div><span>Out this month</span><strong>-{displayMoney(monthlyOut)}</strong></div>
              </div>
            </section>

            <section className="quick-section">
              <div className="section-heading"><h2>Quick actions</h2></div>
              <div className="quick-grid">
                {quickActions.map(({ label, icon: Icon, tone }) => (
                  <button className="quick-action" key={label} onClick={() => handleAction(label)}>
                    <span className={`quick-icon ${tone}`}><Icon size={25} strokeWidth={2.2} /></span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </section>

            {pendingIncomingCount > 0 && (
              <section className="activity-section">
                <div className="section-heading"><h2>Pending requests</h2><span className="tab-badge">{pendingIncomingCount}</span></div>
                <div className="activity-list">
                  {incomingRequests.filter((r) => r.status === 'pending').map((req) => (
                    <div className="activity-item" key={req.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span className="activity-icon soft"><ArrowDownLeft size={20} /></span>
                        <span className="activity-copy"><strong>Payment request</strong><small>{displayMoney(req.amount)}{req.memo ? ' · ' + req.memo : ''}</small></span>
                        <span className="activity-value"><strong>{displayMoney(req.amount)}</strong></span>
                      </div>
                      <div className="admin-w-actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="admin-action-btn approve" disabled={reqBusy === req.id} onClick={() => handleApproveRequest(req.id)}>
                          <CheckCircle2 size={15} /> Approve & Pay
                        </button>
                        <button className="admin-action-btn reject" disabled={reqBusy === req.id} onClick={() => handleRejectRequest(req.id)}>
                          <XCircle size={15} /> Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="activity-section">
              <div className="section-heading"><h2>Recent activity</h2><button onClick={() => setActiveTab('Activity')}>See all <ChevronRight size={16} /></button></div>
              <div className="activity-list">
                {transactions.length === 0 && <div className="empty-state"><p>No transactions yet.</p></div>}
                {transactions.slice(0, 5).map((tx) => (
                  <div className="activity-item" key={tx.id}>
                    <span className={`activity-icon ${tx.type === 'credit' ? 'green' : 'soft'}`}>
                      {tx.type === 'credit' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                    </span>
                    <span className="activity-copy"><strong>{tx.description}</strong><small>{formatDate(tx.created_at)}</small></span>
                    <span className="activity-value">
                      <strong className={tx.type === 'credit' ? 'positive' : ''}>{tx.type === 'credit' ? '+' : '-'}{displayMoney(tx.amount)}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === 'Activity' && (
          <section className="tab-section">
            {/* Incoming requests */}
            {incomingRequests.length > 0 && (
              <>
                <div className="section-heading"><h2>Incoming requests</h2></div>
                <div className="activity-list">
                  {incomingRequests.map((req) => (
                    <div className="activity-item" key={req.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span className="activity-icon soft"><ArrowDownLeft size={20} /></span>
                        <span className="activity-copy">
                          <strong>Request from {outgoingRequests.find((r) => r.id === req.id) ? 'You' : 'User'}</strong>
                          <small>{displayMoney(req.amount)}{req.memo ? ' · ' + req.memo : ''} · {formatDate(req.created_at)}</small>
                        </span>
                        <span className="activity-value">
                          <strong>{displayMoney(req.amount)}</strong>
                          <span className={`status-badge ${req.status}`}>{formatStatus(req.status)}</span>
                        </span>
                      </div>
                      {req.status === 'pending' && (
                        <div className="admin-w-actions" style={{ justifyContent: 'flex-end' }}>
                          <button className="admin-action-btn approve" disabled={reqBusy === req.id} onClick={() => handleApproveRequest(req.id)}>
                            <CheckCircle2 size={15} /> Approve & Pay
                          </button>
                          <button className="admin-action-btn reject" disabled={reqBusy === req.id} onClick={() => handleRejectRequest(req.id)}>
                            <XCircle size={15} /> Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Outgoing requests */}
            {outgoingRequests.length > 0 && (
              <>
                <div className="section-heading" style={{ marginTop: '30px' }}><h2>Outgoing requests</h2></div>
                <div className="activity-list">
                  {outgoingRequests.map((req) => (
                    <div className="activity-item" key={req.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span className="activity-icon soft"><ArrowUpRight size={20} /></span>
                        <span className="activity-copy">
                          <strong>Request to {req.to_user_id}</strong>
                          <small>{displayMoney(req.amount)}{req.memo ? ' · ' + req.memo : ''} · {formatDate(req.created_at)}</small>
                        </span>
                        <span className="activity-value">
                          <strong>{displayMoney(req.amount)}</strong>
                          <span className={`status-badge ${req.status}`}>{formatStatus(req.status)}</span>
                        </span>
                      </div>
                      {req.status === 'pending' && (
                        <div className="admin-w-actions" style={{ justifyContent: 'flex-end' }}>
                          <button className="admin-action-btn reject" disabled={reqBusy === req.id} onClick={() => handleCancelRequest(req.id)}>
                            <XCircle size={15} /> Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Transfers */}
            {transfers.length > 0 && (
              <>
                <div className="section-heading" style={{ marginTop: '30px' }}><h2>Transfers</h2></div>
                <div className="activity-list">
                  {transfers.map((tr) => {
                    const isSender = tr.sender_email.toLowerCase() === (session.user.email ?? '').toLowerCase();
                    const otherParty = isSender ? `${tr.recipient_name} · ${tr.recipient_account_id}` : `${tr.sender_name} · ${tr.sender_account_id}`;
                    return (
                      <div className="activity-item" key={tr.transfer_id}>
                        <span className={`activity-icon ${isSender ? 'soft' : 'green'}`}>
                          {isSender ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                        </span>
                        <span className="activity-copy">
                          <strong>{isSender ? `Transfer to ${otherParty}` : `Transfer from ${otherParty}`}</strong>
                          <small>{tr.reference} · {tr.memo || 'No memo'} · {formatDate(tr.created_at)} · {formatStatus(tr.status)}</small>
                        </span>
                        <span className="activity-value">
                          <strong className={isSender ? '' : 'positive'}>{isSender ? '-' : '+'}{displayMoney(tr.amount)}</strong>
                          <small>Fee {displayMoney(tr.fee)}</small>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* All transactions */}
            <div className="section-heading" style={{ marginTop: '30px' }}><h2>Transaction history</h2></div>
            <div className="activity-list">
              {transactions.length === 0 && <div className="empty-state"><p>No transactions yet.</p></div>}
              {transactions.map((tx) => (
                <div className="activity-item" key={tx.id}>
                  <span className={`activity-icon ${tx.type === 'credit' ? 'green' : 'soft'}`}>
                    {tx.type === 'credit' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                  </span>
                  <span className="activity-copy"><strong>{tx.description}</strong><small>{formatDate(tx.created_at)}</small></span>
                  <span className="activity-value">
                    <strong className={tx.type === 'credit' ? 'positive' : ''}>{tx.type === 'credit' ? '+' : '-'}{displayMoney(tx.amount)}</strong>
                  </span>
                </div>
              ))}
            </div>

            {/* Withdrawal history */}
            <div className="section-heading" style={{ marginTop: '30px' }}><h2>Withdrawal history</h2></div>
            <div className="activity-list">
              {withdrawals.length === 0 && <div className="empty-state"><p>No withdrawal requests yet.</p></div>}
              {withdrawals.map((w) => (
                <div className="activity-item" key={w.id}>
                  <span className="activity-icon soft"><ArrowUpRight size={20} /></span>
                  <span className="activity-copy">
                    <strong>Withdrawal — {getMethodLabel(w.payment_method)}</strong>
                    <small>{w.reference} · {formatDate(w.created_at)} · {w.destination}</small>
                  </span>
                  <span className="activity-value">
                    <strong>-{displayMoney(w.amount)}</strong>
                    <span className={`status-badge ${w.status}`}>{formatStatus(w.status)}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'Send' && (
          <section className="tab-section">
            <div className="section-heading"><h2>Send & Request</h2></div>
            <div className="send-actions">
              <button className="send-action-card" onClick={() => setIsTransferOpen(true)}>
                <span className="quick-icon plum"><ArrowLeftRight size={25} /></span>
                <strong>Transfer money</strong>
                <small>Send to another Skrill user by email or Account ID</small>
              </button>
              <button className="send-action-card" onClick={() => setIsRequestOpen(true)}>
                <span className="quick-icon berry"><ArrowDownLeft size={25} /></span>
                <strong>Request money</strong>
                <small>Send a payment request to another user</small>
              </button>
              <button className="send-action-card" onClick={() => setIsWithdrawalOpen(true)}>
                <span className="quick-icon wine"><Banknote size={25} /></span>
                <strong>Withdraw funds</strong>
                <small>Withdraw via 10 supported methods</small>
              </button>
            </div>
          </section>
        )}

        {activeTab === 'Support' && (
          <section className="tab-section">
            <SupportChat userId={session.user.id} displayName={profile.display_name} />
          </section>
        )}

        {activeTab === 'Cards' && (
          <section className="tab-section">
            <div className="section-heading"><h2>Your cards</h2></div>
            <CardPanel userId={session.user.id} displayName={profile.display_name} />
          </section>
        )}

        {activeTab === 'Statements' && (
          <section className="tab-section">
            <div className="section-heading"><h2>Bank statements</h2></div>
            <BankStatements userId={session.user.id} />
          </section>
        )}

        {activeTab === 'Profile' && (
          <section className="tab-section">
            <div className="section-heading"><h2>Your profile</h2></div>
            <div className="profile-card">
              <div className="profile-avatar"><UserRound size={40} /></div>
              <div className="profile-info">
                <strong>{profile.display_name}</strong>
                <small>{session.user.email}</small>
              </div>
            </div>
            <div className="profile-details">
              <div className="profile-row"><span>Customer ID</span><strong>{profile.account_id}</strong></div>
              <div className="profile-row"><span>Account role</span><strong>User since {new Date(profile.created_at || '2026-01-01').getFullYear()}</strong></div>
              <div className="profile-row"><span>Available balance</span><strong>{displayMoney(balance)}</strong></div>
              <div className="profile-row"><span>Email address</span><strong>{session.user.email}</strong></div>
            </div>

            <div className="profile-actions-section">
              <div className="section-heading"><h3>Account</h3></div>
              <div className="profile-menu">
                <button className="profile-menu-item" onClick={() => { setShowSettingsForm((v) => !v); setShowPasswordForm(false); setProfileMsg(''); }}>
                  <span className="profile-menu-icon"><Settings size={18} /></span>
                  <span className="profile-menu-text"><strong>Account settings</strong><small>Update your display name</small></span>
                  <ChevronRight size={18} className="profile-menu-chevron" />
                </button>
                <button className="profile-menu-item" onClick={() => { setShowPasswordForm((v) => !v); setShowSettingsForm(false); setProfileMsg(''); }}>
                  <span className="profile-menu-icon"><Shield size={18} /></span>
                  <span className="profile-menu-text"><strong>Security</strong><small>Change your password</small></span>
                  <ChevronRight size={18} className="profile-menu-chevron" />
                </button>
                <button className="profile-menu-item danger" onClick={onLogout}>
                  <span className="profile-menu-icon"><LogOut size={18} /></span>
                  <span className="profile-menu-text"><strong>Sign out</strong><small>End your session securely</small></span>
                  <ChevronRight size={18} className="profile-menu-chevron" />
                </button>
              </div>
            </div>

            {showSettingsForm && (
              <div className="profile-form-card">
                <h3>Account settings</h3>
                <label>Display name
                  <input value={editName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" />
                </label>
                {profileMsg && <p className="profile-form-msg ok">{profileMsg}</p>}
                <div className="profile-form-actions">
                  <button className="profile-action-btn" onClick={() => { setShowSettingsForm(false); setProfileMsg(''); setEditName(profile.display_name); }} disabled={profileBusy}>Cancel</button>
                  <button className="profile-action-btn primary" onClick={async () => {
                    const trimmed = displayName.trim();
                    if (!trimmed) { setProfileMsg('Name cannot be empty.'); return; }
                    setProfileBusy(true);
                    const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', session.user.id);
                    setProfileBusy(false);
                    if (error) { setProfileMsg('Could not update your name.'); return; }
                    setEditName(trimmed);
                    setProfileMsg('Your name has been updated.');
                  }} disabled={profileBusy || displayName.trim() === profile.display_name}>
                    {profileBusy ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            )}

            {showPasswordForm && (
              <div className="profile-form-card">
                <h3><KeyRound size={18} /> Change password</h3>
                <label>New password
                  <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 6 characters" minLength={6} autoComplete="new-password" />
                </label>
                <label>Confirm new password
                  <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter your new password" minLength={6} autoComplete="new-password" />
                </label>
                {profileMsg && <p className={`profile-form-msg ${profileMsg.includes('updated') ? 'ok' : 'err'}`}>{profileMsg}</p>}
                <div className="profile-form-actions">
                  <button className="profile-action-btn" onClick={() => { setShowPasswordForm(false); setProfileMsg(''); setNewPassword(''); setConfirmPassword(''); }} disabled={profileBusy}>Cancel</button>
                  <button className="profile-action-btn primary" onClick={async () => {
                    if (newPassword.length < 6) { setProfileMsg('Password must be at least 6 characters.'); return; }
                    if (newPassword !== confirmPassword) { setProfileMsg('Passwords do not match.'); return; }
                    setProfileBusy(true);
                    const { error } = await supabase.auth.updateUser({ password: newPassword });
                    setProfileBusy(false);
                    if (error) { setProfileMsg('Could not update your password. Please try again.'); return; }
                    setProfileMsg('Your password has been updated.');
                    setNewPassword('');
                    setConfirmPassword('');
                  }} disabled={profileBusy || !newPassword || !confirmPassword}>
                    {profileBusy ? 'Updating…' : 'Update password'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {([
          { label: 'Home', icon: Home },
          { label: 'Activity', icon: ArrowLeftRight },
          { label: 'Send', icon: Send },
          { label: 'Cards', icon: WalletCards },
          { label: 'Support', icon: Headphones },
        ] as const).map(({ label, icon: Icon }) => (
          <button className={activeTab === label ? 'nav-item active' : 'nav-item'} key={label} onClick={() => handleNav(label)}>
            <Icon size={22} strokeWidth={activeTab === label ? 2.5 : 2} /><span>{label}</span>
          </button>
        ))}
      </nav>

      {notice && <div className="toast" role="status"><span className="toast-mark"><Paperclip size={15} /></span>{notice}</div>}
      <WithdrawalModal open={isWithdrawalOpen} onClose={() => { setIsWithdrawalOpen(false); void loadData(); }} currentBalance={balance} />
      <TransferModal open={isTransferOpen} onClose={() => { setIsTransferOpen(false); void loadData(); }} currentBalance={balance} />
      <RequestModal open={isRequestOpen} onClose={() => { setIsRequestOpen(false); void loadData(); }} currentAccountId={profile.account_id} />
    </main>
  );
}
