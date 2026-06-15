# 3-Feature Implementation Roadmap

**Date:** June 13, 2026  
**Status:** In Progress  
**Priority:** High

---

## **Feature 1: SendBookingModal - Therapist Filtering by Specialty ✅**

### **Status:** ALREADY IMPLEMENTED

**Location:** `components/SendBookingModal.tsx` (lines 313-317)

**Current Implementation:**
```typescript
const filteredTherapists = therapyType
  ? therapists.filter(therapist => 
      therapist.specialization?.toLowerCase().includes(therapyType.toLowerCase())
    )
  : therapists;
```

**What Works:**
- When therapy type is selected, therapists are filtered by specialization
- Individual → Shows Individual-specialized therapists
- Couples → Shows Couples-specialized therapists
- Adolescent → Shows Adolescent-specialized therapists

**Status:** ✅ COMPLETE - No changes needed

---

## **Feature 2: TherapistDashboard - Google Calendar Connection Gate**

### **Status:** IN PROGRESS

### **Requirements:**
1. Disable public booking page when Google Calendar NOT connected
2. After successful connection, show lightbox saying "Set your availability"
3. Provide button to navigate to "My Availability" page
4. Prevent booking creation until availability is set

### **Implementation Plan:**

**Step 1: Add state for post-connection lightbox**
```typescript
const [showPostConnectLightbox, setShowPostConnectLightbox] = useState(false);
```

**Step 2: Trigger lightbox on successful connection** (Line 147)
```typescript
if (googleAuth === 'success') {
  login({ ...user, google_calendar_connected: true });
  setShowPostConnectLightbox(true);  // ← NEW
  setToast({ message: 'Google Calendar connected successfully!', type: 'success' });
}
```

**Step 3: Add lightbox component**
```typescript
{showPostConnectLightbox && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg p-8 max-w-md">
      <h2 className="text-2xl font-bold mb-4">Set Your Availability</h2>
      <p className="text-gray-600 mb-6">
        Before clients can book with you, please set your availability schedule.
      </p>
      <button
        onClick={() => {
          setShowPostConnectLightbox(false);
          setActiveView('availability');
        }}
        className="w-full bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700"
      >
        Set Availability Now
      </button>
      <button
        onClick={() => setShowPostConnectLightbox(false)}
        className="w-full mt-3 bg-gray-200 text-gray-800 py-2 rounded-lg"
      >
        I'll do this later
      </button>
    </div>
  </div>
)}
```

**Step 4: Disable public booking if calendar not connected**
- Add check in booking creation: If `!user.google_calendar_connected`, show warning
- Hide/disable public booking link generation button

### **Affected Files:**
- `components/TherapistDashboard.tsx`
- Possibly `components/PublicBookingContainer.tsx` (for the gate)

---

## **Feature 3: CreateBooking - Client Selection First with Auto-fetch**

### **Status:** IN PROGRESS

### **Requirements:**
1. Make client selection FIRST (mandatory)
2. If existing client selected → Auto-fetch:
   - Therapy type
   - Therapist (based on therapy type)
   - Session mode
3. If new client → Admin fills all details manually

### **Current Structure:**
- `components/CreateBooking.tsx`
- Already has `clients` state and dropdown
- Already has client selection logic

### **Implementation Plan:**

**Step 1: Reorder form sections**
- Move client selection to TOP
- Make it required (red asterisk)
- Show message: "Select an existing client or add a new one"

**Step 2: Add "existing vs new" toggle**
```typescript
const [isNewClient, setIsNewClient] = useState(false);

{!isNewClient ? (
  // Existing client selection
  <select value={selectedClientId} onChange={handleClientSelect}>
    <option>Select Client...</option>
    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
  </select>
) : (
  // New client form
  <>
    <input placeholder="Client Name" />
    <input placeholder="Email" />
    <input placeholder="Phone" />
  </>
)}
```

