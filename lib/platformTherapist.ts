// The "SafeStories" therapist row is not a person — it is the platform's own
// calendar host, used for free consultations. Booking, calendar and OAuth flows
// are all keyed on the stored id/name "SafeStories", so it is only ever renamed
// for display; nothing here may be used to write back to the database.
//
// Note: components/AllTherapists.tsx carries an older display name for the same
// row ("SafeStories Free Consultation"). That page is untouched; these helpers
// are scoped to the Settings pages.
export const PLATFORM_THERAPIST_ID = 'SafeStories';
export const PLATFORM_DISPLAY_NAME = 'Free Consultation';

/** The stored name casing varies by table ("SafeStories" vs "Safestories"). */
export const isPlatformTherapist = (
  name?: string | null,
  id?: string | null
): boolean => {
  if (id && String(id).toLowerCase() === PLATFORM_THERAPIST_ID.toLowerCase()) return true;
  return (name || '').trim().toLowerCase() === PLATFORM_THERAPIST_ID.toLowerCase();
};

export const displayTherapistName = (
  name?: string | null,
  id?: string | null
): string => (isPlatformTherapist(name, id) ? PLATFORM_DISPLAY_NAME : name || '');
