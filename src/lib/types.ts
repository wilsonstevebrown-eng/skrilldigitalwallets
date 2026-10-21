export type Profile = {
  display_name: string;
  account_id: string;
  balance: number;
  role: 'member' | 'admin';
  created_at?: string;
};

export type Transaction = {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  created_at: string;
};

export type WithdrawalRequest = {
  id: string;
  amount: number;
  status: 'pending' | 'under_review' | 'completed' | 'rejected';
  payment_method: WithdrawalMethod;
  destination: string;
  memo: string;
  reference: string;
  review_message: string;
  created_at: string;
};

export type TransferReceipt = {
  transfer_id: string;
  sender_name: string;
  sender_email: string;
  sender_account_id: string;
  recipient_name: string;
  recipient_email: string;
  recipient_account_id: string;
  amount: number;
  memo: string;
  reference: string;
  fee: number;
  status: 'pending' | 'completed' | 'failed';
  created_at: string;
};

export type Transfer = TransferReceipt;

export type MoneyRequest = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  memo: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  created_at: string;
  updated_at: string;
};

export type AdminUser = {
  id: string;
  display_name: string;
  email: string;
  account_id: string;
  balance: number;
  role: 'member' | 'admin';
  created_at: string;
};

export type AdminWithdrawal = {
  id: string;
  user_id: string;
  amount: number;
  status: 'pending' | 'under_review' | 'completed' | 'rejected';
  payment_method: WithdrawalMethod;
  destination: string;
  memo: string;
  reference: string;
  review_message: string;
  created_at: string;
  updated_at: string;
  display_name: string;
  email: string;
  account_id: string;
};

export type AdminTransfer = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  memo: string;
  reference: string;
  status: 'completed' | 'failed';
  created_at: string;
  from_name: string;
  from_email: string;
  from_account_id: string;
  to_name: string;
  to_email: string;
  to_account_id: string;
};

export type AdminMoneyRequest = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  memo: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  created_at: string;
  updated_at: string;
  from_name: string;
  from_email: string;
  from_account_id: string;
  to_name: string;
  to_email: string;
  to_account_id: string;
};

export type SupportConversation = {
  id: string;
  user_id: string;
  status: 'open' | 'waiting_for_customer' | 'resolved';
  assigned_admin_id: string | null;
  last_message_at: string;
  customer_unread_count: number;
  admin_unread_count: number;
  created_at: string;
  updated_at: string;
};

export type SupportMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_role: 'customer' | 'admin';
  body: string;
  read_by_recipient: boolean;
  created_at: string;
};

export type Card = {
  id: string;
  user_id: string;
  card_reference: string;
  card_number: string | null;
  last4: string | null;
  status: 'active' | 'pending' | 'unavailable';
  created_at: string;
  updated_at: string;
};

export type CardActivationRequest = {
  id: string;
  user_id: string;
  card_id: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_message: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

export type AdminCardActivation = {
  id: string;
  user_id: string;
  card_id: string;
  customer_name: string;
  customer_email: string;
  customer_account_id: string;
  card_number: string;
  last4: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_message: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type AdminSupportConversation = {
  id: string;
  user_id: string;
  customer_name: string;
  customer_account_id: string;
  customer_email: string;
  status: 'open' | 'waiting_for_customer' | 'resolved';
  assigned_admin_name: string | null;
  last_message: string | null;
  last_message_at: string;
  admin_unread_count: number;
  created_at: string;
};

export type WithdrawalMethod =
  | 'wire_transfer' | 'cryptocurrency' | 'paypal' | 'cashapp' | 'neteller'
  | 'revolut' | 'venmo' | 'zelle' | 'stripe' | 'bank_transfer';

export type WithdrawalField = {
  key: string;
  label: string;
  placeholder: string;
  type?: 'text' | 'email' | 'number';
  required?: boolean;
};

export type WithdrawalMethodConfig = {
  value: WithdrawalMethod;
  label: string;
  icon: string;
  fields: WithdrawalField[];
};

export const WITHDRAWAL_METHODS: WithdrawalMethodConfig[] = [
  {
    value: 'wire_transfer',
    label: 'Wire Transfer',
    icon: 'landmark',
    fields: [
      { key: 'account_holder', label: 'Account holder name', placeholder: 'John Doe', required: true },
      { key: 'bank_name', label: 'Bank name', placeholder: 'Bank of America', required: true },
      { key: 'account_number', label: 'Account number', placeholder: '000123456789', required: true },
      { key: 'routing_number', label: 'Routing number', placeholder: '021000021', required: true },
      { key: 'swift_bic', label: 'SWIFT/BIC code', placeholder: 'BOFAUS3N', required: true },
    ],
  },
  {
    value: 'cryptocurrency',
    label: 'Cryptocurrency',
    icon: 'bitcoin',
    fields: [
      { key: 'network', label: 'Network', placeholder: 'BTC, ETH, USDT (TRC20), etc.', required: true },
      { key: 'wallet_address', label: 'Wallet address', placeholder: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', required: true },
    ],
  },
  {
    value: 'paypal',
    label: 'PayPal',
    icon: 'wallet',
    fields: [
      { key: 'email', label: 'PayPal email', placeholder: 'you@example.com', type: 'email', required: true },
    ],
  },
  {
    value: 'cashapp',
    label: 'Cash App',
    icon: 'banknote',
    fields: [
      { key: 'cashtag', label: '$Cashtag', placeholder: '$yourcashtag', required: true },
    ],
  },
  {
    value: 'neteller',
    label: 'Neteller',
    icon: 'wallet',
    fields: [
      { key: 'email', label: 'Neteller email', placeholder: 'you@example.com', type: 'email', required: true },
    ],
  },
  {
    value: 'revolut',
    label: 'Revolut',
    icon: 'credit-card',
    fields: [
      { key: 'username', label: 'Revolut username or phone', placeholder: '@username or +1234567890', required: true },
    ],
  },
  {
    value: 'venmo',
    label: 'Venmo',
    icon: 'wallet',
    fields: [
      { key: 'handle', label: 'Venmo username, phone or email', placeholder: '@username, +1234567890, or you@example.com', required: true },
    ],
  },
  {
    value: 'zelle',
    label: 'Zelle',
    icon: 'send',
    fields: [
      { key: 'handle', label: 'Zelle phone or email', placeholder: '+1234567890 or you@example.com', required: true },
    ],
  },
  {
    value: 'stripe',
    label: 'Stripe',
    icon: 'credit-card',
    fields: [
      { key: 'account_id', label: 'Stripe account ID', placeholder: 'acct_1ABCdef234XYZ', required: true },
    ],
  },
  {
    value: 'bank_transfer',
    label: 'Bank Transfer',
    icon: 'landmark',
    fields: [
      { key: 'account_holder', label: 'Account holder name', placeholder: 'John Doe', required: true },
      { key: 'bank_name', label: 'Bank name', placeholder: 'Chase Bank', required: true },
      { key: 'account_number', label: 'Account number', placeholder: '000123456789', required: true },
      { key: 'routing_number', label: 'Routing number', placeholder: '021000021', required: true },
    ],
  },
];

// Keep backward compatibility for any code still referencing old constant
export const PAYMENT_METHODS = WITHDRAWAL_METHODS.slice(0, 4).map((m) => ({
  value: m.value, label: m.label, placeholder: m.fields[0]?.placeholder ?? '',
}));

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (isToday) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + `, ${time}`;
}

export function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getMethodLabel(value: string): string {
  return WITHDRAWAL_METHODS.find((m) => m.value === value)?.label ?? value;
}
