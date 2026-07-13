import { useState, useRef, useEffect } from 'react'
import { User, Eye, LogOut, BarChart3, Columns3, Users, ClipboardCheck } from 'lucide-react'
import { Logo } from '../../../components/Logo'

interface SidebarProps {
  currentPage: string
  setCurrentPage: (page: string) => void
  currentUser?: any
  onLogout?: () => void
}

const Sidebar = ({ currentPage, setCurrentPage, currentUser, onLogout }: SidebarProps) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(null)
  const profileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchProfilePicture = async () => {
      if (!currentUser?.id) return;
      try {
        const profileRes = await fetch(`/api/admin-profile?user_id=${currentUser.id}`);
        if (profileRes.ok) {
          const contentType = profileRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const profileData = await profileRes.json();
            if (profileData.success && profileData.data.profile_picture_url) {
              setProfilePictureUrl(profileData.data.profile_picture_url.replace('s3.fluidjobs.ai:9002', 's3.srv1169280.hstgr.cloud:443').replace('s3.fluidjobs.ai', 's3.srv1169280.hstgr.cloud'));
            }
          }
        }
      } catch (error) {
        console.error('Error fetching profile picture:', error);
      }
    };
    fetchProfilePicture();
  }, [currentUser?.id]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="w-64 bg-white border-r flex flex-col h-screen overflow-hidden">
      <div className="p-6 flex justify-center">
        <Logo size="small" />
      </div>

      <nav className="flex-1 px-4">

        <div
          className={`rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer ${
            currentPage === 'analytics' ? 'text-teal-700' : 'text-gray-700 hover:bg-gray-100'
          }`}
          style={{ backgroundColor: currentPage === 'analytics' ? '#2D75795C' : 'transparent' }}
          onClick={() => setCurrentPage('analytics')}
        >
          <BarChart3 className="w-5 h-5 flex-shrink-0" />
          <span className={currentPage === 'analytics' ? 'text-teal-700' : 'text-gray-700'}>Analytics</span>
        </div>
        <div
          className={`rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer ${
            currentPage === 'pipeline' ? 'text-teal-700' : 'text-gray-700 hover:bg-gray-100'
          }`}
          style={{ backgroundColor: currentPage === 'pipeline' ? '#2D75795C' : 'transparent' }}
          onClick={() => setCurrentPage('pipeline')}
        >
          <Columns3 className="w-5 h-5 flex-shrink-0" />
          <span className={currentPage === 'pipeline' ? 'text-teal-700' : 'text-gray-700'}>Pipeline</span>
        </div>
        <div
          className={`rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer ${
            currentPage === 'leads' ? 'text-teal-700' : 'text-gray-700 hover:bg-gray-100'
          }`}
          style={{ backgroundColor: currentPage === 'leads' ? '#2D75795C' : 'transparent' }}
          onClick={() => setCurrentPage('leads')}
        >
          <Users className="w-5 h-5 flex-shrink-0" />
          <span className={currentPage === 'leads' ? 'text-teal-700' : 'text-gray-700'}>Leads</span>
        </div>
        <div
          className={`rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer ${
            currentPage === 'pretherapy' ? 'text-teal-700' : 'text-gray-700 hover:bg-gray-100'
          }`}
          style={{ backgroundColor: currentPage === 'pretherapy' ? '#2D75795C' : 'transparent' }}
          onClick={() => setCurrentPage('pretherapy')}
        >
          <ClipboardCheck className="w-5 h-5 flex-shrink-0" />
          <span className={currentPage === 'pretherapy' ? 'text-teal-700' : 'text-gray-700'}>Pre-therapy Bookings</span>
        </div>
        <div
          className={`rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer ${
            currentPage === 'audit-logs' ? 'text-teal-700' : 'text-gray-700 hover:bg-gray-100'
          }`}
          style={{ backgroundColor: currentPage === 'audit-logs' ? '#2D75795C' : 'transparent' }}
          onClick={() => setCurrentPage('audit-logs')}
        >
          <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <span className={currentPage === 'audit-logs' ? 'text-teal-700' : 'text-gray-700'}>Audit Logs</span>
        </div>
      </nav>

      <div className="p-4 border-t relative" ref={profileMenuRef}>
        {/* Profile Dropdown Menu */}
        {showProfileMenu && (
          <div className="absolute bottom-full left-4 right-4 mb-2 bg-white border rounded-lg shadow-lg z-50">
            <button
              onClick={() => {
                setShowProfileMenu(false)
                setCurrentPage('settings')
              }}
              className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3 border-b"
            >
              <User size={18} className="text-gray-600" />
              <span className="text-sm font-medium">Edit Profile</span>
            </button>
            <button
              onClick={() => {
                setShowProfileMenu(false)
                setCurrentPage('changePassword')
              }}
              className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3"
            >
              <Eye size={18} className="text-gray-600" />
              <span className="text-sm font-medium">Change/Forgot Password</span>
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 rounded-lg p-3 cursor-pointer hover:bg-gray-100" style={{ backgroundColor: '#2D757930' }} onClick={() => setShowProfileMenu(!showProfileMenu)}>
          {profilePictureUrl ? (
            <img 
              src={profilePictureUrl} 
              alt="Profile" 
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 bg-orange-400 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {currentUser?.full_name ? currentUser.full_name.charAt(0).toUpperCase() : 'A'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900">{currentUser?.full_name || currentUser?.username || 'User'}</div>
            <div className="text-xs text-gray-600">Role: {currentUser?.role ? currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1) : 'Admin'}</div>
          </div>
          <button className="text-red-500 hover:text-red-600 flex-shrink-0" title="Logout" onClick={(e) => {
            e.stopPropagation()
            if (onLogout) {
              onLogout()
            } else {
              localStorage.removeItem('isLoggedIn')
              localStorage.removeItem('user')
              window.location.href = '/'
            }
          }}>
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default Sidebar
