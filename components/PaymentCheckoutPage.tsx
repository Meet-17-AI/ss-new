import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CreditCard, CheckCircle, Clock, ShieldCheck, ArrowRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export const PaymentCheckoutPage: React.FC = () => {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [bookingInfo, setBookingInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBookingInfo = async () => {
      try {
        const response = await fetch(`/api/bookings/${bookingId}/checkout-info`);
        const result = await response.json();

        if (response.ok && result.success) {
          setBookingInfo(result.data);
        } else {
          setError(result.error || 'This payment link is invalid or has expired.');
        }
      } catch (err) {
        setError('Failed to load payment details. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    if (bookingId) {
      fetchBookingInfo();
    }
  }, [bookingId]);

  const handleSimulatePayment = async () => {
    setProcessing(true);
    
    try {
      // Simulate Razorpay delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      const response = await fetch('/api/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          razorpayPaymentId: 'pay_mock_' + Math.random().toString(36).substring(7),
          razorpayOrderId: 'order_mock_' + Math.random().toString(36).substring(7)
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast.success('Payment successful! Your booking is confirmed.');
        navigate('/booking-confirmation/success', { state: { bookingId } });
      } else {
        toast.error(result.error || 'Payment failed to confirm.');
      }
    } catch (err) {
      toast.error('Network error while confirming payment.');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (error || !bookingInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border p-8 text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Link Expired or Invalid</h2>
          <p className="text-gray-500 mb-6">{error}</p>
          <button 
            onClick={() => window.location.href = '/'}
            className="w-full bg-gray-900 text-white rounded-xl py-3 font-medium hover:bg-gray-800 transition-colors"
          >
            Return to Homepage
          </button>
        </div>
      </div>
    );
  }

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-inter">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Complete Your Payment</h1>
          <p className="text-gray-500 mt-2">You're one step away from confirming your session.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          
          {/* Left Column: Order Summary */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Session Summary</h2>
            
            <div className="space-y-4">
              <div className="pb-4 border-b">
                <p className="text-sm text-gray-500 mb-1">Therapist</p>
                <p className="font-medium text-gray-900">{bookingInfo.therapist_name || 'SafeStories Expert'}</p>
              </div>
              
              <div className="pb-4 border-b">
                <p className="text-sm text-gray-500 mb-1">Service</p>
                <p className="font-medium text-gray-900">{bookingInfo.booking_resource_name}</p>
              </div>

              <div className="pb-4 border-b">
                <p className="text-sm text-gray-500 mb-1">Date & Time (IST)</p>
                <p className="font-medium text-gray-900">
                  {formatDate(bookingInfo.booking_start_at)}
                </p>
                <p className="text-gray-600 mt-0.5">
                  {formatTime(bookingInfo.booking_start_at)}
                </p>
              </div>

              <div className="pt-2">
                <div className="flex items-center justify-between">
                  <p className="text-base text-gray-600">Total Amount</p>
                  <p className="text-2xl font-bold text-teal-600">₹{bookingInfo.payment_amount}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Payment Actions */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-6 pb-4 border-b">
                <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center text-teal-600">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Secure Checkout</h3>
                  <p className="text-xs text-gray-500">Your slot is reserved for 15 minutes.</p>
                </div>
              </div>

              <button
                onClick={handleSimulatePayment}
                disabled={processing}
                className="w-full bg-teal-600 text-white rounded-xl py-4 font-semibold text-lg hover:bg-teal-700 transition-all shadow-md hover:shadow-lg disabled:opacity-70 flex items-center justify-center gap-2 group"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing Payment...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-5 h-5" />
                    Pay ₹{bookingInfo.payment_amount} Securely
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              <div className="mt-6 flex items-center justify-center gap-4 text-gray-400">
                <span className="text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3"/> SSL Secured</span>
                <span className="text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3"/> 256-bit Encryption</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
