import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, FileText, Headphones, ImagePlus, Loader2, MessageCircle, Paperclip, Send, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/types';
import {
  addSupportAttachmentUrls, MAX_SUPPORT_ATTACHMENT_BYTES, SUPPORT_ATTACHMENT_ACCEPT,
  uploadSupportAttachment, validateSupportAttachment, type SupportMessageWithAttachment,
} from '@/lib/supportAttachments';
import { enableSupportNotifications } from '@/lib/supportNotifications';

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
  const [messages, setMessages] = useState<SupportMessageWithAttachment[]>([]);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadMessages = async (convId: string) => {
    const { data, error: msgError } = await supabase.rpc('my_support_messages', { p_conversation_id: convId });
    if (msgError) { setError('Could not load messages.'); setIsLoading(false); return; }
    setMessages(await addSupportAttachmentUrls((data ?? []) as unknown as SupportMessageWithAttachment[]));
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

  const markRead = (convId: string) => {
    void supabase.rpc('mark_conversation_read', { p_conversation_id: convId, p_as_role: 'customer' });
    void loadMeta(convId);
  };

  const loadConversation = useCallback(async () => {
    const { data: convId, error: convError } = await supabase.rpc('get_or_create_my_conversation');
    if (convError || !convId) {
      setError('Could not open your support conversation.');
      setIsLoading(false);
      return;
    }
    setConversationId(convId as string);
    await loadMessages(convId as string);
    markRead(convId as string);
  }, []);

  useEffect(() => {
    if (!userId) return;
    void loadConversation();
  }, [userId, loadConversation]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase.channel(`support-customer-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${conversationId}` }, async (payload) => {
        const newMsg = payload.new as SupportMessageWithAttachment;
        const [enriched] = await addSupportAttachmentUrls([newMsg]);
        setMessages((prev) => prev.some((m) => m.id === enriched.id) ? prev : [...prev, enriched]);
        if (newMsg.sender_role === 'admin') {
          markRead(conversationId);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations', filter: `id=eq.${conversationId}` }, () => {
        void loadMeta(conversationId);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if ((!trimmed && !file) || !conversationId || isBusy) return;
    setIsBusy(true);
    setError('');
    let attachmentPath: string | null = null;
    try {
      if (file) attachmentPath = await uploadSupportAttachment(file, conversationId);
      const { data, error: sendError } = await supabase.rpc('send_support_message', {
        p_conversation_id: conversationId,
        p_body: trimmed || (file ? `Attachment: ${file.name}` : ''),
        p_attachment_path: attachmentPath,
        p_attachment_name: file?.name ?? null,
        p_attachment_mime_type: file?.type ?? null,
      });
      if (sendError) throw sendError;
      const [sent] = await addSupportAttachmentUrls([data as SupportMessageWithAttachment]);
      setMessages((prev) => prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]);
      setDraft('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      void loadMeta(conversationId);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send your message. Please try again.');
    } finally {
      setIsBusy(false);
    }
  };

  const chooseFile = (selected: File | undefined) => {
    if (!selected) return;
    const validationError = validateSupportAttachment(selected);
    if (validationError) { setError(validationError); return; }
    setError('');
    setFile(selected);
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
        <button type="button" className="support-notify-btn" onClick={async () => setNotificationsEnabled(await enableSupportNotifications())}>
          <Bell size={14} /> {notificationsEnabled ? 'Notifications enabled' : 'Enable notifications'}
        </button>
      </div>
      <div className="support-chat-window">
        <div className="support-chat-messages">
          {isLoading && <div className="support-chat-empty"><Loader2 size={26} className="spin" /><p>Loading conversation…</p></div>}
          {!isLoading && messages.length === 0 && <div className="support-chat-empty"><MessageCircle size={40} /><p>No messages yet. Send a message to start chatting with support.</p></div>}
          {!isLoading && messages.map((msg) => {
            const isMine = msg.sender_role === 'customer';
            return (
              <div key={msg.id} className={`support-msg ${isMine ? 'mine' : 'theirs'}`}>
                <div className="support-msg-bubble">
                  {msg.body}
                  {msg.attachment_url && (
                    <a className="support-attachment" href={msg.attachment_url} target="_blank" rel="noreferrer">
                      {msg.attachment_mime_type?.startsWith('image/') ? <img src={msg.attachment_url} alt={msg.attachment_name || 'Support attachment'} /> : <span><FileText size={18} /> {msg.attachment_name || 'Download attachment'}</span>}
                    </a>
                  )}
                </div>
                <div className="support-msg-time">{formatDate(msg.created_at)}</div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        {meta && meta.customer_unread_count > 0 && !isLoading && <div className="support-unread-bar">{meta.customer_unread_count} unread message{meta.customer_unread_count > 1 ? 's' : ''} from support</div>}
        {file && <div className="support-file-preview"><Paperclip size={15} /> {file.name} <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span><button type="button" onClick={() => setFile(null)} aria-label="Remove attachment"><X size={15} /></button></div>}
        <form className="support-chat-input-row" onSubmit={handleSend}>
          <input ref={fileRef} type="file" accept={SUPPORT_ATTACHMENT_ACCEPT} hidden onChange={(event) => chooseFile(event.target.files?.[0])} />
          <button type="button" className="support-attach-btn" onClick={() => fileRef.current?.click()} disabled={isBusy || meta?.status === 'resolved'} aria-label="Attach a file"><ImagePlus size={19} /></button>
          <input type="text" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={meta?.status === 'resolved' ? 'This conversation is resolved' : 'Type a message to support…'} disabled={isBusy || meta?.status === 'resolved'} />
          <button type="submit" className="support-send-btn" disabled={isBusy || (!draft.trim() && !file) || meta?.status === 'resolved'}>
            {isBusy ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          </button>
        </form>
        <p className="support-upload-hint">Images or PDF · Max {MAX_SUPPORT_ATTACHMENT_BYTES / 1024 / 1024} MB</p>
        {error && <p className="support-chat-error">{error}</p>}
      </div>
    </section>
  );
}
