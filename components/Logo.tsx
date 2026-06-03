import React from 'react';

interface LogoProps {
  size?: 'small' | 'large';
}

export const Logo: React.FC<LogoProps> = ({ size = 'large' }) => {
  const isSmall = size === 'small';
  
  return (
    <div className="flex flex-col select-none leading-none">
      <div className="flex items-center">
        <span className={`${isSmall ? 'text-3xl' : 'text-4xl md:text-5xl'} font-bold text-brand-yellow tracking-tight font-sans`}>Safe</span>
        
        {/* Custom Speech Bubble Icon */}
        <div className="ml-2 relative pt-1">
            <svg width="60" height="40" viewBox="0 0 60 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={isSmall ? 'w-10 h-6' : 'w-12 h-8 md:w-[60px] md:h-[40px]'}>
                <path 
                    d="M15 5 H45 A12 12 0 0 1 57 17 V17 A12 12 0 0 1 45 29 H42 L38 38 L34 29 H15 A12 12 0 0 1 3 17 V17 A12 12 0 0 1 15 5 Z" 
                    stroke="#21615D" 
                    strokeWidth="5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                />
                <circle cx="16" cy="17" r="3" fill="#F4A936"/>
                <circle cx="26" cy="17" r="3" fill="#F4A936"/>
                <circle cx="36" cy="17" r="3" fill="#F4A936"/>
                <circle cx="46" cy="17" r="3" fill="#F4A936"/>
            </svg>
        </div>
      </div>
      <span className={`${isSmall ? 'text-3xl' : 'text-4xl md:text-5xl'} font-bold text-brand-teal tracking-tight -mt-2 font-sans`}>Stories</span>
      <span className={`${isSmall ? 'text-xs' : 'text-sm'} font-semibold text-teal-800 tracking-widest mt-1 uppercase ml-1 opacity-80`} style={{ letterSpacing: '0.3em' }}>Panel 2.0</span>
    </div>
  );
};