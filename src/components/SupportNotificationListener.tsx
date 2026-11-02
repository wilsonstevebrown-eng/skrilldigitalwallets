import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { notifySupportMessage, playSupportAlert } from '@/lib/supportNotifications';

export function SupportNotificationListener({ role }: { role: 'customer' | 'admin' }) {
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const start = async () => {
      if (role === 'customer') {
        const { data: conversationId, error } = await supabase.rpc('get_or_create_my_conversation');
        if (error || !conversationId || cancelled) return;
        channel = supabase.channel(`support-notifications-customer-${conversationId}`)
          .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'support_messages',
            filter: `conversation_id=eq.${conversationId}`,
          }, (payload) => {
            const message = payload.new as { id: string; sender_role: string; body: string };
            if (message.sender_role !== 'admin') return;
            notifySupportMessage('New reply from support', message.body, `customer-${message.id}`);
            playSupportAlert();
          })
          .subscribe();
      } else {
        channel = supabase.channel('support-notifications-admin')
          .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'support_messages',
          }, (payload) => {
            const message = payload.new as { id: string; sender_role: string; body: string };
            if (message.sender_role !== 'customer') return;
            notifySupportMessage('New customer support message', message.body, `admin-${message.id}`);
            playSupportAlert();
          })
          .subscribe();
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [role]);

  return null;
}
