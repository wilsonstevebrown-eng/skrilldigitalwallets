import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, WalletCards, AlertCircle, CheckCircle2, Lock, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate, type Card, type CardActivationRequest } from '@/lib/types';

type ActivationStatus = 'not_activated' | 'pending' | 'approved' | 'rejected';

export function CardPanel({ userId, displayName }: { userId: string; displayName: string }) {
  const [card, setCard] = useState<Card | null>(null);
  const [activation, setActivation] = useState<CardActivationRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmMsg, setConfirmMsg] = useState('');

  const loadData = useCallback(async () => {
    const { data: cardData, error: cardError } = await supabase
      .from('cards')
      .select('id, user_id, card_reference, card_number, last4, status, created_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (cardError) { setError('Could not load your card.'); setIsLoading(false); return; }
    setCard(cardData as Card | null);

    const { data: actData, error: actError } = await supabase
      .from('card_activation_requests')
      .select('id, user_id, card_id, status, admin_message, created_at, updated_at, reviewed_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (actError) { console.error('activation load failed', actError); }
    else setActivation(actData as CardActivationRequest | null);

    setIsLoading(false);
  }, [userId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleActivate = async () => {
    setIsSubmitting(true);
    setError('');
    setConfirmMsg('');
    const { data, error: reqError } = await supabase.rpc('request_card_activation');
    setIsSubmitting(false);
    if (reqError) { setError('Could not submit your activation request. Please try again.'); return; }
    setActivation(data as CardActivationRequest);
    setConfirmMsg('Your activation request has been submitted. An administrator will review it shortly.');
    void loadData();
  };

  const activationStatus: ActivationStatus = activation
    ? activation.status
    : 'not_activated';

  const statusConfig: Record<ActivationStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    not_activated: { label: 'Not Activated', cls: 'card-status-pending', Icon: Lock },
    pending: { label: 'Pending Approval', cls: 'card-status-pending', Icon: Loader2 },
    approved: { label: 'Approved', cls: 'card-status-active', Icon: CheckCircle2 },
    rejected: { label: 'Rejected', cls: 'card-status-unavailable', Icon: AlertCircle },
  };

  if (isLoading) {
    return (
      <div className="card-panel-empty">
        <Loader2 size={28} className="spin" />
        <p>Loading your card…</p>
      </div>
    );
  }

  if (error && !card) {
    return (
      <div className="card-panel-empty">
        <AlertCircle size={32} />
        <p>{error}</p>
        <button className="card-retry-btn" onClick={() => { setError(''); setIsLoading(true); void loadData(); }}>
          <RefreshCw size={15} /> Try again
        </button>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="card-panel-empty">
        <WalletCards size={40} />
        <p>No card found. Please contact support to provision your card.</p>
      </div>
    );
  }

  const status = statusConfig[activationStatus];
  const StatusIcon = status.Icon;
  const cardIsActive = card.status === 'active' && activationStatus === 'approved';
  const previewNumber = card.card_number ?? card.card_reference;

  return (
    <div className="card-panel">
      <div className={`virtual-card ${cardIsActive ? 'active' : 'pending'}`}>
        <div className="vc-top">
          <div className="vc-brand">Skrill</div>
          <div className="vc-chip" />
        </div>
        <div className="vc-number">{previewNumber}</div>
        <div className="vc-bottom">
          <div className="vc-holder">
            <span className="vc-label">Cardholder</span>
            <strong>{displayName}</strong>
          </div>
          <div className="vc-cvv-area">
            <span className="vc-label">CVV</span>
            <div className="vc-cvv-locked"><Lock size={12} /> Locked</div>
          </div>
        </div>
        <div className="vc-status-badge">
          <StatusIcon size={14} className={activationStatus === 'pending' ? 'spin' : ''} />
          <span>{status.label}</span>
        </div>
      </div>

      <div className="card-preview-label">
        <AlertCircle size={14} />
        <span>This is a preview card with a test number. Real card details and CVV will only be revealed after a legitimate card issuer issues the card and authorization checks pass.</span>
      </div>

      <div className="card-details">
        <div className="card-detail-row"><span>Card number</span><strong>{previewNumber}</strong></div>
        <div className="card-detail-row"><span>Status</span><strong className={status.cls}>{status.label}</strong></div>
        <div className="card-detail-row"><span>Cardholder</span><strong>{displayName}</strong></div>
        <div className="card-detail-row"><span>Issued</span><strong>{formatDate(card.created_at)}</strong></div>
      </div>

      {activationStatus === 'not_activated' && (
        <button className="card-activate-btn" onClick={handleActivate} disabled={isSubmitting}>
          {isSubmitting ? <><Loader2 size={16} className="spin" /> Submitting…</> : <><Send size={16} /> Activate Card</>}
        </button>
      )}

      {activationStatus === 'pending' && (
        <div className="card-pending-notice">
          <Loader2 size={18} className="spin" />
          <div>
            <strong>Activation request submitted.</strong>
            <p>Your request is pending administrator approval. You will be notified once it is reviewed.</p>
          </div>
        </div>
      )}

      {activationStatus === 'approved' && (
        <div className="card-pending-notice approved">
          <CheckCircle2 size={18} />
          <div>
            <strong>Card approved.</strong>
            <p>Your card has been approved by an administrator. A card-issuing provider must still issue the physical/virtual card before real card details and CVV are available.</p>
          </div>
        </div>
      )}

      {activationStatus === 'rejected' && (
        <div className="card-pending-notice unavailable">
          <AlertCircle size={18} />
          <div>
            <strong>Activation request rejected.</strong>
            {activation?.admin_message && <p>Reason: {activation.admin_message}</p>}
            <p>You may submit a new activation request.</p>
          </div>
        </div>
      )}

      {activationStatus === 'rejected' && (
        <button className="card-activate-btn" onClick={handleActivate} disabled={isSubmitting}>
          {isSubmitting ? <><Loader2 size={16} className="spin" /> Submitting…</> : <><Send size={16} /> Request Activation Again</>}
        </button>
      )}

      {confirmMsg && <p className="card-confirm-msg">{confirmMsg}</p>}
      {error && <p className="card-error-msg">{error}</p>}
    </div>
  );
}
