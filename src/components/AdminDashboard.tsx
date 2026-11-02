import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CheckCircle2, CreditCard, Headphones, LogOut, Moon, Shield, Sun, Users, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  formatCurrency, formatDate, formatStatus, getMethodLabel,
  type AdminUser, type AdminWithdrawal, type AdminTransfer, type AdminMoneyRequest, type AdminCardActivation, type Profile,
} from '@/lib/types';
import { AdminSupportInbox } from '@/components/AdminSupportInbox';
import { SupportNotificationListener } from '@/components/SupportNotificationListener';

type AdminTab = 'users' | 'withdrawals' | 'transfers' | 'requests' | 'cards' | 'support';

export function AdminDashboard({ session, profile, onLogout }: { session: Session; profile: Profile; onLogout: () => Promise<void> }) {
  const [isDark, setIsDark] = useState(false);
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [transfers, setTransfers] = useState<AdminTransfer[]>([]);
  const [requests, setRequests] = useState<AdminMoneyRequest[]>([]);
  const [cardActivations, setCardActivations] = useState<AdminCardActivation[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 3000); };

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const { data: usersData, error: usersError } = await supabase.rpc('admin_list_users');
    if (usersError) { console.error('admin users load failed', usersError); }
    else setUsers((usersData ?? []) as AdminUser[]);

    const { data: wData, error: wError } = await supabase.rpc('admin_list_withdrawals');
    if (wError) { console.error('admin withdrawals load failed', wError); }
    else setWithdrawals((wData ?? []) as AdminWithdrawal[]);

    const { data: tData, error: tError } = await supabase.rpc('admin_list_transfers');
    if (tError) { console.error('admin transfers load failed', tError); }
    else setTransfers((tData ?? []) as AdminTransfer[]);

    const { data: rData, error: rError } = await supabase.rpc('admin_list_money_requests');
    if (rError) { console.error('admin requests load failed', rError); }
    else setRequests((rData ?? []) as AdminMoneyRequest[]);

    const { data: cData, error: cError } = await supabase.rpc('admin_list_card_activations');
    if (cError) { console.error('admin card activations load failed', cError); }
    else setCardActivations((cData ?? []) as AdminCardActivation[]);

    setIsLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleCredit = async (userId: string) => {
    const input = window.prompt('Enter the amount to credit (USD):');
    if (!input) return;
    const amount = Number(input);
    if (!Number.isFinite(amount) || amount <= 0) { showNotice('Enter a valid amount greater than zero.'); return; }
    const description = window.prompt('Enter a description (optional):') ?? '';
    const { error } = await supabase.rpc('admin_credit_balance', { p_user: userId, p_amount: amount, p_description: description });
    if (error) { console.error('credit failed', error); showNotice('Could not credit the balance. Please try again.'); return; }
    showNotice('Balance credited successfully.');
    void loadData();
  };

  const handleRoleChange = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    const { error } = await supabase.rpc('admin_update_user_role', { p_user: userId, p_role: newRole });
    if (error) { console.error('role change failed', error); showNotice('Could not update the role. Please try again.'); return; }
    showNotice(`Role updated to ${newRole}.`);
    void loadData();
  };

  const handleReview = async (requestId: string, action: 'approve' | 'reject') => {
    const message = window.prompt(action === 'approve' ? 'Approval note (optional):' : 'Rejection reason (optional):') ?? '';
    const { error } = await supabase.rpc('admin_review_withdrawal', { p_request: requestId, p_action: action, p_message: message });
    if (error) { console.error('review failed', error); showNotice('Could not review this request. Please try again.'); return; }
    showNotice(action === 'approve' ? 'Withdrawal approved.' : 'Withdrawal rejected.');
    void loadData();
  };

  const pendingWithdrawalCount = withdrawals.filter((w) => w.status === 'pending' || w.status === 'under_review').length;
  const pendingRequestCount = requests.filter((r) => r.status === 'pending').length;
  const pendingCardCount = cardActivations.filter((c) => c.status === 'pending').length;

  const handleReviewCard = async (requestId: string, action: 'approve' | 'reject') => {
    const message = window.prompt(action === 'approve' ? 'Approval note (optional):' : 'Rejection reason (optional):') ?? '';
    const { error } = await supabase.rpc('admin_review_card_activation', { p_request_id: requestId, p_action: action, p_message: message });
    if (error) { console.error('card review failed', error); showNotice('Could not review this card request. Please try again.'); return; }
    showNotice(action === 'approve' ? 'Card activation approved.' : 'Card activation rejected.');
    void loadData();
  };

  return (
    <main className={isDark ? 'app-shell dark-mode' : 'app-shell'}>
      <SupportNotificationListener role="admin" />
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <div className="dashboard">
        <header className="topbar">
          <div className="brand-mark admin-brand"><Shield size={18} /> Admin</div>
          <div className="header-actions">
            <button className="icon-button" onClick={() => setIsDark((value) => !value)} aria-label="Toggle theme">{isDark ? <Sun size={21} /> : <Moon size={21} />}</button>
            <button className="logout-button" onClick={onLogout}><LogOut size={17} /> Log out</button>
          </div>
        </header>

        <section className="welcome-section">
          <div className="eyebrow"><Shield size={18} fill="currentColor" /><span>Administrator</span></div>
          <h1>{profile.display_name}</h1>
          <small className="account-email">{session.user.email}</small>
        </section>

        <div className="admin-tabs">
          <button className={activeTab === 'users' ? 'admin-tab active' : 'admin-tab'} onClick={() => setActiveTab('users')}>
            <Users size={18} /> Users
          </button>
          <button className={activeTab === 'withdrawals' ? 'admin-tab active' : 'admin-tab'} onClick={() => setActiveTab('withdrawals')}>
            <ArrowUpRight size={18} /> Withdrawals
            {pendingWithdrawalCount > 0 && <span className="tab-badge">{pendingWithdrawalCount}</span>}
          </button>
          <button className={activeTab === 'transfers' ? 'admin-tab active' : 'admin-tab'} onClick={() => setActiveTab('transfers')}>
            <ArrowLeftRight size={18} /> Transfers
          </button>
          <button className={activeTab === 'requests' ? 'admin-tab active' : 'admin-tab'} onClick={() => setActiveTab('requests')}>
            <ArrowDownLeft size={18} /> Requests
            {pendingRequestCount > 0 && <span className="tab-badge">{pendingRequestCount}</span>}
          </button>
          <button className={activeTab === 'cards' ? 'admin-tab active' : 'admin-tab'} onClick={() => setActiveTab('cards')}>
            <CreditCard size={18} /> Cards
            {pendingCardCount > 0 && <span className="tab-badge">{pendingCardCount}</span>}
          </button>
          <button className={activeTab === 'support' ? 'admin-tab active' : 'admin-tab'} onClick={() => setActiveTab('support')}>
            <Headphones size={18} /> Support
          </button>
        </div>

        {isLoading && <p className="empty-state">Loading…</p>}

        {activeTab === 'users' && !isLoading && (
          <section className="admin-section">
            <div className="admin-user-list">
              {users.length === 0 && <div className="empty-state"><p>No registered users.</p></div>}
              {users.map((user) => (
                <div className="admin-user-card" key={user.id}>
                  <div className="admin-user-info">
                    <strong>{user.display_name}</strong>
                    <small>{user.email} · {user.account_id}</small>
                  </div>
                  <div className="admin-user-stats">
                    <span className="admin-balance">{formatCurrency(user.balance)}</span>
                    <span className={`admin-role-badge ${user.role}`}>{user.role}</span>
                  </div>
                  <div className="admin-user-actions">
                    <button className="admin-action-btn credit" onClick={() => handleCredit(user.id)}>
                      <ArrowDownLeft size={15} /> Credit
                    </button>
                    <button className="admin-action-btn" onClick={() => handleRoleChange(user.id, user.role)}>
                      {user.role === 'admin' ? 'Demote' : 'Promote'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'withdrawals' && !isLoading && (
          <section className="admin-section">
            <div className="admin-user-list">
              {withdrawals.length === 0 && <div className="empty-state"><p>No withdrawal requests.</p></div>}
              {withdrawals.map((w) => (
                <div className="admin-withdrawal-card" key={w.id}>
                  <div className="admin-w-top">
                    <div className="admin-user-info">
                      <strong>{w.display_name}</strong>
                      <small>{w.email} · {w.account_id}</small>
                    </div>
                    <span className={`status-badge ${w.status}`}>{formatStatus(w.status)}</span>
                  </div>
                  <div className="admin-w-details">
                    <div><span>Amount</span><strong>{formatCurrency(w.amount)}</strong></div>
                    <div><span>Method</span><strong>{getMethodLabel(w.payment_method)}</strong></div>
                    <div><span>Reference</span><strong>{w.reference}</strong></div>
                    <div><span>Date</span><strong>{formatDate(w.created_at)}</strong></div>
                    {w.memo && <div style={{ gridColumn: '1 / -1' }}><span>Memo</span><strong>{w.memo}</strong></div>}
                    <div style={{ gridColumn: '1 / -1' }}><span>Destination</span><strong>{w.destination}</strong></div>
                  </div>
                  {w.review_message && w.status !== 'pending' && <p className="admin-w-message">{w.review_message}</p>}
                  {(w.status === 'pending' || w.status === 'under_review') && (
                    <div className="admin-w-actions">
                      <button className="admin-action-btn approve" onClick={() => handleReview(w.id, 'approve')}>
                        <CheckCircle2 size={15} /> Approve
                      </button>
                      <button className="admin-action-btn reject" onClick={() => handleReview(w.id, 'reject')}>
                        <XCircle size={15} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'transfers' && !isLoading && (
          <section className="admin-section">
            <div className="admin-user-list">
              {transfers.length === 0 && <div className="empty-state"><p>No transfers yet.</p></div>}
              {transfers.map((tr) => (
                <div className="admin-withdrawal-card" key={tr.id}>
                  <div className="admin-w-top">
                    <div className="admin-user-info">
                      <strong>{tr.from_name} → {tr.to_name}</strong>
                      <small>{tr.from_email} → {tr.to_email}</small>
                    </div>
                    <span className={`status-badge ${tr.status}`}>{formatStatus(tr.status)}</span>
                  </div>
                  <div className="admin-w-details">
                    <div><span>Amount</span><strong>{formatCurrency(tr.amount)}</strong></div>
                    <div><span>Reference</span><strong>{tr.reference}</strong></div>
                    <div><span>From</span><strong>{tr.from_account_id}</strong></div>
                    <div><span>To</span><strong>{tr.to_account_id}</strong></div>
                    {tr.memo && <div style={{ gridColumn: '1 / -1' }}><span>Memo</span><strong>{tr.memo}</strong></div>}
                    <div><span>Date</span><strong>{formatDate(tr.created_at)}</strong></div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'requests' && !isLoading && (
          <section className="admin-section">
            <div className="admin-user-list">
              {requests.length === 0 && <div className="empty-state"><p>No money requests yet.</p></div>}
              {requests.map((req) => (
                <div className="admin-withdrawal-card" key={req.id}>
                  <div className="admin-w-top">
                    <div className="admin-user-info">
                      <strong>{req.from_name} requested from {req.to_name}</strong>
                      <small>{req.from_email} → {req.to_email}</small>
                    </div>
                    <span className={`status-badge ${req.status}`}>{formatStatus(req.status)}</span>
                  </div>
                  <div className="admin-w-details">
                    <div><span>Amount</span><strong>{formatCurrency(req.amount)}</strong></div>
                    <div><span>From</span><strong>{req.from_account_id}</strong></div>
                    <div><span>To</span><strong>{req.to_account_id}</strong></div>
                    <div><span>Date</span><strong>{formatDate(req.created_at)}</strong></div>
                    {req.memo && <div style={{ gridColumn: '1 / -1' }}><span>Memo</span><strong>{req.memo}</strong></div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'cards' && !isLoading && (
          <section className="admin-section">
            <div className="admin-user-list">
              {cardActivations.length === 0 && <div className="empty-state"><p>No card activation requests.</p></div>}
              {cardActivations.map((ca) => (
                <div className="admin-withdrawal-card" key={ca.id}>
                  <div className="admin-w-top">
                    <div className="admin-user-info">
                      <strong>{ca.customer_name}</strong>
                      <small>{ca.customer_email} · {ca.customer_account_id}</small>
                    </div>
                    <span className={`status-badge ${ca.status === 'approved' ? 'completed' : ca.status === 'rejected' ? 'rejected' : 'pending'}`}>{ca.status === 'approved' ? 'Approved' : ca.status === 'rejected' ? 'Rejected' : 'Pending'}</span>
                  </div>
                  <div className="admin-w-details">
                    <div><span>Card number</span><strong>{ca.card_number}</strong></div>
                    <div><span>Last 4</span><strong>{ca.last4}</strong></div>
                    <div><span>Requested</span><strong>{formatDate(ca.created_at)}</strong></div>
                    {ca.admin_message && <div style={{ gridColumn: '1 / -1' }}><span>Review note</span><strong>{ca.admin_message}</strong></div>}
                  </div>
                  {ca.status === 'pending' && (
                    <div className="admin-w-actions">
                      <button className="admin-action-btn approve" onClick={() => handleReviewCard(ca.id, 'approve')}>
                        <CheckCircle2 size={15} /> Approve
                      </button>
                      <button className="admin-action-btn reject" onClick={() => handleReviewCard(ca.id, 'reject')}>
                        <XCircle size={15} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'support' && !isLoading && (
          <AdminSupportInbox adminId={session.user.id} />
        )}
      </div>

      {notice && <div className="toast" role="status"><span className="toast-mark"><Shield size={15} /></span>{notice}</div>}
    </main>
  );
}
