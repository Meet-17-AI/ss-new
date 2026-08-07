// Stored media URLs predate the MinIO host move and still point at the retired
// s3.fluidjobs.ai box. Rewrite on read so old rows keep rendering; new uploads
// already carry the current host and pass through untouched.
const LEGACY_HOST_WITH_PORT = 's3.fluidjobs.ai:9002';
const LEGACY_HOST = 's3.fluidjobs.ai';
const CURRENT_HOST_WITH_PORT = 's3.srv1169280.hstgr.cloud:443';
const CURRENT_HOST = 's3.srv1169280.hstgr.cloud';

export const resolveMediaUrl = (url?: string | null): string => {
  if (!url) return '';
  return url
    .replace(LEGACY_HOST_WITH_PORT, CURRENT_HOST_WITH_PORT)
    .replace(LEGACY_HOST, CURRENT_HOST);
};

/** Initials fallback for avatars with no stored picture. */
export const initialsFor = (name?: string | null): string =>
  (name || 'Unknown')
    .trim()
    .split(/\s+/)
    .map(part => part[0] || '')
    .join('')
    .substring(0, 2)
    .toUpperCase();
