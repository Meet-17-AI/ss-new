import React, { useEffect, useState } from 'react';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import { handoffToCrm, CRM_APP_URL } from '../lib/permissions';

/**
 * Sends anyone who lands on /crm to the real CRM, which is a separate
 * application on its own origin.
 *
 * The panel used to embed a copy of the CRM here. That copy is gone — there is
 * one CRM now — but the ROUTE has to stay, and not merely as a tidy-up. A sales
 * account's default destination is /crm: deleting the route would drop them onto
 * the catch-all, which redirects to "/", which computes their default as /crm
 * again. An endless bounce, and the only users affected would be the ones who
 * live in the CRM full time.
 *
 * So this route resolves the loop by leaving the origin entirely, carrying the
 * session with a one-time ticket.
 */
export const CrmRedirect: React.FC = () => {
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    handoffToCrm().catch((e: any) => {
      if (!cancelled) setError(e?.message || 'Could not open the CRM.');
    });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-sm text-center">
          <AlertTriangle size={28} className="mx-auto mb-3 text-rose-500" />
          <h1 className="text-lg font-semibold text-gray-900">Could not open the CRM</h1>
          <p className="mt-2 text-sm text-gray-600">{error}</p>
          {/* A way through even when the handoff itself failed — they can sign in
              on the CRM directly rather than being stuck here. */}
          <a
            href={CRM_APP_URL}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5
                       text-sm font-semibold text-white transition-colors hover:bg-teal-800"
          >
            Open the CRM <ExternalLink size={15} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
        <p className="text-sm text-gray-500">Opening the CRM…</p>
      </div>
    </div>
  );
};

export default CrmRedirect;
