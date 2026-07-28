import React, { useState } from 'react';
import { Input } from './Input';
import { Button } from './Button';
import { User, KeyRound, Mail, Eye, EyeOff } from 'lucide-react';

interface LoginFormProps {
  onLogin: (user: any, token?: string) => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onLogin }) => {
  const [loginMode, setLoginMode] = useState<'normal' | 'otp' | 'forgot'>('normal');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password states
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [resetStep, setResetStep] = useState<'email' | 'otp' | 'password'>('email');
  const [successMessage, setSuccessMessage] = useState('');
  const [resendTimer, setResendTimer] = useState(0);
  const [canResend, setCanResend] = useState(false);

  const handleNormalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Detect portal based on URL
    const portal = window.location.hostname.includes('crm') ? 'crm' : 'dashboard';

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, portal }),
      });

      const data = await response.json();

      if (data.success) {
        onLogin(data.user, data.token);
      } else {
        setError('Invalid username or password');
      }
    } catch (err) {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOTPLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/verify-therapist-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });

      const data = await response.json();

      if (data.success) {
        // Create temporary user object for dashboard access
        const tempUser = {
          id: data.data.requestId,
          therapist_id: data.data.requestId, // Add therapist_id for API calls
          username: email.split('@')[0],
          email: email,
          role: 'therapist',
          full_name: data.data.name,
          needsProfileCompletion: true,
          profileStatus: 'pending_review', // Will be under review after submission
          profileData: data.data
        };
        
        // Log them in with temporary access
        onLogin(tempUser, data.token);
      } else {
        setError(data.error || 'Invalid email or OTP');
      }
    } catch (err) {
      setError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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

  const handleSendResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      const response = await fetch('/api/forgot-password/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail })
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage('OTP sent to your email!');
        setResetStep('otp');
        setResendTimer(60); // 60 seconds countdown
        setCanResend(false);
      } else {
        setError(data.error || 'Failed to send OTP');
      }
    } catch (error) {
      console.error('Error:', error);
      setError('Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError('');
    setSuccessMessage('');
    setLoading(true);
    setCanResend(false);

    try {
      const response = await fetch('/api/forgot-password/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail })
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage('OTP resent to your email!');
        setResendTimer(60); // Reset countdown
        setResetOtp(''); // Clear previous OTP
      } else {
        setError(data.error || 'Failed to resend OTP');
        setCanResend(true);
      }
    } catch (error) {
      console.error('Error:', error);
      setError('Failed to resend OTP. Please try again.');
      setCanResend(true);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      const response = await fetch('/api/forgot-password/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, otp: resetOtp })
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage('OTP verified successfully!');
        setResetStep('password');
      } else {
        setError(data.error || 'Invalid OTP');
      }
    } catch (error) {
      console.error('Error:', error);
      setError('Failed to verify OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!validatePassword(resetNewPassword)) {
      setError('Password must be at least 8 characters with uppercase, lowercase, and number');
      return;
    }

    if (resetNewPassword !== resetConfirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

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
        setSuccessMessage('Password reset successfully! You can now login.');
        // Reset form and switch back to normal login after 2 seconds
        setTimeout(() => {
          setResetEmail('');
          setResetOtp('');
          setResetNewPassword('');
          setResetConfirmPassword('');
          setResetStep('email');
          setLoginMode('normal');
          setSuccessMessage('');
        }, 2000);
      } else {
        setError(data.error || 'Failed to reset password');
      }
    } catch (error) {
      console.error('Error:', error);
      setError('Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={
        loginMode === 'normal' ? handleNormalLogin : 
        loginMode === 'otp' ? handleOTPLogin :
        resetStep === 'email' ? handleSendResetOtp :
        resetStep === 'otp' ? handleVerifyResetOtp :
        handleResetPassword
      } className="w-full">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-black mb-2">
            {loginMode === 'normal' ? 'Welcome Back' : 
             loginMode === 'otp' ? 'First Time Login' : 
             'Reset Password'}
          </h1>
          <p className="text-gray-500 text-sm font-medium">
            {loginMode === 'normal' ? 'Sign in to access your dashboard' : 
             loginMode === 'otp' ? 'First time login with OTP' :
             resetStep === 'email' ? 'Enter your email to receive OTP' :
             resetStep === 'otp' ? 'Enter the OTP sent to your email' :
             'Create a new password'}
          </p>
        </div>

        <div className="space-y-4">
          {loginMode === 'normal' ? (
            <>
              <Input 
                label="Username" 
                placeholder="enter email address or phone no." 
                icon={User}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              
              <Input 
                label="Password" 
                placeholder="enter password" 
                icon={KeyRound} 
                isPassword
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          ) : loginMode === 'otp' ? (
            <>
              <Input 
                label="Email" 
                placeholder="enter your email" 
                icon={Mail}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              
              <Input 
                label="OTP" 
                placeholder="enter 6-digit OTP" 
                icon={KeyRound}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                maxLength={6}
              />
            </>
          ) : (
            <>
              {resetStep === 'email' && (
                <div>
                  <label className="block text-sm font-semibold mb-1.5 text-gray-700">
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
              )}

              {resetStep === 'otp' && (
                <div>
                  <label className="block text-sm font-semibold mb-1.5 text-gray-700">
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
                  <p className="text-xs text-gray-500 mt-1">
                    Enter the 6-digit OTP sent to {resetEmail}
                  </p>
                  
                  {/* Resend OTP Section */}
                  <div className="text-center mt-3">
                    {resendTimer > 0 ? (
                      <p className="text-sm text-gray-600">
                        Resend OTP in <span className="font-semibold text-teal-700">{resendTimer}s</span>
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResendOtp}
                        disabled={loading || !canResend}
                        className="text-sm font-semibold text-teal-700 hover:text-teal-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                      >
                        {loading ? 'Sending...' : 'Resend OTP'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {resetStep === 'password' && (
                <>
                  <div>
                    <label className="block text-sm font-semibold mb-1.5 text-gray-700">
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
                    <label className="block text-sm font-semibold mb-1.5 text-gray-700">
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
                </>
              )}
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-600 text-sm">
            {successMessage}
          </div>
        )}

        <div className="flex justify-between items-center mt-2 mb-8">
          <button
            type="button"
            onClick={() => {
              if (loginMode === 'forgot') {
                setLoginMode('normal');
                setResetStep('email');
                setResetEmail('');
                setResetOtp('');
                setResetNewPassword('');
                setResetConfirmPassword('');
                setResendTimer(0);
                setCanResend(false);
              } else {
                setLoginMode(loginMode === 'normal' ? 'otp' : 'normal');
              }
              setError('');
              setSuccessMessage('');
            }}
            className="text-sm font-bold text-teal-700 hover:text-teal-800 transition-colors"
          >
            {loginMode === 'forgot' ? 'Back to Login' :
             loginMode === 'normal' ? 'First Time Login?' : 'Back to Normal Login'}
          </button>
          
          {loginMode === 'normal' && (
            <button
              type="button"
              onClick={() => {
                setLoginMode('forgot');
                setError('');
                setSuccessMessage('');
              }}
              className="text-sm font-bold text-teal-700 hover:text-teal-800 transition-colors"
            >
              Forgot Your Password?
            </button>
          )}
        </div>

        <Button type="submit" fullWidth className="text-lg" disabled={loading}>
          {loading ? 'Please wait...' : 
           loginMode === 'normal' ? 'Log In' : 
           loginMode === 'otp' ? 'Verify OTP' :
           resetStep === 'email' ? 'Send OTP' :
           resetStep === 'otp' ? 'Verify OTP' :
           'Reset Password'}
        </Button>
      </form>
    </>
  );
};