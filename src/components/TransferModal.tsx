import { useRef, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Loader2, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, type TransferReceipt } from '@/lib/types';

type Stage = 'form' | 'review' | 'success' | 'error';

type RecipientInfo = {
  id: string;
  display_name: string;
  account_id: string;
  email: string;
};

function newRequestKey(): string {
  return crypto.randomUUID();
}

export function TransferModal({ open, onClose, currentBalance }: { open: boolean; onClose: () => void; currentBalance: number }) {
  const [identifier, setIdentifier] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [recipient, setRecipient] = useState<RecipientInfo | null>(null);
  const [result, setResult] = useState<TransferReceipt | null>(null);
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const confirmLock = useRef(false);

  const reset = () => {
    setIdentifier(''); setAmount(''); setMemo(''); setStage('form'); setRecipient(null); setResult(null); setMessage(''); setIsBusy(false);
    setRequestKey(newRequestKey());
    confirmLock.current = false;
  };

  const handleClose = () => { reset(); onClose(); };

  const handleLookup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    const numericAmount = Number(amount);
    if (!identifier.trim()) { setMessage('Enter the recipient\'s email or Account ID.'); return; }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setMessage('Enter a transfer amount greater than zero.'); return; }
    if (numericAmount > currentBalance) { setMessage(`Insufficient balance. Your available balance is ${formatCurrency(currentBalance)}.`); return; }

    setIsBusy(true);
    const { data, error } = await supabase.rpc('lookup_transfer_recipient', { p_identifier: identifier.trim() });
    setIsBusy(false);
    if (error) { setMessage('Could not look up the recipient. Please try again.'); return; }
    const found = (data as RecipientInfo[] | null)?.[0];
    if (!found) { setMessage('No registered user found with that email or Account ID.'); return; }
    setRecipient(found);
    setStage('review');
  };

  const handleConfirm = async () => {
    if (!recipient || confirmLock.current) return;
    confirmLock.current = true;
    setIsBusy(true); setMessage('');
    const { data, error } = await supabase.rpc('process_transfer_v2', {
      p_to_identifier: identifier.trim(),
      p_amount: Number(amount),
      p_memo: memo.trim(),
      p_idempotency_key: requestKey,
    });
    setIsBusy(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('insufficient')) setMessage('Your balance is too low for this transfer. No money was moved.');
      else if (msg.includes('not found')) setMessage('Recipient could not be found. No money was moved.');
      else if (msg.includes('yourself')) setMessage('You cannot transfer money to yourself.');
      else setMessage('The transfer could not be completed: ' + error.message);
      setStage('error'); confirmLock.current = false; return;
    }

    const receipt = (data as TransferReceipt[] | null)?.[0];
    if (!receipt?.transfer_id || !receipt.reference) {
      setMessage('The transfer completed, but its receipt could not be read. Refresh Activity before retrying.');
      setStage('error'); confirmLock.current = false; return;
    }
    setResult(receipt);
    setStage('success');
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <section className="withdrawal-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
        <button className="modal-close" onClick={handleClose} aria-label="Close transfer form">×</button>
        <div className="modal-icon"><ArrowLeftRight size={23} /></div>
        <h2 id="transfer-title">Transfer money</h2>
        <p className="modal-copy">Send money instantly to another Skrill user by email or Account ID. Balances update immediately.</p>

        {stage === 'form' && (
          <form className="withdrawal-form" onSubmit={handleLookup}>
            <label>Recipient email or Account ID
              <input type="text" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="you@example.com or BES000050" required />
            </label>
            <label>Amount in USD
              <input type="number" min="0.01" max="300000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
            </label>
            <div className="balance-hint">Available balance: {formatCurrency(currentBalance)}</div>
            <label>Memo / Narration (optional)
              <input type="text" value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="What's this for?" />
            </label>
            {message && <p className="withdrawal-message error-message" role="status">{message}</p>}
            <button className="auth-submit" type="submit" disabled={isBusy}>{isBusy ? (<><Loader2 size={18} className="spin" /> Looking up recipient…</>) : 'Review transfer'}</button>
          </form>
        )}

        {stage === 'review' && recipient && (
          <div className="confirm-screen">
            <div className="confirm-recipient"><Search size={18} /><div><strong>{recipient.display_name}</strong><small>{recipient.account_id} · {recipient.email}</small></div></div>
            <div className="confirm-details">
              <div className="confirm-row"><span>Amount</span><strong>{formatCurrency(Number(amount))}</strong></div>
              <div className="confirm-row"><span>Memo</span><strong>{memo.trim() || '—'}</strong></div>
              <div className="confirm-row"><span>Transfer fee</span><strong>{formatCurrency(0)}</strong></div>
              <div className="confirm-row"><span>Your balance after</span><strong>{formatCurrency(currentBalance - Number(amount))}</strong></div>
              <div className="confirm-row"><span>Status</span><strong><span className="status-badge pending">Pending</span></strong></div>
            </div>
            {message && <p className="withdrawal-message error-message" role="status">{message}</p>}
            <div className="confirm-actions"><button className="admin-action-btn reject" onClick={() => setStage('form')} disabled={isBusy}>Back</button><button className="auth-submit" onClick={handleConfirm} disabled={isBusy}>{isBusy ? (<><Loader2 size={18} className="spin" /> Processing…</>) : 'Confirm transfer'}</button></div>
          </div>
        )}

        {stage === 'success' && result && (
          <div className="confirm-screen">
            <div className="success-icon"><CheckCircle2 size={48} /></div><h3>Transfer successful</h3>
            <div className="confirm-details">
              <div className="confirm-row"><span>Reference</span><strong>{result.reference}</strong></div>
              <div className="confirm-row"><span>Sender</span><strong>{result.sender_name} · {result.sender_account_id}</strong></div>
              <div className="confirm-row"><span>Recipient</span><strong>{result.recipient_name} · {result.recipient_account_id}</strong></div>
              <div className="confirm-row"><span>Recipient email</span><strong>{result.recipient_email}</strong></div>
              <div className="confirm-row"><span>Amount</span><strong>{formatCurrency(result.amount)}</strong></div>
              <div className="confirm-row"><span>Memo</span><strong>{result.memo || '—'}</strong></div>
              <div className="confirm-row"><span>Transfer fee</span><strong>{formatCurrency(result.fee)}</strong></div>
              <div className="confirm-row"><span>Date and time</span><strong>{new Date(result.created_at).toLocaleString()}</strong></div>
              <div className="confirm-row"><span>Status</span><strong><span className="status-badge completed">{result.status === 'completed' ? 'Successful' : result.status}</span></strong></div>
            </div>
            <button className="auth-submit" onClick={handleClose}>Done</button>
          </div>
        )}

        {stage === 'error' && (
          <div className="confirm-screen"><div className="success-icon error-icon"><X size={48} /></div><h3>Transfer failed</h3><p className="modal-copy">{message}</p><p className="review-notice">No money was deducted from your account.</p><div className="confirm-actions"><button className="admin-action-btn reject" onClick={handleClose}>Close</button><button className="auth-submit" onClick={() => { setStage('form'); setMessage(''); confirmLock.current = false; }}>Try again</button></div></div>
        )}
      </section>
    </div>
  );
}
