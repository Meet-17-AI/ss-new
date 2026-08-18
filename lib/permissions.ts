/**
 * UI-side copies of permission rules the server enforces.
 *
 * These decide whether a control is worth SHOWING. The server decides whether
 * the action is allowed — every rule here has a counterpart in
 * panel-backend/src/index.ts, and that one is the control.
 */

/**
 * Who may disconnect a Google Calendar. Mirrors CALENDAR_DISCONNECT_USERS on the
 * backend.
 *
 * Not a role check: the AI team signs in as `admin`, the same role as the clinic
 * admins it has to be told apart from. Admins and therapists may still CONNECT a
 * calendar — only breaking an existing link is reserved, because a dropped
 * refresh token stops bookings syncing with nothing on screen to explain it.
 */
const CALENDAR_DISCONNECT_USERS = ['aiteam@fluid.live', 'aiteam'];

export const canDisconnectCalendar = (user: any): boolean =>
  Boolean(user) &&
  [user?.email, user?.username].some(
    (id: any) => id && CALENDAR_DISCONNECT_USERS.includes(String(id).toLowerCase())
  );
