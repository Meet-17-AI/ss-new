# Profile Picture Storage & Display Guide

## How Profile Images Work:

### 1. Storage Flow:

```
User Uploads Image
       ↓
Frontend sends to /api/upload-file
       ↓
Backend uploads to MinIO
       ↓
MinIO returns URL: https://s3.srv1169280.hstgr.cloud:443/safestories-panel/profile-pictures/1707567890-profile.jpg
       ↓
URL saved in database (therapists.profile_picture_url column)
       ↓
Frontend fetches URL from database
       ↓
Display image using <img src={url} />
```

### 2. Database Storage:

**Table**: `therapists`
**Column**: `profile_picture_url` (TEXT)
**Example Value**: `https://s3.srv1169280.hstgr.cloud:443/safestories-panel/profile-pictures/1707567890-profile.jpg`

**Note**: We store the URL, NOT the actual image file. The image file is stored in MinIO.

### 3. Where Profile Pictures Are Displayed:

#### ✅ A. Therapist Dashboard Header
**Location**: `components/TherapistDashboard.tsx`
**Display**:
- Shows profile picture next to "Welcome Back" message
- If no picture: Shows default avatar icon (User icon in teal circle)
- Size: 64x64px, rounded circle
- Border: 2px teal border

**Code**:
```tsx
{profilePictureUrl ? (
  <img 
    src={profilePictureUrl} 
    alt={user.username}
    className="w-16 h-16 rounded-full object-cover border-2 border-teal-700"
  />
) : (
  <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center border-2 border-teal-700">
    <User size={32} className="text-teal-700" />
  </div>
)}
```

#### ✅ B. Settings Page - Profile Settings
**Location**: `components/TherapistSettings.tsx`
**Display**:
- Shows current profile picture when viewing profile
- Shows preview of newly selected image before upload
- Allows uploading new picture

**Code** (already implemented):
```tsx
{currentProfilePictureUrl && !profilePicture && (
  <div className="flex items-center gap-2 mb-2">
    <img 
      src={currentProfilePictureUrl} 
      alt="Current profile" 
      className="w-16 h-16 rounded-full object-cover"
    />
    <button onClick={() => setCurrentProfilePictureUrl('')}>
      <X size={16} />
    </button>
  </div>
)}
```

### 4. Additional Places to Display (Future):

#### 📋 C. Sidebar/Navigation (Optional)
Could show small profile picture in sidebar next to therapist name

#### 📋 D. Session Notes (Optional)
Could show therapist profile picture when viewing session notes

#### 📋 E. Admin Dashboard - All Therapists View (Optional)
Could show profile pictures in therapist list

### 5. How to Fetch Profile Picture:

```typescript
// Fetch therapist profile
const response = await fetch(`/api/therapist-profile?therapist_id=${therapist_id}`);
const data = await response.json();

if (data.success && data.data.profile_picture_url) {
  setProfilePictureUrl(data.data.profile_picture_url);
}
```

### 6. How to Display Profile Picture:

```tsx
{profilePictureUrl ? (
  <img 
    src={profilePictureUrl} 
    alt="Profile"
    className="w-16 h-16 rounded-full object-cover"
  />
) : (
  <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
    <User size={24} className="text-gray-500" />
  </div>
)}
```

### 7. Image Specifications:

- **Max Size**: 2MB
- **Formats**: JPG, PNG, WebP
- **Recommended Dimensions**: 400x400px or higher (square)
- **Display Size**: Usually 64x64px (rounded circle)
- **Storage**: MinIO bucket at `safestories-panel/profile-pictures/`

### 8. Security & Access:

- Images are stored in MinIO with public read access
- URLs are accessible without authentication
- Only therapists can upload/update their own profile pictures
- File size and type validation on both frontend and backend

### 9. Fallback Behavior:

If no profile picture is set:
- Show default avatar icon (User icon)
- Use teal background color (#21615D)
- Same size and shape as profile picture

### 10. Testing:

1. **Upload Profile Picture**:
   - Login as therapist
   - Go to Settings → Profile Settings
   - Upload a profile picture (JPG/PNG, < 2MB)
   - Click "Save Profile Changes"
   - Verify success message

2. **View Profile Picture**:
   - Go back to Dashboard
   - Profile picture should appear in header
   - Should be circular with teal border

3. **Update Profile Picture**:
   - Go to Settings → Profile Settings
   - Upload a different picture
   - Click "Save Profile Changes"
   - Go back to Dashboard
   - New picture should appear

4. **No Profile Picture**:
   - If therapist hasn't uploaded picture
   - Should see default User icon in teal circle

### 11. Troubleshooting:

**Image not displaying?**
- Check browser console for errors
- Verify URL is accessible (paste in browser)
- Check MinIO console to verify file exists
- Verify database has correct URL

**Image too large?**
- Frontend validates max 2MB
- Backend enforces 5MB limit
- Use image compression if needed

**Wrong image format?**
- Only JPG, PNG, WebP allowed
- Convert image to supported format

## Summary:

✅ Profile pictures are stored as URLs in database
✅ Actual images stored in MinIO bucket
✅ Displayed in Therapist Dashboard header
✅ Displayed in Settings page
✅ Default avatar shown if no picture
✅ Circular display with teal border
✅ 64x64px display size
