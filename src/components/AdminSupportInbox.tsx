import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, Loader2, Search, Send, UserCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDate, formatStatus, type AdminSupportConversation, type SupportMessage } from '@/lib/types';

type StatusFilter = 'all' | 'open' | 'waiting_for_customer' | 'resolved';

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'waiting_for_customer', label: 'Waiting' },
  { value: 'resolved', label: 'Resolved' },
];

export function AdminSupportInbox({ adminId }: { adminId: string }) {
  const [conversations, setConversations] = useState<AdminSupportConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingMsgs, setIsLoadingMsgs] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_list_support_conversations');
    if (rpcError) { setError('Could not load support inbox.'); setIsLoadingList(false); return; }
    setConversations((data ?? []) as unknown as AdminSupportConversation[]);
    setIsLoadingList(false);
  }, []);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  // Realtime: refresh conversation list when any conversation or message changes
  useEffect(() => {
    const channel = supabase.channel('admin-support-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, () => { void loadConversations(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, () => { void loadConversations(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadConversations]);

  const loadMessages = async (convId: string) => {
    setIsLoadingMsgs(true);
    const { data, error: msgError } = await supabase.rpc('my_support_messages', { p_conversation_id: convId });
    if (msgError) { setError('Could not load messages.'); setIsLoadingMsgs(false); return; }
    setMessages((data ?? []) as unknown as SupportMessage[]);
    setIsLoadingMsgs(false);
    void supabase.rpc('mark_conversation_read', { p_conversation_id: convId, p_as_role: 'admin' });
    void loadConversations();
  };

  // Realtime: listen for new messages in the selected conversation
  useEffect(() => {
    if (!selectedId) return;
    const channel = supabase.channel(`admin-support-msgs-${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${selectedId}` }, (payload) => {
        const newMsg = payload.new as SupportMessage;
        setMessages((prev) => prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]);
        if (newMsg.sender_role === 'customer') {
          void supabase.rpc('mark_conversation_read', { p_conversation_id: selectedId, p_as_role: 'admin' });
          void loadConversations();
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [selectedId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSelect = (convId: string) => {
    setSelectedId(convId);
    setDraft('');
    setError('');
    void loadMessages(convId);
  };

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !selectedId || isBusy) return;
    setIsBusy(true);
    const { data, error: sendError } = await supabase.rpc('send_support_message', {
      p_conversation_id: selectedId,
      p_body: trimmed,
    });
    setIsBusy(false);
    if (sendError) { setError('Could not send your reply.'); return; }
    const sent = data as SupportMessage;
    setMessages((prev) => prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]);
    setDraft('');
    setError('');
    void loadConversations();
  };

  const handleAssign = async (convId: string) => {
    const { error: assignError } = await supabase.rpc('admin_assign_conversation', { p_conversation_id: convId });
    if (assignError) { setError('Could not assign this conversation.'); return; }
    void loadConversations();
  };

  const handleStatusChange = async (convId: string, newStatus: 'open' | 'waiting_for_customer' | 'resolved') => {
    const { error: statusError } = await supabase.rpc('admin_set_conversation_status', { p_conversation_id: convId, p_status: newStatus });
    if (statusError) { setError('Could not update the status.'); return; }
    void loadConversations();
  };

  const filtered = conversations.filter((c) => {
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || c.customer_name.toLowerCase().includes(q) || c.customer_account_id.toLowerCase().includes(q) || c.customer_email.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const totalUnread = conversations.reduce((sum, c) => sum + (c.admin_unread_count || 0), 0);

  return (
    <section className="admin-section admin-support-section">
      <div className="section-heading">
        <h2><Headphones size={20} /> Support Inbox</h2>
        {totalUnread > 0 && <span className="tab-badge">{totalUnread}</span>}
      </div>

      <div className="support-inbox-layout">
        {/* Conversation list */}
        <div className="support-inbox-list">
          <div className="support-inbox-toolbar">
            <div className="support-search">
              <Search size={16} />
              <input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, ID, or email…" />
            </div>
            <div className="support-filter-row">
              {statusFilters.map((f) => (
                <button
                  key={f.value}
                  className={statusFilter === f.value ? 'support-filter-chip active' : 'support-filter-chip'}
                  onClick={() => setStatusFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="support-inbox-items">
            {isLoadingList && <div className="support-chat-empty"><Loader2 size={24} className="spin" /><p>Loading inbox…</p></div>}
            {!isLoadingList && filtered.length === 0 && <div className="support-chat-empty"><p>No conversations match your filters.</p></div>}
            {!isLoadingList && filtered.map((c) => (
              <button
                key={c.id}
                className={selectedId === c.id ? 'support-inbox-item active' : 'support-inbox-item'}
                onClick={() => handleSelect(c.id)}
              >
                <div className="support-inbox-item-top">
                  <strong>{c.customer_name}</strong>
                  {(c.admin_unread_count || 0) > 0 && <span className="support-unread-dot">{c.admin_unread_count}</span>}
                </div>
                <small>{c.customer_account_id} · {c.customer_email}</small>
                <div className="support-inbox-item-preview">
                  <span className="support-inbox-last">{c.last_message ? (c.last_message.length > 48 ? c.last_message.slice(0, 48) + '…' : c.last_message) : 'No messages yet'}</span>
                  <span className="support-inbox-time">{formatDate(c.last_message_at)}</span>
                </div>
                <div className="support-inbox-item-tags">
                  <span className={`status-badge ${c.status === 'resolved' ? 'completed' : c.status === 'waiting_for_customer' ? 'pending' : 'open'}`}>{formatStatus(c.status)}</span>
                  {c.assigned_admin_name && <span className="support-assigned-tag"><UserCheck size={12} /> {c.assigned_admin_name}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Conversation detail */}
        <div className="support-inbox-detail">
          {!selected && !isLoadingList && <div className="support-chat-empty"><Headphones size={42} /><p>Select a conversation to view and reply.</p></div>}
          {selected && (
            <>
              <div className="support-inbox-header">
                <div className="support-inbox-header-info">
                  <strong>{selected.customer_name}</strong>
                  <small>{selected.customer_account_id} · {selected.customer_email}</small>
                </div>
                <div className="support-inbox-header-actions">
                  <span className={`status-badge ${selected.status === 'resolved' ? 'completed' : selected.status === 'waiting_for_customer' ? 'pending' : 'open'}`}>{formatStatus(selected.status)}</span>
                  {selected.assigned_admin_name ? (
                    <span className="support-assigned-tag"><UserCheck size={13} /> {selected.assigned_admin_name}</span>
                  ) : (
                    <button className="admin-action-btn" onClick={() => handleAssign(selected.id)}>Assign to me</button>
                  )}
                </div>
              </div>

              <div className="support-inbox-status-row">
                <span>Set status:</span>
                <button className={selected.status === 'open' ? 'support-filter-chip active' : 'support-filter-chip'} onClick={() => handleStatusChange(selected.id, 'open')} disabled={selected.status === 'open'}>Open</button>
                <button className={selected.status === 'waiting_for_customer' ? 'support-filter-chip active' : 'support-filter-chip'} onClick={() => handleStatusChange(selected.id, 'waiting_for_customer')} disabled={selected.status === 'waiting_for_customer'}>Waiting</button>
                <button className={selected.status === 'resolved' ? 'support-filter-chip active' : 'support-filter-chip'} onClick={() => handleStatusChange(selected.id, 'resolved')} disabled={selected.status === 'resolved'}>Resolved</button>
              </div>

              <div className="support-chat-messages admin">
                {isLoadingMsgs && <div className="support-chat-empty"><Loader2 size={24} className="spin" /><p>Loading messages…</p></div>}
                {!isLoadingMsgs && messages.map((msg) => {
                  const isMine = msg.sender_role === 'admin';
                  return (
                    <div key={msg.id} className={`support-msg ${isMine ? 'mine' : 'theirs'}`}>
                      <div className="support-msg-bubble">{msg.body}</div>
                      <div className="support-msg-time">{formatDate(msg.created_at)}</div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <form className="support-chat-input-row" onSubmit={handleSend}>
                <input
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={selected.status === 'resolved' ? 'This conversation is resolved' : 'Type your reply…'}
                  disabled={isBusy || selected.status === 'resolved'}
                  required
                />
                <button type="submit" className="support-send-btn" disabled={isBusy || !draft.trim() || selected.status === 'resolved'}>
                  {isBusy ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
                </button>
              </form>
              {error && <p className="support-chat-error">{error}</p>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
