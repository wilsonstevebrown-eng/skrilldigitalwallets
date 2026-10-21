import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileText, Loader2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, type Transaction } from '@/lib/types';

type StatementTx = Transaction;

function toCsv(rows: StatementTx[], openBalance: number, closingBalance: number, customerName: string, periodLabel: string): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push('Skrill Bank Statement');
  lines.push(`Customer,${esc(customerName)}`);
  lines.push(`Period,${esc(periodLabel)}`);
  lines.push(`Opening Balance,${openBalance.toFixed(2)}`);
  lines.push(`Closing Balance,${closingBalance.toFixed(2)}`);
  lines.push('');
  lines.push('Date,Description,Type,Amount,Status');
  for (const tx of rows) {
    lines.push([formatDate(tx.created_at), tx.description, tx.type, tx.amount.toFixed(2), 'Completed'].map(esc).join(','));
  }
  return lines.join('\n');
}

export function BankStatements({ userId }: { userId: string }) {
  const [allTx, setAllTx] = useState<StatementTx[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const loadData = useCallback(async () => {
    const { data, error: txError } = await supabase
      .from('transactions')
      .select('id, type, amount, description, created_at')
      .order('created_at', { ascending: true });
    if (txError) { setError('Could not load transactions.'); setIsLoading(false); return; }
    setAllTx((data ?? []) as StatementTx[]);
    setIsLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    return allTx.filter((tx) => {
      const d = new Date(tx.created_at);
      if (fromDate && d < new Date(fromDate)) return false;
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
      }
      return true;
    });
  }, [allTx, fromDate, toDate]);

  const openBalance = useMemo(() => {
    if (filtered.length === 0) return 0;
    const earliest = filtered[0];
    let bal = 0;
    for (const tx of allTx) {
      if (new Date(tx.created_at) < new Date(earliest.created_at)) {
        bal += tx.type === 'credit' ? tx.amount : -tx.amount;
      }
    }
    return bal;
  }, [filtered, allTx]);

  const closingBalance = useMemo(() => {
    return filtered.reduce((sum, tx) => sum + (tx.type === 'credit' ? tx.amount : -tx.amount), openBalance);
  }, [filtered, openBalance]);

  const periodLabel = useMemo(() => {
    if (fromDate && toDate) return `${fromDate} to ${toDate}`;
    if (fromDate) return `From ${fromDate}`;
    if (toDate) return `Up to ${toDate}`;
    return 'All transactions';
  }, [fromDate, toDate]);

  const handleDownloadCsv = () => {
    const csv = toCsv(filtered, openBalance, closingBalance, 'Customer', periodLabel);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skrill-statement-${fromDate || 'all'}-${toDate || 'now'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const rows = filtered.map((tx) => `
      <tr>
        <td>${formatDate(tx.created_at)}</td>
        <td>${tx.description}</td>
        <td>${tx.type === 'credit' ? 'Credit' : 'Debit'}</td>
        <td style="text-align:right">${tx.type === 'credit' ? '+' : '-'}${formatCurrency(tx.amount)}</td>
        <td>Completed</td>
      </tr>
    `).join('');
    win.document.write(`
      <html><head><title>Skrill Bank Statement</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 32px; color: #3d2540; }
        h1 { color: #76245c; margin-bottom: 4px; }
        .meta { font-size: 12px; color: #6f6578; margin-bottom: 24px; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #76245c; color: #76245c; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
        td { padding: 7px 10px; border-bottom: 1px solid #eee8f2; }
        .summary { display: flex; gap: 24px; margin: 16px 0; }
        .summary div { font-size: 13px; }
        .summary strong { font-size: 16px; color: #76245c; }
      </style></head><body>
      <h1>Skrill Bank Statement</h1>
      <div class="meta">
        Customer: Customer<br/>
        Period: ${periodLabel}<br/>
        Currency: USD<br/>
        Opening balance: ${formatCurrency(openBalance)}<br/>
        Closing balance: ${formatCurrency(closingBalance)}<br/>
        Generated: ${new Date().toLocaleString('en-US')}
      </div>
      <table>
        <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:24px">No transactions in this period.</td></tr>'}</tbody>
      </table>
      </body></html>
    `);
    win.document.close();
    setTimeout(() => { void win.print(); }, 500);
  };

  if (isLoading) {
    return <div className="card-panel-empty"><Loader2 size={26} className="spin" /><p>Loading transactions…</p></div>;
  }

  return (
    <div className="statements-panel">
      <div className="statements-filters">
        <label>From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <div className="statements-download-row">
          <button className="statements-download-btn" onClick={handleDownloadPdf} disabled={filtered.length === 0}>
            <FileText size={16} /> Download PDF
          </button>
          <button className="statements-download-btn secondary" onClick={handleDownloadCsv} disabled={filtered.length === 0}>
            <Download size={16} /> CSV
          </button>
        </div>
      </div>

      <div className="statements-summary">
        <div><span>Opening balance</span><strong>{formatCurrency(openBalance)}</strong></div>
        <div><span>Closing balance</span><strong>{formatCurrency(closingBalance)}</strong></div>
        <div><span>Transactions</span><strong>{filtered.length}</strong></div>
      </div>

      {error && <p className="card-error-msg">{error}</p>}

      <div className="statements-table">
        {filtered.length === 0 ? (
          <div className="card-panel-empty">
            <FileText size={36} />
            <p>No transactions found for the selected period.</p>
          </div>
        ) : (
          filtered.map((tx) => (
            <div className="activity-item" key={tx.id}>
              <span className={`activity-icon ${tx.type === 'credit' ? 'green' : 'soft'}`}>
                {tx.type === 'credit' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
              </span>
              <span className="activity-copy">
                <strong>{tx.description}</strong>
                <small>{formatDate(tx.created_at)} · {tx.type === 'credit' ? 'Credit' : 'Debit'}</small>
              </span>
              <span className="activity-value">
                <strong className={tx.type === 'credit' ? 'positive' : ''}>{tx.type === 'credit' ? '+' : '-'}{formatCurrency(tx.amount)}</strong>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
