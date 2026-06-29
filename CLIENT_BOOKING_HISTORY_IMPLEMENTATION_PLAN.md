# Client Booking History - Restricted Booking Implementation Plan

**Date:** June 13, 2026  
**Status:** Ready for Implementation  
**Scope:** 3 Forms + 1 Backend Endpoint  

---

## Feature Overview

When admin creates a new booking/booking link/followup link for an **existing client**, the form will:
1. **Auto-populate** client details
2. **Restrict therapy dropdown** to only therapies client has previously booked
3. **Restrict therapist dropdown** to only therapists client has previously booked with
4. **Auto-select booking mode** from client's most recent booking
5. **Show helpful message** if client has no booking history

**Example:**
- Client: "John Doe" (invitee_id: 10101)
- History: Booked "Individual" therapy with "Muskan" in "Google Meet" mode (3 times)
- Future booking form will show:
  - Therapy dropdown: **Only "Individual"** (auto-selected)
  - Therapist dropdown: **Only "Muskan"** (auto-selected)
  - Mode: **"Google Meet"** (auto-selected)
  - Cannot select "Couples" or "Dr. Smith" (client never used them)

---

## Implementation Details

### **Phase 1: Backend - New Endpoint**

**Endpoint:** `GET /api/client-booking-history/:clientId`

**Purpose:** Fetch all unique therapies, therapists, and booking modes for a specific client

**Query Logic:**
```sql
SELECT 
  DISTINCT booking_resource_name as therapy,
  booking_host_name as therapist,
  booking_mode as mode
FROM bookings
WHERE invitee_id = $1 
  AND booking_status NOT IN ('cancelled', 'canceled', 'no_show', 'no show')
ORDER BY booking_start_at DESC
```

**Response Structure:**
```json
{
  "clientId": "invitee_10101",
  "clientName": "John Doe",
  "therapies": ["Individual", "Couples"],
  "therapists": ["Muskan", "Dr. Smith", "Aastha"],
  "modes": ["Online", "In-Person"],
  "lastBooking": {
    "therapy": "Individual",
    "therapist": "Muskan",
    "mode": "Online",
    "date": "2026-06-10T10:30:00Z"
  },
  "totalBookings": 5
}
```

**Location:** Add to `panel-backend/src/index.ts` (after `/api/clients` endpoint, around line 2980)

---

### **Phase 2: Frontend - State & Functions**

**New State Variables (add to each form):**
```typescript
const [clientBookingHistory, setClientBookingHistory] = useState<any>(null);
const [allowedTherapies, setAllowedTherapies] = useState<string[]>([]);
const [allowedTherapists, setAllowedTherapists] = useState<string[]>([]);
const [isLoadingHistory, setIsLoadingHistory] = useState(false);
```

**New Function (add to each form):**
```typescript
const handleExistingClientSelect = async (client: any) => {
  try {
    setIsLoadingHistory(true);
    
    // Fetch client's booking history
    const response = await fetch(`/api/client-booking-history/${client.invitee_id}`);
    const history = await response.json();
    
    setClientBookingHistory(history);
    setAllowedTherapies(history.therapies);
    setAllowedTherapists(history.therapists);
    
    // Auto-select from last booking
    if (history.lastBooking) {
      setSelectedTherapy(history.lastBooking.therapy);
      setSelectedTherapist(history.lastBooking.therapist);
      const mode = history.lastBooking.mode?.toLowerCase().includes('online') 
        ? 'online' 
        : 'in-person';
      setSessionMode(mode);
    }
    
    setIsLoadingHistory(false);
  } catch (error) {
    console.error('Error fetching booking history:', error);
    setIsLoadingHistory(false);
  }
};
```

---

### **Phase 3: Frontend - Dropdown Rendering**

**Therapy Dropdown:**
```typescript
<select 
  value={selectedTherapy}
  onChange={(e) => setSelectedTherapy(e.target.value)}
  disabled={!clientBookingHistory || isLoadingHistory}
>
  <option value="">
    {isLoadingHistory ? 'Loading...' : 'Select Therapy'}
  </option>
  
  {allowedTherapies.length > 0 ? (
    allowedTherapies.map(therapy => (
      <option key={therapy} value={therapy}>
        {therapy}
      </option>
    ))
  ) : clientBookingHistory ? (
    <option disabled>No therapy history found</option>
  ) : null}
</select>
```

