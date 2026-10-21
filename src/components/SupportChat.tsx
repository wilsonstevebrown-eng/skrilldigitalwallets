import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, Loader2, MessageCircle, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate, type SupportMessage } from '@/lib/types';

type ConversationMeta = {
  id: string;
  status: 'open' | 'waiting_for_customer' | 'resolved';
  customer_unread_count: number;
};

const statusLabel: Record<string, string> = {
  open: 'Open',
  waiting_for_customer: 'Waiting for Customer',
  resolved: 'Resolved',
};

export function SupportChat({ userId, displayName }: { userId: string; displayName: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [meta, setMeta] = useState<ConversationMeta | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversation = useCallback(async () => {
    const { data: convId, error: convError } = await supabase.rpc('get_or_create_my_conversation');
    if (convError || !convId) {
      setError('Could not open your support conversation.');
      setIsLoading(false);
      return;
    }
    setConversationId(convId as string);
    await loadMessages(convId as string);
    await markRead(convId as string);
  }, []);

  const loadMessages = async (convId: string) => {
    const { data, error: msgError } = await supabase.rpc('my_support_messages', { p_conversation_id: convId });
    if (msgError) { setError('Could not load messages.'); setIsLoading(false); return; }
    setMessages((data ?? []) as unknown as SupportMessage[]);
    setIsLoading(false);
  };

  const loadMeta = async (convId: string) => {
    const { data, error: metaError } = await supabase
      .from('support_conversations')
      .select('id, status, customer_unread_count')
      .eq('id', convId)
      .maybeSingle();
    if (metaError || !data) return;
    setMeta(data as ConversationMeta);
  };

  const markRead = async (convId: string) => {
    void supabase.rpc('mark_conversation_read', { p_conversation_id: convId, p_as_role: 'customer' });
    void loadMeta(convId);
  };

  useEffect(() => {
    if (!userId) return;
    void loadConversation();
  }, [userId, loadConversation]);

  // Realtime: listen for new messages and conversation updates
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase.channel(`support-customer-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const newMsg = payload.new as SupportMessage;
        setMessages((prev) => prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]);
        if (newMsg.sender_role === 'admin') void markRead(conversationId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations', filter: `id=eq.${conversationId}` }, () => {
        void loadMeta(conversationId);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !conversationId || isBusy) return;
    setIsBusy(true);
    const { data, error: sendError } = await supabase.rpc('send_support_message', {
      p_conversation_id: conversationId,
      p_body: trimmed,
    });
    setIsBusy(false);
    if (sendError) { setError('Could not send your message. Please try again.'); return; }
    const sent = data as SupportMessage;
    setMessages((prev) => prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]);
    setDraft('');
    setError('');
    void loadMeta(conversationId);
  };

  const statusText = meta ? statusLabel[meta.status] ?? meta.status : 'Open';

  return (
    <section className="support-chat-section">
      <div className="support-greeting">
        <Headphones size={20} />
        <h2>Hey, {displayName}, how may we help you today?</h2>
      </div>

      <div className="section-heading">
        {meta && <span className={`status-badge ${meta.status === 'resolved' ? 'completed' : meta.status === 'waiting_for_customer' ? 'pending' : 'open'}`}>{statusText}</span>}
      </div>

      <div className="support-chat-window">
        <div className="support-chat-messages" ref={scrollRef}>
          {isLoading && <div className="support-chat-empty"><Loader2 size={26} className="spin" /><p>Loading conversation…</p></div>}
          {!isLoading && messages.length === 0 && (
            <div className="support-chat-empty"><MessageCircle size={40} /><p>No messages yet. Send a message to start chatting with support.</p></div>
          )}
          {!isLoading && messages.map((msg) => {
            const isMine = msg.sender_role === 'customer';
            return (
              <div key={msg.id} className={`support-msg ${isMine ? 'mine' : 'theirs'}`}>
                <div className="support-msg-bubble">{msg.body}</div>
                <div className="support-msg-time">{formatDate(msg.created_at)}</div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {meta && meta.customer_unread_count > 0 && !isLoading && (
          <div className="support-unread-bar">{meta.customer_unread_count} unread message{meta.customer_unread_count > 1 ? 's' : ''} from support</div>
        )}

        <form className="support-chat-input-row" onSubmit={handleSend}>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={meta?.status === 'resolved' ? 'This conversation is resolved' : 'Type a message to support…'}
            disabled={isBusy || meta?.status === 'resolved'}
            required
          />
          <button type="submit" className="support-send-btn" disabled={isBusy || !draft.trim() || meta?.status === 'resolved'}>
            {isBusy ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          </button>
        </form>
        {error && <p className="support-chat-error">{error}</p>}
      </div>
    </section>
  );
}
