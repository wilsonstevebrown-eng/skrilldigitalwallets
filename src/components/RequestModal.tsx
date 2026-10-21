import { useEffect, useState } from 'react';
import { ArrowDownLeft, CheckCircle2, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, type MoneyRequest } from '@/lib/types';

type Stage = 'form' | 'success' | 'error';

export function RequestModal({ open, onClose, currentAccountId }: { open: boolean; onClose: () => void; currentAccountId: string }) {
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [sentRequests, setSentRequests] = useState<MoneyRequest[]>([]);

  useEffect(() => {
    if (!open) return;
    setAccountId(''); setAmount(''); setMemo(''); setStage('form'); setMessage('');
    void loadHistory();
  }, [open]);

  const loadHistory = async () => {
    const { data, error } = await supabase
      .from('money_requests')
      .select('id, from_user_id, to_user_id, amount, memo, status, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) { console.error('request history failed', error); return; }
    setSentRequests((data ?? []) as MoneyRequest[]);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    const numericAmount = Number(amount);
    if (!accountId.trim()) { setMessage('Enter the Account ID of the person to request from.'); return; }
    if (accountId.trim().toUpperCase() === currentAccountId.toUpperCase()) { setMessage('You cannot request money from yourself.'); return; }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setMessage('Enter an amount greater than zero.'); return; }

    setIsBusy(true);
    const { error } = await supabase.rpc('send_money_request', {
      p_to_account_id: accountId.trim().toUpperCase(),
      p_amount: numericAmount,
      p_memo: memo.trim(),
    });
    setIsBusy(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('not found')) setMessage('That Account ID does not belong to a registered user.');
      else if (msg.includes('yourself')) setMessage('You cannot request money from yourself.');
      else if (msg.includes('invalid amount')) setMessage('Enter a valid amount greater than zero.');
      else setMessage('Could not send the request. ' + error.message);
      setStage('error');
      return;
    }

    setStage('success');
    void loadHistory();
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="withdrawal-modal" role="dialog" aria-modal="true" aria-labelledby="request-title">
        <button className="modal-close" onClick={onClose} aria-label="Close request form">×</button>
        <div className="modal-icon"><ArrowDownLeft size={23} /></div>
        <h2 id="request-title">Request money</h2>
        <p className="modal-copy">Send a payment request to another Skrill user by their Account ID. They can approve or reject it.</p>

        {stage === 'form' && (
          <form className="withdrawal-form" onSubmit={handleSubmit}>
            <label>Account ID to request from
              <input type="text" value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                placeholder="BES000050" required />
            </label>
            <label>Amount in USD
              <input type="number" min="0.01" max="300000" step="0.01" value={amount}
                onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
            </label>
            <label>Memo / Reason (optional)
              <input type="text" value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="What's this request for?" />
            </label>
            {message && <p className="withdrawal-message" style={{ background: '#fce8e8', color: '#c92020' }} role="status">{message}</p>}
            <button className="auth-submit" type="submit" disabled={isBusy}>
              {isBusy ? 'Sending request…' : 'Submit request'}
            </button>
          </form>
        )}

        {stage === 'success' && (
          <div className="confirm-screen">
            <div className="success-icon"><CheckCircle2 size={48} /></div>
            <h3>Request sent</h3>
            <p className="modal-copy">Your request for {formatCurrency(Number(amount))} from {accountId.trim().toUpperCase()} has been sent. You'll see their response in your Activity tab.</p>
            <button className="auth-submit" onClick={() => { setStage('form'); setAccountId(''); setAmount(''); setMemo(''); }}>Send another</button>
          </div>
        )}

        {stage === 'error' && (
          <div className="confirm-screen">
            <div className="success-icon" style={{ color: '#c92020' }}><X size={48} /></div>
            <h3>Request failed</h3>
            <p className="modal-copy">{message}</p>
            <button className="auth-submit" onClick={() => { setStage('form'); setMessage(''); }}>Try again</button>
          </div>
        )}

        {sentRequests.length > 0 && stage === 'form' && (
          <div className="withdrawal-history">
            <h3>Request history</h3>
            <div className="history-list">
              {sentRequests.slice(0, 8).map((req) => (
                <div className="history-item" key={req.id}>
                  <div className="history-left">
                    <strong>{formatCurrency(req.amount)}</strong>
                    <small>{req.memo || 'No memo'} · {formatDate(req.created_at)}</small>
                  </div>
                  <div className="history-right">
                    <span className={`status-badge ${req.status}`}>{req.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
