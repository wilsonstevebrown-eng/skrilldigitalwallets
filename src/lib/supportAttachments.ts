import { supabase } from '@/lib/supabase';
import type { SupportMessage } from '@/lib/types';

export const SUPPORT_ATTACHMENT_BUCKET = 'support-attachments';
export const MAX_SUPPORT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export type SupportMessageWithAttachment = SupportMessage & {
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_mime_type?: string | null;
  attachment_url?: string | null;
};

export function validateSupportAttachment(file: File): string | null {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type)) return 'Choose a JPG, PNG, WEBP, or PDF file.';
  if (file.size > MAX_SUPPORT_ATTACHMENT_BYTES) return 'Attachments must be 8 MB or smaller.';
  return null;
}

export async function uploadSupportAttachment(file: File, conversationId: string) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'attachment';
  const path = `${conversationId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(SUPPORT_ATTACHMENT_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function addSupportAttachmentUrls<T extends SupportMessageWithAttachment>(messages: T[]): Promise<T[]> {
  return Promise.all(messages.map(async (message) => {
    if (!message.attachment_path) return message;
    const { data } = await supabase.storage
      .from(SUPPORT_ATTACHMENT_BUCKET)
      .createSignedUrl(message.attachment_path, 60 * 60);
    return { ...message, attachment_url: data?.signedUrl ?? null };
  }));
}