**Therapist Dropdown:**
```typescript
<select 
  value={selectedTherapist}
  onChange={(e) => setSelectedTherapist(e.target.value)}
  disabled={!clientBookingHistory || isLoadingHistory}
>
  <option value="">
    {isLoadingHistory ? 'Loading...' : 'Select Therapist'}
  </option>
  
  {allowedTherapists.length > 0 ? (
    allowedTherapists.map(therapist => (
      <option key={therapist} value={therapist}>
        {therapist}
      </option>
    ))
  ) : clientBookingHistory ? (
    <option disabled>No therapist history found</option>
  ) : null}
</select>
```

**Info Message (below client selection):**
```typescript
{clientBookingHistory && (
  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3 text-sm text-blue-800">
    ✓ {clientBookingHistory.clientName} has {clientBookingHistory.totalBookings} booking(s)
    <br/>
    Last booking: {clientBookingHistory.lastBooking.therapy} with {clientBookingHistory.lastBooking.therapist}
  </div>
)}
```

---

### **Phase 4: Forms to Update**

#### **1. CreateBooking.tsx**
**Location:** Update `handleClientSelect()` function (line 246+)
- Add logic to call `handleExistingClientSelect()`
- Replace therapy/therapist dropdowns with restricted versions
- Add info message

#### **2. CreateBookingLink.tsx** 
**Location:** Similar client select handler (find via grep)
- Add same logic as CreateBooking.tsx
- Restrict dropdowns identically

#### **3. SendFollowupLink.tsx**
**Location:** Similar client select handler (find via grep)
- Add same logic as CreateBooking.tsx
- Restrict dropdowns identically

---

## Data Flow Diagram

```
Admin enters client name
        ↓
Selects existing client from dropdown
        ↓
handleExistingClientSelect() called
        ↓
Fetch /api/client-booking-history/:clientId
        ↓
Receive: therapies[], therapists[], modes[], lastBooking
        ↓
Set state: allowedTherapies, allowedTherapists
        ↓
Auto-select: selectedTherapy, selectedTherapist, sessionMode
        ↓
Render dropdowns with ONLY allowed options
        ↓
Admin cannot select outside client's history
```

---

## Behavior Table

| Scenario | Therapy Dropdown | Therapist Dropdown | Mode | Behavior |
|----------|------------------|-------------------|------|----------|
| **Existing client with history** | Restricted to history | Restricted to history | Auto-selected | ✅ Normal flow |
| **Existing client, no history** | "No therapy history" | "No therapist history" | Empty | ⚠️ Show message: "No previous bookings" |
| **New client** | All therapies | All therapists | Empty | ✅ Normal flow |
| **Loading** | Disabled, "Loading..." | Disabled, "Loading..." | Empty | ⏳ Show spinner |

---

## Error Handling

1. **API call fails**: Show toast error, keep dropdowns enabled with all options
2. **Client has no bookings**: Show message, allow admin to select any therapy/therapist
3. **Network timeout**: Retry with exponential backoff, fallback to all options
4. **Invalid client ID**: Return empty history, show message

---

## Testing Checklist

- [ ] Client with 1 previous booking: Dropdowns restricted to 1 option each
- [ ] Client with 5 previous bookings with 3 different therapists: Dropdowns show all 3
- [ ] Client with no bookings: Dropdowns show all available options + message
- [ ] New client: Dropdowns show all available options
- [ ] API network error: Fallback to all options with error toast
- [ ] Loading state: Spinners shown, dropdowns disabled
- [ ] Auto-selection: Values pre-filled before user interaction
- [ ] Manual override: Admin can change pre-filled values
- [ ] All 3 forms work identically

---

## Implementation Order

1. **Step 1:** Create backend endpoint `GET /api/client-booking-history/:clientId`
2. **Step 2:** Update CreateBooking.tsx with new logic
3. **Step 3:** Update CreateBookingLink.tsx with same logic
4. **Step 4:** Update SendFollowupLink.tsx with same logic
5. **Step 5:** Test all 3 forms
6. **Step 6:** Commit and push

---

## Success Criteria

✅ When admin selects existing client, therapy/therapist dropdowns auto-restrict  
✅ Last booking mode is auto-selected  
✅ Admin cannot select therapies/therapists client never used  
✅ Works identically across all 3 forms  
✅ New clients still work normally (no restrictions)  
✅ Handles edge cases (no history, API errors) gracefully  
✅ 100% backward compatible  

---

**Ready to implement?** 🚀
