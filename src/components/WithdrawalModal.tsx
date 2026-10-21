import { useEffect, useState } from 'react';
import { ArrowDownLeft, Banknote, CheckCircle2, Clock, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { WITHDRAWAL_METHODS, formatCurrency, formatDate, getMethodLabel, type WithdrawalMethod, type WithdrawalRequest } from '@/lib/types';

type Stage = 'form' | 'confirm' | 'success';

type FieldValues = Record<string, string>;

export function WithdrawalModal({ open, onClose, currentBalance }: { open: boolean; onClose: () => void; currentBalance: number }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<WithdrawalMethod>('bank_transfer');
  const [fieldValues, setFieldValues] = useState<FieldValues>({});
  const [memo, setMemo] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [history, setHistory] = useState<WithdrawalRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [resultRef, setResultRef] = useState('');

  useEffect(() => {
    if (!open) return;
    setAmount(''); setMethod('bank_transfer'); setFieldValues({}); setMemo(''); setStage('form'); setMessage(''); setResultRef('');
    void loadHistory();
  }, [open]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from('withdrawal_requests')
      .select('id, amount, status, payment_method, destination, memo, reference, review_message, created_at')
      .order('created_at', { ascending: false });
    setHistoryLoading(false);
    if (error) { console.error('withdrawal history failed', error); return; }
    setHistory((data ?? []) as WithdrawalRequest[]);
  };

  const activeMethod = WITHDRAWAL_METHODS.find((m) => m.value === method) ?? WITHDRAWAL_METHODS[0];

  const buildDestinationString = (): string => {
    return activeMethod.fields
      .map((f) => `${f.label}: ${fieldValues[f.key] || ''}`.trim())
      .filter((s) => s.split(': ').slice(1).join(': ').trim().length > 0)
      .join(' | ');
  };

  const validateFields = (): boolean => {
    for (const field of activeMethod.fields) {
      if (field.required && !(fieldValues[field.key] ?? '').trim()) {
        setMessage(`Please fill in the ${field.label}.`);
        return false;
      }
    }
    return true;
  };

  const handleReview = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setMessage('Enter a withdrawal amount greater than zero.'); return; }
    if (numericAmount > 300000) { setMessage('Maximum withdrawal amount is $300,000.'); return; }
    if (!validateFields()) return;
    setStage('confirm');
  };

  const handleSubmit = async () => {
    setIsBusy(true);
    setMessage('');
    const destination = buildDestinationString();
    const { data, error } = await supabase
      .from('withdrawal_requests')
      .insert({ amount: Number(amount), payment_method: method, destination, memo: memo.trim() })
      .select('reference')
      .maybeSingle();
    setIsBusy(false);

    if (error) {
      setMessage('Could not save your withdrawal request. Please try again.');
      setStage('form');
      return;
    }

    setResultRef(data?.reference ?? '');
    setStage('success');
    void loadHistory();
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setStage('form'); onClose(); } }}>
      <section className="withdrawal-modal" role="dialog" aria-modal="true" aria-labelledby="withdrawal-title">
        <button className="modal-close" onClick={() => { setStage('form'); onClose(); }} aria-label="Close withdrawal form">×</button>
        <div className="modal-icon"><ArrowDownLeft size={23} /></div>
        <h2 id="withdrawal-title">Request a withdrawal</h2>
        <p className="modal-copy">Submit your request for support review. Your request is saved as pending immediately.</p>

        {stage === 'form' && (
          <form className="withdrawal-form" onSubmit={handleReview}>
            <label>Amount in USD
              <input type="number" min="0.01" max="300000" step="0.01" value={amount}
                onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required />
            </label>

            <div className="method-group">
              <span className="method-label">Withdrawal method</span>
              <div className="method-options method-options-grid">
                {WITHDRAWAL_METHODS.map((m) => (
                  <button type="button" key={m.value}
                    className={method === m.value ? 'method-chip active' : 'method-chip'}
                    onClick={() => { setMethod(m.value); setFieldValues({}); }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {activeMethod.fields.map((field) => (
              <label key={field.key}>{field.label}
                <input
                  type={field.type ?? 'text'}
                  value={fieldValues[field.key] ?? ''}
                  onChange={(event) => setFieldValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                  required={field.required}
                />
              </label>
            ))}

            <label>Memo / Narration (optional)
              <input type="text" value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="Optional note for this withdrawal" />
            </label>

            {message && <p className="withdrawal-message" style={{ background: '#fce8e8', color: '#c92020' }} role="status">{message}</p>}

            <button className="auth-submit" type="submit">
              Review withdrawal
            </button>
          </form>
        )}

        {stage === 'confirm' && (
          <div className="confirm-screen">
            <div className="confirm-recipient">
              <Banknote size={18} />
              <div>
                <strong>{getMethodLabel(method)}</strong>
                <small>{formatCurrency(Number(amount))}</small>
              </div>
            </div>
            <div className="confirm-details">
              <div className="confirm-row"><span>Amount</span><strong>{formatCurrency(Number(amount))}</strong></div>
              {activeMethod.fields.map((f) => (
                <div className="confirm-row" key={f.key}>
                  <span>{f.label}</span>
                  <strong>{fieldValues[f.key] || '—'}</strong>
                </div>
              ))}
              <div className="confirm-row"><span>Memo</span><strong>{memo.trim() || '—'}</strong></div>
            </div>
            {message && <p className="withdrawal-message" style={{ background: '#fce8e8', color: '#c92020' }} role="status">{message}</p>}
            <div className="confirm-actions">
              <button className="admin-action-btn reject" onClick={() => setStage('form')}>Back</button>
              <button className="auth-submit" onClick={handleSubmit} disabled={isBusy}>
                {isBusy ? 'Submitting…' : 'Submit withdrawal'}
              </button>
            </div>
          </div>
        )}

        {stage === 'success' && (
          <div className="confirm-screen">
            <div className="success-icon"><Clock size={48} /></div>
            <h3>Withdrawal Request Pending</h3>
            <p className="review-notice">
              Your withdrawal request has been saved as pending. Please contact customer support for information about any applicable processing fees and the requirements for completing your withdrawal.
            </p>
            <div className="confirm-details">
              <div className="confirm-row"><span>Reference</span><strong>{resultRef || 'WDR-XXXXXXXX'}</strong></div>
              <div className="confirm-row"><span>Amount</span><strong>{formatCurrency(Number(amount))}</strong></div>
              <div className="confirm-row"><span>Method</span><strong>{getMethodLabel(method)}</strong></div>
              <div className="confirm-row"><span>Status</span><strong><span className="status-badge pending">Pending</span></strong></div>
              <div className="confirm-row"><span>Date</span><strong>{new Date().toLocaleString()}</strong></div>
            </div>
            <button className="auth-submit" onClick={() => { setStage('form'); setAmount(''); setFieldValues({}); setMemo(''); onClose(); }}>OK</button>
          </div>
        )}

        {history.length > 0 && stage === 'form' && (
          <div className="withdrawal-history">
            <h3>Withdrawal history</h3>
            <div className="history-list">
              {history.map((item) => (
                <div className="history-item" key={item.id}>
                  <div className="history-left">
                    <strong>{formatCurrency(item.amount)}</strong>
                    <small>{getMethodLabel(item.payment_method)} · {item.reference} · {formatDate(item.created_at)}</small>
                  </div>
                  <div className="history-right">
                    <span className={`status-badge ${item.status}`}>{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {historyLoading && history.length === 0 && stage === 'form' && <p className="modal-copy">Loading history…</p>}
      </section>
    </div>
  );
}
