import React, { useState } from 'react';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { Toast } from './Toast';

interface ChangePasswordProps {
  onBack?: () => void;
  user: any;
  hideHeader?: boolean;
}

export const ChangePassword: React.FC<ChangePasswordProps> = ({ onBack, user, hideHeader = false }) => {
  const [activeTab, setActiveTab] = useState<'change' | 'forgot'>('change');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Forgot password states
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [resetStep, setResetStep] = useState<'email' | 'otp' | 'password'>('email');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [canResend, setCanResend] = useState(false);

  const validatePassword = (pwd: string): boolean => {
    if (pwd.length < 8) return false;
    if (!/[A-Z]/.test(pwd)) return false;
    if (!/[a-z]/.test(pwd)) return false;
    if (!/[0-9]/.test(pwd)) return false;
    return true;
  };

  // Resend timer effect
  React.useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => {
        setResendTimer(resendTimer - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (resendTimer === 0 && resetStep === 'otp') {
      setCanResend(true);
    }
  }, [resendTimer, resetStep]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (!currentPassword) {
      setPasswordError('Please enter your current password');
      return;
    }

    if (!validatePassword(newPassword)) {
      setPasswordError('New password must be at least 8 characters with uppercase, lowercase, and number');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    setUpdatingPassword(true);

    try {
      // Verify current password
      const verifyResponse = await fetch('/api/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
          password: currentPassword
        })
      });

      const verifyData = await verifyResponse.json();

      if (!verifyData.success) {
        setPasswordError('Current password is incorrect');
        setUpdatingPassword(false);
        return;
      }

      // Update password
      const updateResponse = await fetch('/api/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          new_password: newPassword
        })
      });

      const updateData = await updateResponse.json();

      if (updateData.success) {
        setToast({ message: 'Password updated successfully!', type: 'success' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordError(updateData.error || 'Failed to update password');
      }
    } catch (error) {
      console.error('Error:', error);
      setPasswordError('An error occurred while updating password');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleSendResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setResettingPassword(true);

    try {
      const response = await fetch('/api/forgot-password/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail })
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'OTP sent to your email!', type: 'success' });
        setResetStep('otp');
        setResendTimer(60); // 60 seconds countdown
        setCanResend(false);
      } else {
        setPasswordError(data.error || 'Failed to send OTP');
      }
    } catch (error) {
      console.error('Error:', error);
      setPasswordError('Failed to send OTP. Please try again.');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleResendOtp = async () => {
    setPasswordError('');
    setResettingPassword(true);
    setCanResend(false);

    try {
      const response = await fetch('/api/forgot-password/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail })
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'OTP resent to your email!', type: 'success' });
        setResendTimer(60); // Reset countdown
        setResetOtp(''); // Clear previous OTP
      } else {
        setPasswordError(data.error || 'Failed to resend OTP');
        setCanResend(true);
      }
    } catch (error) {
      console.error('Error:', error);
      setPasswordError('Failed to resend OTP. Please try again.');
      setCanResend(true);
    } finally {
      setResettingPassword(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setResettingPassword(true);

    try {
      const response = await fetch('/api/forgot-password/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, otp: resetOtp })
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'OTP verified successfully!', type: 'success' });
        setResetStep('password');
      } else {
        setPasswordError(data.error || 'Invalid OTP');
      }
    } catch (error) {
      console.error('Error:', error);
      setPasswordError('Failed to verify OTP. Please try again.');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (!validatePassword(resetNewPassword)) {
      setPasswordError('Password must be at least 8 characters with uppercase, lowercase, and number');
      return;
    }

    if (resetNewPassword !== resetConfirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setResettingPassword(true);

    try {
      const response = await fetch('/api/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: resetEmail,
          otp: resetOtp,
          newPassword: resetNewPassword 
        })
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'Password reset successfully! You can now login with your new password.', type: 'success' });
        // Reset form and switch to change password tab after 2 seconds
        setTimeout(() => {
          setResetEmail('');
          setResetOtp('');
          setResetNewPassword('');
          setResetConfirmPassword('');
          setResetStep('email');
          setActiveTab('change');
        }, 2000);
      } else {
        setPasswordError(data.error || 'Failed to reset password');
      }
    } catch (error) {
      console.error('Error:', error);
      setPasswordError('Failed to reset password. Please try again.');
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <div className={hideHeader ? "" : "p-8 bg-gray-50 min-h-screen"}>
      {!hideHeader && (
        <>
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6"
          >
            <ArrowLeft size={20} />
            <span>Back</span>
          </button>

          <h1 className="text-3xl font-bold mb-1">Change/Forgot Password</h1>
          <p className="text-gray-600 mb-8">Update or recover your account password</p>
        </>
      )}

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b">
        <button
          onClick={() => {
            setActiveTab('change');
            setPasswordError('');
          }}
          className={`pb-3 px-4 font-medium ${
            activeTab === 'change'
              ? 'text-teal-700 border-b-2 border-teal-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Change Password
        </button>
        <button
          onClick={() => {
            setActiveTab('forgot');
            setPasswordError('');
          }}
          className={`pb-3 px-4 font-medium ${
            activeTab === 'forgot'
              ? 'text-teal-700 border-b-2 border-teal-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Forgot Password
        </button>
      </div>

      <div className="bg-white rounded-lg border p-6">
        {activeTab === 'change' ? (
          <form onSubmit={handleChangePassword} className="space-y-4">
            {passwordError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {passwordError}
              </div>
            )}

            {/* Current Password */}
            <div>
              <label className="block text-sm font-semibold mb-1.5">
                Current Password<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                >
                  {showCurrentPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div>
              <label className="block text-sm font-semibold mb-1.5">
                New Password<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                >
                  {showNewPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                At least 8 characters with uppercase, lowercase, and number
              </p>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-semibold mb-1.5">
                Confirm New Password<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                >
                  {showConfirmPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={updatingPassword}
              className="w-full bg-teal-700 text-white py-3 rounded-lg hover:bg-teal-800 font-medium disabled:bg-gray-400 disabled:cursor-not-allowed mt-6"
            >
              {updatingPassword ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        ) : (
          <>
            {resetStep === 'email' && (
              <form onSubmit={handleSendResetOtp} className="space-y-4">
                {passwordError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                    {passwordError}
                  </div>
                )}
                <p className="text-sm text-gray-600 mb-4">
                  Enter your email address and we'll send you an OTP to reset your password.
                </p>
                <div>
                  <label className="block text-sm font-semibold mb-1.5">
                    Email Address<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="your.email@example.com"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={resettingPassword}
                  className="w-full bg-teal-700 text-white py-3 rounded-lg hover:bg-teal-800 font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {resettingPassword ? 'Sending...' : 'Send OTP'}
                </button>
              </form>
            )}

            {resetStep === 'otp' && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                {passwordError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                    {passwordError}
                  </div>
                )}
                <p className="text-sm text-gray-600 mb-4">
                  Enter the 6-digit OTP sent to {resetEmail}
                </p>
                <div>
                  <label className="block text-sm font-semibold mb-1.5">
                    OTP<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={resetOtp}
                    onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-center text-2xl tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                    required
                  />
                </div>
                
                {/* Resend OTP Section */}
                <div className="text-center">
                  {resendTimer > 0 ? (
                    <p className="text-sm text-gray-600">
                      Resend OTP in <span className="font-semibold text-teal-700">{resendTimer}s</span>
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={resettingPassword || !canResend}
                      className="text-sm font-semibold text-teal-700 hover:text-teal-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                    >
                      {resettingPassword ? 'Sending...' : 'Resend OTP'}
                    </button>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setResetStep('email');
                      setResendTimer(0);
                      setCanResend(false);
                    }}
                    className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-50 font-medium"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={resettingPassword}
                    className="flex-1 bg-teal-700 text-white py-3 rounded-lg hover:bg-teal-800 font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {resettingPassword ? 'Verifying...' : 'Verify OTP'}
                  </button>
                </div>
              </form>
            )}

            {resetStep === 'password' && (
              <form onSubmit={handleResetPassword} className="space-y-4">
                {passwordError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                    {passwordError}
                  </div>
                )}
                <p className="text-sm text-gray-600 mb-4">
                  Create a new password for your account
                </p>
                <div>
                  <label className="block text-sm font-semibold mb-1.5">
                    New Password<span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showResetNewPassword ? 'text' : 'password'}
                      value={resetNewPassword}
                      onChange={(e) => setResetNewPassword(e.target.value)}
                      className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetNewPassword(!showResetNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                    >
                      {showResetNewPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    At least 8 characters with uppercase, lowercase, and number
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1.5">
                    Confirm New Password<span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showResetConfirmPassword ? 'text' : 'password'}
                      value={resetConfirmPassword}
                      onChange={(e) => setResetConfirmPassword(e.target.value)}
                      className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetConfirmPassword(!showResetConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                    >
                      {showResetConfirmPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={resettingPassword}
                  className="w-full bg-teal-700 text-white py-3 rounded-lg hover:bg-teal-800 font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {resettingPassword ? 'Resetting...' : 'Reset Password'}
                </button>
              </form>
            )}
          </>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};
