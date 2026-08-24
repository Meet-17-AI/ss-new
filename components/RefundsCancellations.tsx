import React, { useState, useEffect, useCallback } from 'react';
import { Search, Download, Loader } from 'lucide-react';
import * as XLSX from 'xlsx'
import { cleanTherapyTypeName } from './Appointments';
// One implementation, shared with the client profile's Wallet tab. This form
// moves money, and a second copy of it would eventually drift from this one.
import { WalletAdjustModal } from './WalletAdjustModal';

// Render the face-value timestamp directly. The DB stores IST time but it arrives as a UTC string.
// By formatting it as UTC, we prevent the browser from adding another +5:30 shift to it.
const formatISTDateTime = (value?: string | null): string => {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'UTC',
  }) + ' IST';
};

// Extract therapist name from session_name (e.g., "Individual Therapy with Muskan Negi" => "Muskan Negi")
const extractTherapistName = (sessionName: string): string | null => {
  const match = sessionName.match(/\bwith\s+(.+?)(?:\s*\(|$)/i);
  return match ? match[1].trim() : null;
};

// Format session timings to "Day, Date - Time" format (e.g., "Tue, 28/07/2026 - 11:00AM")
const formatSessionDateTime = (sessionTimings: string): string => {
  if (!sessionTimings || sessionTimings === 'N/A') return sessionTimings || 'N/A';

  // session_timings comes from the database as a pre-formatted string like:
  // "Monday, Jul 29, 2026 at 11:00 AM - 11:50 AM IST"
  // We need to convert it to: "(Mon), 29/07/2026 - 11:00AM"

  try {
    // Extract the date and time parts from the database format
    const match = sessionTimings.match(/(\w+),\s+(\w+)\s+(\d+),\s+(\d+)\s+at\s+(\d+):(\d+)\s+(AM|PM)/i);
    if (!match) return sessionTimings;

    const [, dayName, monthName, dayStr, yearStr, hourStr, minStr, ampm] = match;

    // Convert month name to number
    const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                     Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const monthNum = months[monthName as keyof typeof months];

    // Shorten day name to 3 letters
    const dayShort = dayName.substring(0, 3);

    // Format time without minutes if they are :00
    const timeStr = minStr === '00' ? `${hourStr}:${minStr}${ampm}` : `${hourStr}:${minStr}${ampm}`;

    return `(${dayShort}), ${dayStr}/${monthNum}/${yearStr} - ${timeStr}`;
  } catch {
    return sessionTimings;
  }
};

// An expired payment link is stored as booking_status='cancelled' + payment_status='Failed'
// by startPaymentLinkExpiryCron. That pair is only ever written by the expiry cron, so it
// reliably distinguishes an expired link from a genuinely cancelled booking.
const isExpiredPaymentLink = (p: { booking_status?: string; payment_status?: string }): boolean => {
  const bs = (p.booking_status || '').toLowerCase();
  return ['cancelled', 'canceled'].includes(bs) && (p.payment_status || '') === 'Failed';
};

// A real cancellation: cancelled, but not merely an expired payment link.
const isCancelledBooking = (p: { booking_status?: string; payment_status?: string }): boolean => {
  const bs = (p.booking_status || '').toLowerCase();
  return ['cancelled', 'canceled'].includes(bs) && !isExpiredPaymentLink(p);
};

interface Refund {
  client_name: string;
  session_name: string;
  session_timings: string;
  refund_status: string;
  invitee_phone: string;
  invitee_email: string;
  refund_amount: number;
  payment_gateway: string;
  refund_id?: string;
  refund_initiated_at?: string;
  therapist_name?: string;
  razorpay_order_id?: string;
  payment_id?: string;
  payment_amount?: number;
  payment_status?: string;
  booking_status?: string;
  created_at?: string;
  booking_updated_at?: string;
  cancelled_at?: string;
}

// Refund status as stored by the DB is a lowercase verb ('initiated'), not the
// title-case values the badge used to compare against — so every real status
// fell through to the red "error" style. Map each known state explicitly.
const REFUND_STATUS_STYLES: Record<string, { label: string; className: string }> = {
  initiated: { label: 'Initiated', className: 'bg-yellow-100 text-yellow-700' },
  pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-700' },
  processed: { label: 'Processed', className: 'bg-green-100 text-green-700' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-700' },
  refunded: { label: 'Refunded', className: 'bg-green-100 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
};

interface Payment {
  client_name: string;
  session_name: string;
  session_timings: string;
  payment_status: string;
  invitee_phone: string;
  invitee_email: string;
  payment_amount: number;
  booking_id?: string;
  razorpay_order_id?: string;
  payment_id?: string;
  created_at?: string;
  booking_updated_at?: string;
  booking_joining_link?: string;
  payment_mode?: string;
  utr?: string;
  failure_reason?: string;
  refund_id?: string;
  refund_initiated_at?: string;
  refund_status?: string;
  refund_amount?: number;
  booking_status?: string;
  therapist_name?: string;
}

// A client holding wallet credit — money we owe them, not revenue.
interface WalletRow {
  client_key: string;
  client_name?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
  currency?: string | null;
  balance: number | string;
  last_activity_at?: string | null;
}

interface WalletTxn {
  txn_id: number;
  direction: 'CREDIT' | 'DEBIT';
  reason: string;
  amount: number | string;
  balance_after: number | string;
  source_booking_id?: string | null;
  source_payment_mode?: string | null;
  notes?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

// Ledger reasons are stored as enum-ish constants; render them as English.
const WALLET_REASON_LABELS: Record<string, string> = {
  CANCELLATION_CREDIT: 'Cancelled session',
  BOOKING_SETTLEMENT: 'Applied to booking',
  REFUND_OUT: 'Paid back to client',
  MANUAL_ADJUSTMENT: 'Manual adjustment',
};

/**
 * How a Cash/QR cancellation is shown once the admin has said what happens to
 * the money. Keyed on bookings.cancellation_action; an absent key means the
 * cancellation predates this and renders as plain "Cancelled".
 */
export const CANCELLATION_ACTION_STYLES: Record<string, { label: string; className: string }> = {
  no_refund: { label: 'No Refund', className: 'bg-gray-200 text-gray-700' },
  wallet_credit: { label: 'Added to Wallet', className: 'bg-amber-100 text-amber-800' },
  offline_refund: { label: 'Offline Refund', className: 'bg-red-100 text-red-700' },
};

const formatMoney = (v: number | string | null | undefined): string =>
  `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const RefundsCancellations: React.FC<{ initialTab?: string }> = ({ initialTab }) => {
  const [activeTab, setActiveTab] = useState(initialTab || 'all_payments');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // ── Wallets tab ──
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [totalLiability, setTotalLiability] = useState(0);
  const [selectedWallet, setSelectedWallet] = useState<WalletRow | null>(null);
  const [statement, setStatement] = useState<WalletTxn[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<WalletRow | null>(null);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, dateFrom, dateTo]);

  const tabs = [
    { id: 'all_payments', label: 'All Payments' },
    { id: 'pending', label: 'Pending' },
    { id: 'completed', label: 'Paid' },
    { id: 'expired', label: 'Failed/Expired' },
    { id: 'all', label: 'Cancellation' },
    { id: 'Pending', label: 'Refund Initiated' },
    { id: 'Failed', label: 'Refund Failed' },
    { id: 'wallets', label: 'Wallets' },
  ];

  const fetchPayments = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/payments?status=${activeTab}`);
      if (!response.ok) {
        console.error('Payment fetch failed:', response.status);
        setPayments([]);
        return;
      }
      const data = await response.json();
      setPayments(Array.isArray(data) ? data : []);
      setRefunds([]);
    } catch (error) {
      console.error('Error fetching payments:', error);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  const fetchRefunds = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/refunds?status=${activeTab}`);
      if (!response.ok) {
        console.error('Refund fetch failed:', response.status);
        setRefunds([]);
        return;
      }
      const data = await response.json();
      setRefunds(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching refunds:', error);
      setRefunds([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  const fetchWallets = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/wallets?minBalance=0.01');
      if (!response.ok) {
        console.error('Wallets fetch failed:', response.status);
        setWallets([]);
        setTotalLiability(0);
        return;
      }
      const data = await response.json();
      setWallets(Array.isArray(data?.wallets) ? data.wallets : []);
      setTotalLiability(Number(data?.totalLiability) || 0);
      setPayments([]);
      setRefunds([]);
    } catch (error) {
      console.error('Error fetching wallets:', error);
      setWallets([]);
      setTotalLiability(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch payments for payment tabs
    if (['all_payments', 'completed', 'pending', 'expired'].includes(activeTab)) {
      fetchPayments();
    }
    // Fetch refunds for cancellation tabs
    else if (['all', 'Pending', 'Failed'].includes(activeTab)) {
      fetchRefunds();
    }
    else if (activeTab === 'wallets') {
      fetchWallets();
    }
  }, [activeTab, fetchPayments, fetchRefunds, fetchWallets]);

  const isWalletTab = activeTab === 'wallets';
  // NOTE: the wallets tab renders its own table, so isPaymentTab stays false for
  // it and every existing payment/refund branch below is untouched.
  const isPaymentTab = ['all_payments', 'completed', 'pending', 'expired'].includes(activeTab);
  const safeRefunds = Array.isArray(refunds) ? refunds : [];
  const safePayments = Array.isArray(payments) ? payments : [];

  // Search across name, contact, payment id and order id (#10)
  const matchesPaymentSearch = (payment: Payment) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return [
      payment.client_name,
      payment.invitee_phone,
      payment.invitee_email,
      payment.payment_id,
      payment.razorpay_order_id,
      payment.booking_id,
      payment.session_name,
    ].some(v => {
      try {
        return (v || '').toString().toLowerCase().includes(q);
      } catch {
        return false;
      }
    });
  };

  // Optional date-range filter on payment/booking creation date (#10)
  // Defensive: if no date filters active, allow all. If date is missing, allow it (don't crash).
  const matchesDateRange = (payment: Payment) => {
    if (!dateFrom && !dateTo) return true; // no filters → allow all
    const dateStr = payment.created_at || payment.booking_updated_at;
    if (!dateStr) return true; // no date field → allow (don't reject)
    try {
      const t = new Date(dateStr).getTime();
      if (isNaN(t)) return true; // invalid date → allow (don't crash)
      if (dateFrom && t < new Date(dateFrom + 'T00:00:00').getTime()) return false;
      if (dateTo && t > new Date(dateTo + 'T23:59:59').getTime()) return false;
      return true;
    } catch {
      return true; // any error → allow, don't crash
    }
  };

  const filteredRefunds = !isPaymentTab
    ? safeRefunds.filter(refund =>
        (refund.client_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (refund.invitee_phone || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (refund.invitee_email || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const filteredPayments = isPaymentTab
    ? safePayments.filter(p => {
        // Cancelled bookings belong on the Cancellation/Refund tabs, not the payment tabs —
        // except expired payment links. The expiry cron marks those cancelled + Failed, so
        // that pair means "payment link expired", not "someone cancelled a real booking".
        // Excluding them hid every expired payment from the Failed/Expired tab.
        return matchesPaymentSearch(p) && matchesDateRange(p) && !isCancelledBooking(p);
      })
    : [];

  const filteredWallets = isWalletTab
    ? wallets.filter(w => {
        const q = searchQuery.toLowerCase().trim();
        if (!q) return true;
        return [w.client_name, w.client_phone, w.client_email]
          .some(v => (v || '').toString().toLowerCase().includes(q));
      })
    : [];

  const rowCount = isWalletTab
    ? filteredWallets.length
    : (isPaymentTab ? filteredPayments.length : filteredRefunds.length);
  const totalPages = Math.max(1, Math.ceil(rowCount / itemsPerPage));
  const paginatedPayments = filteredPayments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const paginatedRefunds = filteredRefunds.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const paginatedWallets = filteredWallets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const openStatement = async (wallet: WalletRow) => {
    setSelectedWallet(wallet);
    setStatement([]);
    setStatementLoading(true);
    try {
      const params = new URLSearchParams({ clientKey: wallet.client_key, limit: '100' });
      const res = await fetch(`/api/wallet/transactions?${params.toString()}`);
      const data = await res.json();
      setStatement(Array.isArray(data?.transactions) ? data.transactions : []);
    } catch (err) {
      console.error('Error fetching wallet statement:', err);
    } finally {
      setStatementLoading(false);
    }
  };

  const exportToCSV = () => {
    if (isWalletTab) {
      const headers = ['Client Name', 'Phone', 'Email', 'Balance', 'Last Activity'];
      const rows = filteredWallets.map(w => [
        w.client_name || '',
        w.client_phone || '',
        w.client_email || '',
        Number(w.balance || 0),
        formatISTDateTime(w.last_activity_at),
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Wallets')
      XLSX.writeFile(wb, `wallet_balances_${new Date().toISOString().split('T')[0]}.xlsx`)
      return;
    }
    if (isPaymentTab) {
      const headers = ['Client Name', 'Contact', 'Therapy Type', 'Date & Time', 'Amount', 'Payment Status'];
      const rows = filteredPayments.map(payment => [
        payment.client_name,
        payment.invitee_phone || payment.invitee_email,
        cleanTherapyTypeName(payment.session_name || ''),
        formatSessionDateTime(payment.session_timings || ''),
        payment.payment_amount,
        payment.payment_status
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Payments')
      XLSX.writeFile(wb, `payments_export_${new Date().toISOString().split('T')[0]}.xlsx`)
    } else {
      const headers = ['Client Name', 'Contact', 'Therapy Type', 'Date & Time', 'Order ID', 'Payment Gateway', 'Amount', 'Refund Status'];
      const rows = filteredRefunds.map(refund => [
        refund.client_name,
        refund.invitee_phone || refund.invitee_email,
        cleanTherapyTypeName(refund.session_name || ''),
        formatSessionDateTime(refund.session_timings || ''),
        refund.razorpay_order_id || '',
        refund.payment_gateway || '',
        refund.payment_amount ?? '',
        refund.refund_status || 'Not initiated'
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Refunds')
      XLSX.writeFile(wb, `refunds_export_${new Date().toISOString().split('T')[0]}.xlsx`)
    }
  };

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">Payments</h1>
        </div>
        <div className="flex gap-4 items-center flex-wrap justify-end">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search name, phone, email, payment/order ID..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          {isPaymentTab && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                title="From date"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                title="To date"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); setCurrentPage(1); }}
                  className="text-sm text-gray-500 hover:text-gray-700 underline whitespace-nowrap"
                >
                  Clear
                </button>
              )}
            </div>
          )}
          <button
            onClick={exportToCSV}
            className="bg-teal-700 text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-teal-800 whitespace-nowrap text-sm"
          >
            <Download size={16} />
            Export Excel
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`pb-2 font-medium ${
              activeTab === tab.id
                ? 'text-teal-700 border-b-2 border-teal-700'
                : 'text-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Razorpay Info Message - Only show in Refund Initiated tab */}
      {activeTab === 'Pending' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> Razorpay does not confirm when a refund is completed. It only shows whether the refund was initiated or failed.
            For completed refunds, the funds will appear in the customer's account within 7-10 business days.
          </p>
        </div>
      )}

      {/* Outstanding wallet liability. This is money collected for sessions that
          were cancelled and not refunded — a liability, not revenue. */}
      {isWalletTab && !loading && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Total Outstanding</p>
            <p className="text-2xl font-bold text-teal-800">{formatMoney(totalLiability)}</p>
            <p className="text-xs text-gray-500 mt-1">Held on behalf of clients</p>
          </div>
          <div className="bg-white rounded-lg border p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Clients with Credit</p>
            <p className="text-2xl font-bold text-teal-800">{wallets.length}</p>
            <p className="text-xs text-gray-500 mt-1">Redeemable on their next booking</p>
          </div>
          <div className="bg-amber-50 rounded-lg border border-amber-200 p-5">
            <p className="text-xs uppercase tracking-wider text-amber-700 mb-1">How this works</p>
            <p className="text-sm text-amber-900 leading-snug">
              Cash/QR bookings cancelled from the dashboard are not refunded — the amount is held here
              and applied to the client's next session.
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border flex-1 flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader className="animate-spin text-teal-600" size={32} />
          </div>
        ) : isWalletTab ? (
        <div className="overflow-x-auto flex-1">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Client Details</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Balance</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Last Activity</th>
                <th className="px-6 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {paginatedWallets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-gray-400 py-8">
                    {searchQuery ? 'No clients match your search' : 'No clients are holding wallet credit'}
                  </td>
                </tr>
              ) : (
                paginatedWallets.map((w) => (
                  <tr key={w.client_key} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{w.client_name || 'Unknown client'}</div>
                      <div className="text-xs text-gray-500">{w.client_phone || w.client_email || '—'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-700">
                        {formatMoney(w.balance)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{formatISTDateTime(w.last_activity_at)}</td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => openStatement(w)}
                        className="text-sm text-teal-700 hover:text-teal-900 underline mr-4"
                      >
                        Statement
                      </button>
                      <button
                        onClick={() => setAdjustTarget(w)}
                        className="text-sm text-gray-600 hover:text-gray-900 underline"
                      >
                        Adjust
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        ) : (
        <div className="overflow-x-auto flex-1">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Client Details</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">{isPaymentTab ? 'Therapy Type' : 'Cancelled Session'}</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Date & Time</th>
                {isPaymentTab && <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Amount</th>}
                {!isPaymentTab && <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Payment Gateway</th>}
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">{isPaymentTab ? 'Payment Status' : 'Refund Status'}</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {isPaymentTab ? (
                filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-gray-400 py-8">
                      No payments found
                    </td>
                  </tr>
                ) : (
                  paginatedPayments.map((payment, index) => (
                    <tr 
                      key={index} 
                      className="border-b hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedPayment(payment)}
                    >
                      <td className="px-6 py-4">
                        <div>{payment.client_name}</div>
                        <div className="text-xs text-gray-500">{payment.invitee_phone || payment.invitee_email}</div>
                      </td>
                      <td className="px-6 py-4">{cleanTherapyTypeName(payment.session_name || '')}</td>
                      <td className="px-6 py-4">{formatSessionDateTime(payment.session_timings || '')}</td>
                      <td className="px-6 py-4">₹{Number(payment.payment_amount || 0).toLocaleString()}</td>
                      <td className="px-6 py-4">
                        {(() => {
                          const rs = (payment.refund_status || '').toLowerCase();
                          const bs = ((payment as any).booking_status || '').toLowerCase();
                          const isRefunded = ['processed', 'refunded', 'completed'].includes(rs);
                          if (isRefunded) {
                            return <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Refunded</span>;
                          }
                          // Payment link ran past its 30-minute window — show that, not "Cancelled"
                          if (isExpiredPaymentLink(payment)) {
                            return (
                              <span className="px-3 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                                Expired
                              </span>
                            );
                          }
                          // If the booking itself was cancelled, show what the
                          // admin decided about the money where that was recorded.
                          // Cancellations made before this existed carry no action
                          // and keep reading as plain "Cancelled".
                          if (['cancelled', 'canceled'].includes(bs)) {
                            const style = CANCELLATION_ACTION_STYLES[(payment as any).cancellation_action];
                            return (
                              <span className={`px-3 py-1 rounded-full text-xs font-medium ${style ? style.className : 'bg-gray-200 text-gray-700'}`}>
                                {style ? style.label : 'Cancelled'}
                              </span>
                            );
                          }
                          
                          const isPaid = bs === 'confirmed' || payment.payment_status === 'Completed' || payment.payment_status === 'Paid' || (isPaymentTab && activeTab === 'completed');
                          return (
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                              isPaid ? 'bg-green-100 text-green-700' :
                              payment.payment_status === 'Pending' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {isPaid ? 'Paid' : payment.payment_status || 'Failed'}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  ))
                )
              ) : (
                filteredRefunds.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-gray-400 py-8">
                      No refunds or cancellations found
                    </td>
                  </tr>
                ) : (
                  paginatedRefunds.map((refund, index) => (
                    <tr key={index} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedPayment(refund as any)}>
                      <td className="px-6 py-4">
                        <div>{refund.client_name}</div>
                        <div className="text-xs text-gray-500">{refund.invitee_phone || refund.invitee_email}</div>
                      </td>
                      <td className="px-6 py-4">{cleanTherapyTypeName(refund.session_name || '')}</td>
                      <td className="px-6 py-4">{formatSessionDateTime(refund.session_timings || '')}</td>
                      <td className="px-6 py-4">
                        {(() => {
                          const gw = (refund.payment_gateway || '').trim();
                          if (!gw) return <span className="text-gray-400">—</span>;
                          const isManual = ['cash', 'qr'].includes(gw.toLowerCase());
                          return (
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                              isManual ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
                            }`}>
                              {gw}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          // Cash/QR never went through a gateway. There is no
                          // gateway refund status, but there IS an admin decision
                          // about the money once one has been recorded — show it
                          // instead of the old bare dash.
                          const isManual = ['cash', 'qr'].includes((refund.payment_gateway || '').toLowerCase());
                          if (isManual) {
                            const style = CANCELLATION_ACTION_STYLES[(refund as any).cancellation_action];
                            return style
                              ? <span className={`px-3 py-1 rounded-full text-xs font-medium ${style.className}`}>{style.label}</span>
                              : <span className="text-gray-500 font-medium">-</span>;
                          }
                          const rs = (refund.refund_status || '').toLowerCase().trim();
                          if (!rs) {
                            return <span className="text-gray-400">Not Eligible</span>;
                          }
                          const style = REFUND_STATUS_STYLES[rs]
                            || { label: refund.refund_status, className: 'bg-gray-100 text-gray-700' };
                          return (
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${style.className}`}>
                              {style.label}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  ))
                )
              )}
            </tbody>
          </table>
        </div>
        )}
        <div className="px-6 py-4 border-t flex justify-between items-center">
          <span className="text-sm text-gray-600">
            Showing {rowCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, rowCount)} of {rowCount} results
          </span>
          <div className="flex gap-2">
            <button 
              className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              ←
            </button>
            <span className="py-2 px-3 text-sm border rounded bg-gray-50">{currentPage} / {totalPages}</span>
            <button 
              className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              →
            </button>
          </div>
        </div>
      </div>

      {/* Wallet statement */}
      {selectedWallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={() => setSelectedWallet(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto relative p-8" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setSelectedWallet(null)}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-2xl font-bold"
            >
              &times;
            </button>
            <h2 className="text-2xl font-bold mb-1 text-teal-800">Wallet Statement</h2>
            <p className="text-sm text-gray-600 mb-1">{selectedWallet.client_name || 'Unknown client'}</p>
            <p className="text-xs text-gray-500 mb-6 border-b pb-4">
              {selectedWallet.client_phone || '—'}{selectedWallet.client_email ? ` · ${selectedWallet.client_email}` : ''}
            </p>

            <div className="flex items-baseline gap-2 mb-6">
              <span className="text-sm text-gray-500">Current balance</span>
              <span className="text-2xl font-bold text-teal-800">{formatMoney(selectedWallet.balance)}</span>
            </div>

            {statementLoading ? (
              <div className="py-10 flex justify-center"><Loader className="animate-spin text-teal-600" size={28} /></div>
            ) : statement.length === 0 ? (
              <p className="text-gray-400 text-sm py-6 text-center">No transactions</p>
            ) : (
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Date</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Description</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">Credit</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">Debit</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.map(t => (
                      <tr key={t.txn_id} className="border-b last:border-b-0">
                        <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatISTDateTime(t.created_at)}</td>
                        <td className="px-4 py-2">
                          <div className="text-gray-900">{WALLET_REASON_LABELS[t.reason] || t.reason}</div>
                          <div className="text-xs text-gray-500">
                            {t.source_booking_id ? `Booking ${t.source_booking_id}` : ''}
                            {t.source_payment_mode ? ` · ${t.source_payment_mode}` : ''}
                            {t.created_by_name ? ` · by ${t.created_by_name}` : ''}
                          </div>
                          {t.notes && <div className="text-xs text-gray-400 italic mt-0.5">{t.notes}</div>}
                        </td>
                        <td className="px-4 py-2 text-right text-green-700 font-medium">
                          {t.direction === 'CREDIT' ? formatMoney(t.amount) : ''}
                        </td>
                        <td className="px-4 py-2 text-right text-red-600 font-medium">
                          {t.direction === 'DEBIT' ? formatMoney(t.amount) : ''}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-900">{formatMoney(t.balance_after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setSelectedWallet(null)}
                className="px-6 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual adjustment / payout */}
      {adjustTarget && (
        <WalletAdjustModal
          client={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onDone={() => { setAdjustTarget(null); fetchWallets(); }}
        />
      )}

      {/* Payment Details Lightbox */}
      {selectedPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={() => setSelectedPayment(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative p-8" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setSelectedPayment(null)}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-2xl font-bold"
            >
              &times;
            </button>
            <h2 className="text-2xl font-bold mb-6 text-teal-800 border-b pb-3">Payment Details</h2>
            
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-gray-500 text-xs uppercase tracking-wider mb-2">Customer Details</h3>
                <p className="font-medium text-gray-900">{selectedPayment.client_name}</p>
                <p className="text-sm text-gray-600">{selectedPayment.invitee_email}</p>
                <p className="text-sm text-gray-600">{selectedPayment.invitee_phone}</p>
              </div>

              <div>
                <h3 className="font-semibold text-gray-500 text-xs uppercase tracking-wider mb-2">Session Details</h3>
                <p className="text-sm text-gray-600 mb-1">
                  <span className="text-gray-500">Therapy Type:</span> <span className="font-medium text-gray-900">{cleanTherapyTypeName(selectedPayment.session_name || '')}</span>
                </p>
                {(selectedPayment as any).therapist_name || extractTherapistName(selectedPayment.session_name || '') ? (
                  <p className="text-sm text-gray-600 mb-1">
                    <span className="text-gray-500">Therapist:</span> <span className="font-medium text-gray-900">{(selectedPayment as any).therapist_name || extractTherapistName(selectedPayment.session_name || '')}</span>
                  </p>
                ) : null}
                <p className="text-sm text-gray-600">
                  <span className="text-gray-500">Date & Time:</span> <span className="font-medium text-gray-900">{formatSessionDateTime(selectedPayment.session_timings || '')}</span>
                </p>
                {selectedPayment.booking_joining_link && (
                  <a href={selectedPayment.booking_joining_link} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline mt-2 flex items-center gap-1">
                    Join Session Link &rarr;
                  </a>
                )}
              </div>

              <div>
                <h3 className="font-semibold text-gray-500 text-xs uppercase tracking-wider mb-2">Payment Info</h3>
                <p className="text-sm"><span className="text-gray-500 inline-block w-16">Amount:</span> <span className="font-medium">{selectedPayment.payment_amount != null ? `₹${Number(selectedPayment.payment_amount).toLocaleString()}` : '—'}</span></p>
                <p className="text-sm mt-1 flex items-center"><span className="text-gray-500 inline-block w-16">Status:</span>
                  {/* Legacy cancellations carry no payment_status at all — render a
                      neutral dash rather than an empty red badge. */}
                  {!selectedPayment.payment_status && !isExpiredPaymentLink(selectedPayment) ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      selectedPayment.payment_status === 'Completed' || selectedPayment.payment_status === 'Paid' ? 'bg-green-100 text-green-700' :
                      selectedPayment.payment_status === 'Pending' ? 'bg-yellow-100 text-yellow-700' :
                      isExpiredPaymentLink(selectedPayment) ? 'bg-orange-100 text-orange-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {isExpiredPaymentLink(selectedPayment) ? 'Expired' : selectedPayment.payment_status}
                    </span>
                  )}
                </p>
                {selectedPayment.payment_mode && (
                  <p className="text-sm mt-1"><span className="text-gray-500 inline-block w-16">Mode:</span> <span className="font-medium uppercase">{selectedPayment.payment_mode}</span></p>
                )}
                {(selectedPayment as any).payment_gateway && (
                  <p className="text-sm mt-1"><span className="text-gray-500 inline-block w-16">Gateway:</span> <span className="font-medium">{(selectedPayment as any).payment_gateway}</span></p>
                )}
              </div>

              <div>
                <h3 className="font-semibold text-gray-500 text-xs uppercase tracking-wider mb-2">Razorpay Identifiers</h3>
                <p className="text-sm"><span className="text-gray-500">Order ID:</span> <span className="font-medium text-gray-800">{selectedPayment.razorpay_order_id || 'N/A'}</span></p>
                <p className="text-sm mt-1"><span className="text-gray-500">Payment ID:</span> <span className="font-medium text-gray-800">{selectedPayment.payment_id || 'N/A'}</span></p>
                {selectedPayment.utr && (
                  <p className="text-sm mt-1"><span className="text-gray-500">UTR:</span> <span className="font-mono bg-gray-100 px-1 rounded text-teal-800 border">{selectedPayment.utr}</span></p>
                )}
              </div>
              
              <div className="col-span-2 mt-2">
                <h3 className="font-semibold text-gray-500 text-xs uppercase tracking-wider mb-2">Timestamps</h3>
                <div className="flex justify-between bg-gray-50 p-4 rounded-lg border">
                  <div>
                    <p className="text-xs text-gray-500 uppercase">{isCancelledBooking(selectedPayment) ? 'Booked At' : 'Initiated At'}</p>
                    <p className="text-sm font-medium text-gray-800">{formatISTDateTime(selectedPayment.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase">
                      {isExpiredPaymentLink(selectedPayment) ? 'Expired At'
                        : isCancelledBooking(selectedPayment) ? 'Cancelled At'
                        : selectedPayment.payment_status === 'Failed' ? 'Failed At'
                        : 'Completed At'}
                    </p>
                    <p className="text-sm font-medium text-gray-800">
                      {formatISTDateTime(
                        isCancelledBooking(selectedPayment)
                          ? ((selectedPayment as any).cancelled_at || selectedPayment.booking_updated_at)
                          : selectedPayment.booking_updated_at
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {selectedPayment.payment_status === 'Failed' && selectedPayment.failure_reason && (
                <div className="col-span-2 bg-red-50 border border-red-200 p-4 rounded-lg mt-2">
                  <h3 className="font-semibold text-red-800 text-xs uppercase tracking-wider mb-1">Failure Reason</h3>
                  <p className="text-red-700 text-sm font-medium">{selectedPayment.failure_reason}</p>
                </div>
              )}

              {(selectedPayment.refund_id || selectedPayment.refund_initiated_at || (selectedPayment as any).refund_status) && (
                <div className="col-span-2 bg-purple-50 border border-purple-200 p-4 rounded-lg mt-2">
                  <h3 className="font-semibold text-purple-800 text-xs uppercase tracking-wider mb-3">Refund Details</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-purple-600 uppercase">Refund ID</p>
                      <p className="text-sm font-medium text-gray-800 font-mono">{selectedPayment.refund_id || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-purple-600 uppercase">Refund Status</p>
                      <p className="text-sm font-medium text-gray-800 capitalize">{(selectedPayment as any).refund_status || 'Initiated'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-purple-600 uppercase">Refund Amount</p>
                      <p className="text-sm font-medium text-gray-800">
                        {Number((selectedPayment as any).refund_amount) > 0
                          ? `₹${Number((selectedPayment as any).refund_amount).toLocaleString()}`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-purple-600 uppercase">Initiated At</p>
                      <p className="text-sm font-medium text-gray-800">{formatISTDateTime(selectedPayment.refund_initiated_at)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="mt-8 flex justify-end">
              <button 
                onClick={() => setSelectedPayment(null)}
                className="px-6 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