**Step 3: Auto-fetch when existing client selected**
```typescript
const handleExistingClientSelect = (clientId: string) => {
  const client = clients.find(c => c.id === clientId);
  if (client) {
    setClientName(client.name);
    setClientEmail(client.email);
    
    // Auto-fetch from client's last booking
    const lastBooking = client.lastBooking; // API should include this
    
    setSelectedTherapy(lastBooking?.therapy_type || '');
    setSelectedTherapist(lastBooking?.therapist_name || '');
    setSessionMode(lastBooking?.mode || 'online');
  }
};
```

**Step 4: API changes needed**
- `/api/clients` endpoint should return `lastBooking` data with:
  - `therapy_type`
  - `therapist_name`
  - `mode`

**Step 5: Form flow**
```
1. Select Existing Client (mandatory)
   ↓
2. Auto-fills: Therapy Type, Therapist, Mode (if previous booking exists)
   ↓
3. Admin can override if needed
   ↓
4. Select Date/Time
   ↓
5. Select Slot
   ↓
6. Create Booking
```

### **Affected Files:**
- `components/CreateBooking.tsx`
- `components/CreateBookingModal.tsx` (if used for modal)
- Backend: `/api/clients` endpoint (need to include lastBooking)

---

## **Implementation Priority**

### **Phase 1 (Current)**
- Feature 1: ✅ Already done - Verify it works
- Feature 2: 🔄 In progress - Google Calendar gate + lightbox
- Feature 3: 🔄 In progress - Client selection first + auto-fetch

### **Phase 2 (Next)**
- Backend API updates to support auto-fetch
- Form reordering in CreateBooking
- Testing across all flows

### **Phase 3 (Final)**
- Integration testing
- User testing
- Production deployment

---

## **Testing Checklist**

### **Feature 1 Tests**
- [ ] Select "Individual" therapy → See Individual therapists only
- [ ] Select "Couples" therapy → See Couples therapists only
- [ ] Select "Adolescent" therapy → See Adolescent therapists only
- [ ] Switch therapies → Therapist list updates correctly

### **Feature 2 Tests**
- [ ] Without Google Calendar connected → Cannot create bookings (blocked)
- [ ] With Google Calendar connected → Can create bookings
- [ ] Click "Connect Calendar" → After success, see "Set Availability" lightbox
- [ ] Click "Set Availability" → Navigate to My Availability page
- [ ] Click "I'll do this later" → Lightbox closes, but availability check remains

### **Feature 3 Tests**
- [ ] Open create booking form → Client selection is first field
- [ ] Select existing client with history → Auto-populate therapy/therapist/mode
- [ ] Select existing client without history → Show empty selections
- [ ] Toggle "New Client" → Show manual entry fields
- [ ] Fill new client details → Continue with booking
- [ ] Admin can override auto-filled fields → Should allow changes

---

## **Files Modified**

| File | Feature | Status |
|------|---------|--------|
| SendBookingModal.tsx | 1 | ✅ Complete |
| TherapistDashboard.tsx | 2 | 🔄 In Progress |
| CreateBooking.tsx | 3 | 🔄 In Progress |
| CreateBookingModal.tsx | 3 | 📋 Planned |

---

## **Backend Changes Required**

### **For Feature 3 Auto-fetch**

**Endpoint:** `GET /api/clients`  
**New Response Format:**
```json
[
  {
    "id": "client_123",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "lastBooking": {
      "therapy_type": "Individual",
      "therapist_name": "Dr. Smith",
      "mode": "online",
      "booking_id": "booking_456"
    }
  }
]
```

---

## **Notes**

- Feature 1 is already implemented and working
- Features 2 & 3 require careful implementation to avoid breaking existing functionality
- All changes must be backward compatible
- Testing required across all user flows

---

**Next Step:** Implement Feature 2 (Google Calendar gate) and Feature 3 (Client selection + auto-fetch)
