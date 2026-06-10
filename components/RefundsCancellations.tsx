import React, { useState, useEffect, useCallback } from 'react';
import { Search, Download, Loader } from 'lucide-react';
import * as XLSX from 'xlsx'

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
}

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
}

export const RefundsCancellations: React.FC<{ initialTab?: string }> = ({ initialTab }) => {
  const [activeTab, setActiveTab] = useState(initialTab || 'all_payments');
  const [searchQuery, setSearchQuery] = useState('');
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery]);

  const tabs = [
    { id: 'all_payments', label: 'All Payments' },
    { id: 'completed', label: 'Completed/Paid' },
    { id: 'pending', label: 'Pending' },
    { id: 'expired', label: 'Expired Link' },
    { id: 'all', label: 'All Cancellations' },
    { id: 'Pending', label: 'Refund Initiated' },
    { id: 'Failed', label: 'Refund Failed' },
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

  useEffect(() => {
    // Fetch payments for payment tabs
    if (['all_payments', 'completed', 'pending', 'expired'].includes(activeTab)) {
      fetchPayments();
    }
    // Fetch refunds for cancellation tabs
    else if (['all', 'Pending', 'Failed'].includes(activeTab)) {
      fetchRefunds();
    }
  }, [activeTab, fetchPayments, fetchRefunds]);

  const isPaymentTab = ['all_payments', 'completed', 'pending', 'expired'].includes(activeTab);
  const safeRefunds = Array.isArray(refunds) ? refunds : [];
  const safePayments = Array.isArray(payments) ? payments : [];
  const filteredRefunds = !isPaymentTab
    ? safeRefunds.filter(refund =>
        (refund.client_name || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const filteredPayments = isPaymentTab
    ? safePayments.filter(payment =>
        (payment.client_name || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const totalPages = Math.max(1, Math.ceil((isPaymentTab ? filteredPayments.length : filteredRefunds.length) / itemsPerPage));
  const paginatedPayments = filteredPayments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const paginatedRefunds = filteredRefunds.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const exportToCSV = () => {
    if (isPaymentTab) {
      const headers = ['Client Name', 'Contact', 'Session Name', 'Session Date & Time', 'Amount', 'Payment Status'];
      const rows = filteredPayments.map(payment => [
        payment.client_name,
        payment.invitee_phone || payment.invitee_email,
        payment.session_name,
        payment.session_timings,
        payment.payment_amount,
        payment.payment_status
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Payments')
      XLSX.writeFile(wb, `payments_export_${new Date().toISOString().split('T')[0]}.xlsx`)
    } else {
      const headers = ['Client Name', 'Contact', 'Cancelled Session', 'Session Date & Time', 'Refund Status'];
      const rows = filteredRefunds.map(refund => [
        refund.client_name,
        refund.invitee_phone || refund.invitee_email,
        refund.session_name,
        refund.session_timings,
        refund.refund_status
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
          <p className="text-gray-600">View all payments and Cancellations and refunds</p>
          <p className="text-sm italic mt-1" style={{ color: '#21615D' }}>Razorpay gateway currently only displays "Initiated" or "Failed" statuses. A "Completed" status will not be shown</p>
        </div>
        <div className="flex gap-4">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search client by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
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

      {/* Table */}
      <div className="bg-white rounded-lg border flex-1 flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader className="animate-spin text-teal-600" size={32} />
          </div>
        ) : (
        <div className="overflow-x-auto flex-1">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Client Details</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">{isPaymentTab ? 'Session Name' : 'Cancelled Session'}</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Session Date & Time</th>
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
                      <td className="px-6 py-4">{payment.session_name}</td>
                      <td className="px-6 py-4">{payment.session_timings}</td>
                      <td className="px-6 py-4">₹{Number(payment.payment_amount || 0).toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          (payment.payment_status === 'Completed' || payment.payment_status === 'Paid' || (isPaymentTab && activeTab === 'completed')) ? 'bg-green-100 text-green-700' :
                          payment.payment_status === 'Pending' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {payment.payment_status || (activeTab === 'completed' ? 'Paid' : 'Failed')}
                        </span>
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
                      <td className="px-6 py-4">{refund.session_name}</td>
                      <td className="px-6 py-4">{refund.session_timings}</td>
                      <td className="px-6 py-4">
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          {refund.payment_gateway || 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          refund.refund_status === 'Completed' ? 'bg-green-100 text-green-700' :
                          refund.refund_status === 'Pending' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {refund.refund_status}
                        </span>
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
            Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, isPaymentTab ? filteredPayments.length : filteredRefunds.length)} of {isPaymentTab ? filteredPayments.length : filteredRefunds.length} results
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
                <p className="font-medium text-gray-900">{selectedPayment.session_name}</p>
                <p className="text-sm text-gray-600">{selectedPayment.session_timings}</p>
                {selectedPayment.booking_joining_link && (
                  <a href={selectedPayment.booking_joining_link} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline mt-1 flex items-center gap-1">
                    Join Session Link &rarr;
                  </a>
                )}
              </div>

              <div>
                <h3 className="font-semibold text-gray-500 text-xs uppercase tracking-wider mb-2">Payment Info</h3>
                <p className="text-sm"><span className="text-gray-500 inline-block w-16">Amount:</span> <span className="font-medium">₹{Number(selectedPayment.payment_amount).toLocaleString()}</span></p>
                <p className="text-sm mt-1 flex items-center"><span className="text-gray-500 inline-block w-16">Status:</span> 
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                    selectedPayment.payment_status === 'Completed' || selectedPayment.payment_status === 'Paid' ? 'bg-green-100 text-green-700' :
                    selectedPayment.payment_status === 'Pending' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {selectedPayment.payment_status}
                  </span>
                </p>
                {selectedPayment.payment_mode && (
                  <p className="text-sm mt-1"><span className="text-gray-500 inline-block w-16">Mode:</span> <span className="font-medium uppercase">{selectedPayment.payment_mode}</span></p>
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
                    <p className="text-xs text-gray-500 uppercase">Initiated At</p>
                    <p className="text-sm font-medium text-gray-800">{selectedPayment.created_at ? new Date(selectedPayment.created_at).toLocaleString() : 'N/A'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase">{selectedPayment.payment_status === 'Failed' ? 'Failed At' : 'Completed At'}</p>
                    <p className="text-sm font-medium text-gray-800">{selectedPayment.booking_updated_at ? new Date(selectedPayment.booking_updated_at).toLocaleString() : 'N/A'}</p>
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
                    {selectedPayment.refund_initiated_at && (
                      <div>
                        <p className="text-xs text-purple-600 uppercase">Initiated At</p>
                        <p className="text-sm font-medium text-gray-800">{new Date(selectedPayment.refund_initiated_at).toLocaleString()}</p>
                      </div>
                    )}
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
