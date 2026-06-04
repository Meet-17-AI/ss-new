import React, { useState, useEffect } from 'react';
import { Save, RefreshCw, CreditCard, Shield, Settings, Check, X, Edit, ChevronRight } from 'lucide-react';

interface PaymentConfig {
  active_gateway: string;
  razorpay_key_id: string;
  razorpay_key_secret: string;
}

export const PaymentSettings: React.FC = () => {
  const [settings, setSettings] = useState<PaymentConfig>({
    active_gateway: 'razorpay',
    razorpay_key_id: '',
    razorpay_key_secret: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  
  const [editingGateway, setEditingGateway] = useState<'razorpay' | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/payment-settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setSettings(prev => ({ ...prev, ...data.settings }));
        }
      }
    } catch (err) {
      console.error('Error fetching payment settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (updatedSettings: PaymentConfig = settings) => {
    try {
      setSaving(true);
      setMessage(null);
      // Ensure active_gateway is always razorpay
      updatedSettings.active_gateway = 'razorpay';
      const res = await fetch('/api/payment-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: updatedSettings })
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Payment settings saved successfully.' });
        setSettings(updatedSettings);
        setEditingGateway(null);
      } else {
        setMessage({ type: 'error', text: 'Failed to save settings.' });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'An error occurred while saving.' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 4000);
    }
  };

  const handleChange = (key: keyof PaymentConfig, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <RefreshCw className="animate-spin text-teal-600" size={32} />
        <span className="text-gray-500 font-medium">Loading settings...</span>
      </div>
    );
  }

  const isRazorpayConnected = !!(settings.razorpay_key_id && settings.razorpay_key_secret);

  return (
    <div className="p-6 flex flex-col h-full bg-white overflow-y-auto">
      <div className="mb-6 pb-4 border-b border-gray-100 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-800 font-sans flex items-center gap-2">
            <CreditCard className="text-teal-600" /> Payment Gateways
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure your Razorpay account to accept payments for public bookings.
          </p>
        </div>
      </div>

      {message && (
        <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          <Shield size={20} />
          {message.text}
        </div>
      )}

      {/* List View */}
      <div className="flex-1 space-y-4">
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border transition-all cursor-pointer bg-teal-50/30 border-teal-200 shadow-sm"
          onClick={() => setEditingGateway('razorpay')}
        >
          <div className="flex items-center gap-4">
            <div 
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm"
              style={{ backgroundColor: '#02042b' }}
            >
              R
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-800 text-lg">Razorpay</span>
                
                {isRazorpayConnected ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200">
                    Disconnected
                  </span>
                )}

                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800 border border-teal-200">
                  <Check size={12} /> Active Gateway
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Click to configure keys and settings.
              </p>
            </div>
          </div>

          <div className="mt-4 sm:mt-0 flex items-center gap-3">
            <button
              className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium text-sm rounded-lg transition-all flex items-center gap-2"
            >
              <Edit size={16} /> Configure
            </button>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingGateway === 'razorpay' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-800 capitalize">
                Configure Razorpay
              </h2>
              <button 
                onClick={() => setEditingGateway(null)}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Key ID</label>
                <input
                  type="text"
                  value={settings.razorpay_key_id}
                  onChange={(e) => handleChange('razorpay_key_id', e.target.value)}
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                  placeholder="rzp_test_..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Key Secret</label>
                <input
                  type="password"
                  value={settings.razorpay_key_secret}
                  onChange={(e) => handleChange('razorpay_key_secret', e.target.value)}
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
                  placeholder="••••••••••••••••"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => setEditingGateway(null)}
                className="px-5 py-2.5 text-gray-600 font-medium hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSave()}
                disabled={saving}
                className="px-6 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {saving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
                Save Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
