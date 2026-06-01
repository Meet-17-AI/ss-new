import React, { useState, useEffect } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import { Calendar as CalendarIcon } from 'lucide-react';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './Calendar.css';
import { Loader } from './Loader';
import { Toast } from './Toast';

interface Appointment {
  invitee_name: string;
  booking_resource_name: string;
  booking_start_at: string; // This is the formatted time string
  booking_start_at_raw?: string; // This is the raw timestamp
  booking_host_name?: string;
  booking_status?: string;
  has_session_notes?: boolean;
  booking_mode?: string;
  booking_id?: string;
  invitee_email?: string;
  invitee_phone?: string;
  therapist_id?: string | null;
  booking_joining_link?: string;
  // Additional properties for therapist dashboard
  client_name?: string;
  mode?: string;
  session_timings?: string;
  session_name?: string;
  therapy_type?: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: {
    therapist: string;
    client: string;
    mode: string;
    status: string;
    sessionType: string;
    originalAppointment: Appointment;
  };
}

const localizer = momentLocalizer(moment);

interface TherapistCalendarProps {
  therapists: any[];
  selectedTherapistFilters: string[];
  selectedModeFilter: 'all' | 'online' | 'in-person';
  statusFilter?: 'all' | 'upcoming' | 'cancelled' | 'completed';
  sessionTypeFilter?: 'all' | 'individual' | 'couples' | 'free_consultation';
  therapistId?: number;
}

export const TherapistCalendar: React.FC<TherapistCalendarProps> = ({ 
  therapists, 
  selectedTherapistFilters, 
  selectedModeFilter,
  statusFilter = 'all',
  sessionTypeFilter = 'all',
  therapistId
}) => {
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  // Calendar view state
  const [currentView, setCurrentView] = useState<'month' | 'week' | 'day'>('month');
  const [currentDate, setCurrentDate] = useState(new Date()); // Current month

  // Event modal state
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);

  // Day sessions modal state
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDaySessionsModal, setShowDaySessionsModal] = useState(false);
  const [daySessionsEvents, setDaySessionsEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    fetchAllAppointments();
  }, []);

  useEffect(() => {
    if (allAppointments.length > 0) {
      convertAppointmentsToEvents();
    }
  }, [allAppointments, selectedTherapistFilters, selectedModeFilter, statusFilter, sessionTypeFilter]);

  const fetchAllAppointments = async () => {
    try {
      setCalendarLoading(true);
      
      // Use therapist-specific endpoint if therapistId is provided
      const endpoint = therapistId 
        ? `/api/therapist-appointments?therapist_id=${therapistId}`
        : '/api/appointments';
      
      const response = await fetch(endpoint);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      
      const data = await response.json();
      
      // Handle different response structures
      const appointmentsArray = therapistId ? (data.appointments || []) : (Array.isArray(data) ? data : []);
      
      if (Array.isArray(appointmentsArray)) {
        setAllAppointments(appointmentsArray);
      } else {
        setAllAppointments([]);
        setToast({ message: 'Invalid appointment data received', type: 'error' });
      }
    } catch (error) {
      console.error('Error fetching all appointments:', error);
      setToast({ message: 'Failed to fetch appointments', type: 'error' });
      setAllAppointments([]);
    } finally {
      setCalendarLoading(false);
    }
  };

  const parseAppointmentTime = (timeString: string | null | undefined) => {
    // Check if timeString exists and is not empty
    if (!timeString || typeof timeString !== 'string') {
      return null;
    }

    // Parse formats like:
    // "Friday, Feb 27, 2026 at 4:30 PM - 4:45 PM IST"
    // "Monday, February 3, 2025 at 10:00 AM - 11:00 AM"
    const match = timeString.match(/(\w+,\s+\w+\s+\d+,\s+\d+)\s+at\s+(\d+:\d+\s+[AP]M)\s+-\s+(\d+:\d+\s+[AP]M)(?:\s+IST)?/);
    if (!match) {
      return null;
    }

    const [, dateStr, startTimeStr, endTimeStr] = match;
    
    try {
      // Try different date formats
      let startDateTime, endDateTime;
      
      // First try with full month name
      startDateTime = moment(`${dateStr} ${startTimeStr}`, 'dddd, MMMM D, YYYY h:mm A');
      endDateTime = moment(`${dateStr} ${endTimeStr}`, 'dddd, MMMM D, YYYY h:mm A');
      
      // If that fails, try with abbreviated month name
      if (!startDateTime.isValid() || !endDateTime.isValid()) {
        startDateTime = moment(`${dateStr} ${startTimeStr}`, 'dddd, MMM D, YYYY h:mm A');
        endDateTime = moment(`${dateStr} ${endTimeStr}`, 'dddd, MMM D, YYYY h:mm A');
      }
      
      if (startDateTime.isValid() && endDateTime.isValid()) {
        return {
          start: startDateTime.toDate(),
          end: endDateTime.toDate()
        };
      }
    } catch (error) {
      console.error('Error parsing time:', error);
    }
    
    return null;
  };

  const convertAppointmentsToEvents = () => {
    const events: CalendarEvent[] = [];
    
    if (!allAppointments || allAppointments.length === 0) {
      setCalendarEvents([]);
      return;
    }
    
    allAppointments.forEach((apt, index) => {
      try {
        // Skip if appointment is missing required data
        if (!apt || (!apt.invitee_name && !apt.client_name)) {
          return;
        }

        // Apply therapist filter (skip if therapistId is provided since API already filters)
        if (!therapistId && selectedTherapistFilters.length > 0 && 
            !selectedTherapistFilters.some(filter => apt.booking_host_name?.includes(filter))) {
          return;
        }

        // Apply mode filter
        const mode = apt.booking_mode?.toLowerCase() || apt.mode?.toLowerCase() || 'google meet';
        const isOnline = mode.includes('google') || mode.includes('meet') || mode.includes('online') || mode === 'google meet';
        const isInPerson = mode.includes('person') || mode.includes('office') || mode.includes('clinic') || mode.includes('in person');
        
        if (selectedModeFilter === 'online' && !isOnline) return;
        if (selectedModeFilter === 'in-person' && !isInPerson) return;

        // Apply status filter
        const appointmentStatus = apt.booking_status || 'confirmed';
        if (statusFilter !== 'all') {
          if (statusFilter === 'upcoming' && (appointmentStatus === 'cancelled' || appointmentStatus === 'completed')) return;
          if (statusFilter === 'cancelled' && appointmentStatus !== 'cancelled') return;
          if (statusFilter === 'completed' && appointmentStatus !== 'completed' && !apt.has_session_notes) return;
        }

        // Apply session type filter
        const sessionType = apt.session_name || apt.booking_resource_name || apt.therapy_type || 'Session';
        const sessionTypeLower = sessionType.toLowerCase();
        
        if (sessionTypeFilter !== 'all') {
          if (sessionTypeFilter === 'individual' && !sessionTypeLower.includes('individual')) return;
          if (sessionTypeFilter === 'couples' && !sessionTypeLower.includes('couples')) return;
          if (sessionTypeFilter === 'free_consultation' && !sessionTypeLower.includes('free consultation')) return;
        }

        // Determine start and end times
        let timeData: { start: Date; end: Date } | null = null;
        
        // 1. First try parsing the formatted string to get both start and precise end times
        const timeString = apt.session_timings || apt.booking_start_at;
        timeData = parseAppointmentTime(timeString);
        
        // 2. If parsing the string failed, fallback to raw timestamp (if available)
        if (!timeData) {
          const rawTimestamp = apt.booking_start_at_raw || apt.booking_date;
          const isIsoDate = (str: string) => moment(str, moment.ISO_8601, true).isValid() || moment(str).isValid();
          
          if (rawTimestamp && isIsoDate(rawTimestamp)) {
            timeData = {
              start: moment(rawTimestamp).toDate(),
              end: moment(rawTimestamp).add(50, 'minutes').toDate()
            };
          } else if (apt.booking_start_at && isIsoDate(apt.booking_start_at)) {
            // In therapist-appointments, booking_start_at is the raw timestamp
            timeData = {
              start: moment(apt.booking_start_at).toDate(),
              end: moment(apt.booking_start_at).add(50, 'minutes').toDate()
            };
          }
        }

        if (!timeData) {
          return; // Skip if we completely failed to determine a valid time
        }

        const clientName = apt.invitee_name || apt.client_name || 'Unknown Client';

        const therapistName = therapistId && therapists.length > 0 ? therapists[0].name : (apt.booking_host_name || 'Unknown');
        
        const event: CalendarEvent = {
          id: `${index}-${clientName}-${Date.now()}`,
          title: `${clientName} - ${sessionType}`,
          start: timeData.start,
          end: timeData.end,
          resource: {
            therapist: therapistName,
            client: clientName,
            mode: isInPerson ? 'In-Person' : 'Online',
            status: appointmentStatus,
            sessionType: sessionType,
            originalAppointment: apt
          }
        };

        events.push(event);
      } catch (error) {
        console.error('Error processing appointment:', apt, error);
      }
    });

    setCalendarEvents(events);
  };

  const getEventStyle = (event: CalendarEvent) => {
    const { therapist, status } = event.resource;
    
    // Color by therapist (using new color palette)
    const therapistColors: { [key: string]: string } = {
      'Aastha': '#f93414',     // Scarlet Fire
      'Ambika': '#fe6c31',     // Atomic Tangerine
      'Anjali': '#feae6c',     // Sandy Brown
      'Indrayani': '#06889b',  // Pacific Cyan
      'Ishika': '#006b8f',     // Cerulean
      'Muskan': '#011f51',     // Deep Navy
    };

    // Get therapist first name for color matching
    const firstName = therapist.split(' ')[0];
    const backgroundColor = therapistColors[firstName] || '#6B7280'; // Default gray

    // Check if cancelled
    const isCancelled = status === 'cancelled' || status === 'canceled';

    return {
      style: {
        backgroundColor: backgroundColor,
        border: `2px solid ${backgroundColor}`,
        color: '#f1f5f9', // Light gray text
        fontSize: '12px',
        padding: '2px 4px'
      },
      className: isCancelled ? 'event-cancelled' : ''
    };
  };

  // Calendar navigation handlers
  const handleViewChange = (view: 'month' | 'week' | 'day') => {
    setCurrentView(view);
  };

  const handleNavigate = (date: Date) => {
    setCurrentDate(date);
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setShowEventModal(true);
  };

  const handleDoubleClickDate = (date: Date) => {
    // Get all events for the selected date
    const dateEvents = calendarEvents.filter(event => {
      const eventDate = moment(event.start).format('YYYY-MM-DD');
      const selectedDateStr = moment(date).format('YYYY-MM-DD');
      return eventDate === selectedDateStr;
    });

    setSelectedDate(date);
    setDaySessionsEvents(dateEvents);
    setShowDaySessionsModal(true);
  };

  const handleDoubleClickEvent = (event: CalendarEvent | { start: Date }) => {
    // Handle both calendar events and date selections
    const targetDate = 'resource' in event ? event.start : event.start;
    handleDoubleClickDate(targetDate);
  };

  const closeEventModal = () => {
    setShowEventModal(false);
    setSelectedEvent(null);
  };

  const closeDaySessionsModal = () => {
    setShowDaySessionsModal(false);
    setSelectedDate(null);
    setDaySessionsEvents([]);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden min-h-0">

      {/* Calendar Component - Scrollable */}
      {calendarLoading ? (
        <div className="flex-1 flex items-center justify-center min-h-0">
          <Loader />
        </div>
      ) : (
        <div className="flex-1 bg-white rounded-lg border flex flex-col min-h-0 overflow-hidden">
          {/* Calendar Content - Allow scrolling */}
          <div className="flex-1 min-h-0">
            {calendarEvents.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-gray-500">
                  <CalendarIcon size={48} className="mx-auto mb-4 text-gray-300" />
                  <h3 className="text-lg font-medium mb-2">No Sessions Found</h3>
                  <p className="text-sm">
                    {allAppointments.length === 0 
                      ? 'No appointments available to display'
                      : 'No sessions match the current filters'
                    }
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-full">
                <Calendar
                  localizer={localizer}
                  events={calendarEvents}
                  startAccessor="start"
                  endAccessor="end"
                  style={{ height: '100%' }}
                  eventPropGetter={getEventStyle}
                  onSelectEvent={handleSelectEvent}
                  onDoubleClickEvent={handleDoubleClickEvent}
                  onSelectSlot={({ start, action }) => {
                    if (action === 'doubleClick') {
                      handleDoubleClickEvent({ start } as any);
                    }
                  }}
                  onView={handleViewChange}
                  onNavigate={handleNavigate}
                  view={currentView}
                  date={currentDate}
                  views={['month', 'week', 'day']}
                  selectable
                  popup
                  showMultiDayTimes
                  step={30}
                  timeslots={2}
                  min={new Date(2025, 0, 1, 8, 0)} // 8 AM
                  max={new Date(2025, 0, 1, 22, 0)} // 10 PM
                  scrollToTime={new Date(2025, 0, 1, 9, 0)} // Scroll to 9 AM
                  dayLayoutAlgorithm="no-overlap"
                  tooltipAccessor={(event) => 
                    `${event.resource.client}\n${event.resource.sessionType}\nTherapist: ${event.resource.therapist}\nMode: ${event.resource.mode}\nStatus: ${event.resource.status}`
                  }
                  messages={{
                    next: "Next",
                    previous: "Previous", 
                    today: "Today",
                    month: "Month",
                    week: "Week", 
                    day: "Day",
                    agenda: "Agenda",
                    date: "Date",
                    time: "Time",
                    event: "Session",
                    noEventsInRange: "No sessions in this time range",
                    showMore: (total) => `+${total} more`
                  }}
                  components={{
                    event: ({ event }) => (
                      <div className="text-xs flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium">{event.resource.client}</div>
                          <div className="opacity-90">{event.resource.therapist}</div>
                        </div>
                        {event.resource.mode === 'Online' && event.resource.originalAppointment.booking_joining_link && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(event.resource.originalAppointment.booking_joining_link, '_blank');
                            }}
                            className="ml-1 p-0.5 hover:bg-white hover:bg-opacity-20 rounded-full transition-colors flex-shrink-0"
                            title="Open Google Meet Link"
                          >
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ),
                    month: {
                      dateHeader: ({ date, label }) => {
                        const isToday = moment(date).isSame(moment(), 'day');
                        return (
                          <div className="rbc-date-cell-header" style={{ textAlign: 'right', padding: '4px' }}>
                            {isToday ? (
                              <span 
                                style={{
                                  backgroundColor: '#2D75795C',
                                  color: 'black',
                                  borderRadius: '50%',
                                  width: '30px',
                                  height: '30px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontWeight: '600',
                                  fontSize: '14px'
                                }}
                              >
                                {label}
                              </span>
                            ) : (
                              <span>{label}</span>
                            )}
                          </div>
                        );
                      }
                    },
                    toolbar: ({ label, onNavigate, onView, view }) => (
                      <div className="rbc-toolbar">
                        {/* Left spacer for balance */}
                        <div className="flex-1"></div>

                        {/* Center - Navigation with arrows close to month name */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onNavigate('PREV')}
                            className="hover:text-gray-800 transition-colors"
                            title="Previous"
                          >
                            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          
                          <span className="rbc-toolbar-label">{label}</span>
                          
                          <button
                            type="button"
                            onClick={() => onNavigate('NEXT')}
                            className="hover:text-gray-800 transition-colors"
                            title="Next"
                          >
                            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>

                        {/* Right side - View buttons */}
                        <div className="flex-1 flex justify-end">
                          <div className="rbc-btn-group">
                            {['month', 'week', 'day'].map((viewName) => (
                              <button
                                key={viewName}
                                type="button"
                                onClick={() => onView(viewName as any)}
                                className={view === viewName ? 'rbc-active' : ''}
                              >
                                {viewName.charAt(0).toUpperCase() + viewName.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Event Details Modal */}
      {showEventModal && selectedEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={closeEventModal}>
          <div 
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-3">
                <div 
                  className="w-4 h-4 rounded-full"
                  style={{ 
                    backgroundColor: (() => {
                      const therapistColors: { [key: string]: string } = {
                        'Aastha': '#f93414', 'Ambika': '#fe6c31', 'Anjali': '#feae6c',
                        'Indrayani': '#06889b', 'Ishika': '#006b8f', 'Muskan': '#011f51'
                      };
                      const firstName = selectedEvent.resource.therapist.split(' ')[0];
                      return therapistColors[firstName] || '#6B7280';
                    })()
                  }}
                ></div>
                <h2 className="text-lg font-semibold text-gray-900">Session Details</h2>
              </div>
              <button
                onClick={closeEventModal}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4">
              {/* Event Title */}
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">
                  {selectedEvent.resource.sessionType}
                </h3>
                <p className="text-gray-600">
                  {moment(selectedEvent.start).format('dddd, MMMM D, YYYY')}
                </p>
              </div>

              {/* Event Details */}
              <div className="space-y-3">
                {/* Time */}
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="font-medium text-gray-900">
                      {moment(selectedEvent.start).format('h:mm A')} - {moment(selectedEvent.end).format('h:mm A')}
                    </p>
                    <p className="text-sm text-gray-500">
                      {Math.round((selectedEvent.end.getTime() - selectedEvent.start.getTime()) / (1000 * 60))} minutes
                    </p>
                  </div>
                </div>

                {/* Client */}
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <div>
                    <p className="font-medium text-gray-900">{selectedEvent.resource.client}</p>
                    <p className="text-sm text-gray-500">Client</p>
                  </div>
                </div>

                {/* Therapist */}
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-5 0H3m2 0h3M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 8h1m-1-4h1m4 4h1m-1-4h1" />
                  </svg>
                  <div>
                    <p className="font-medium text-gray-900">{selectedEvent.resource.therapist}</p>
                    <p className="text-sm text-gray-500">Therapist</p>
                  </div>
                </div>

                {/* Mode */}
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9" />
                  </svg>
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="font-medium text-gray-900">{selectedEvent.resource.mode}</p>
                      <p className="text-sm text-gray-500">Session Mode</p>
                    </div>
                    {selectedEvent.resource.mode === 'Online' && selectedEvent.resource.originalAppointment.booking_joining_link && (
                      <button
                        onClick={() => window.open(selectedEvent.resource.originalAppointment.booking_joining_link, '_blank')}
                        className="ml-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
                        title="Open Google Meet Link"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Join Now
                      </button>
                    )}
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                      selectedEvent.resource.status === 'completed' ? 'bg-green-100 text-green-800' :
                      selectedEvent.resource.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      selectedEvent.resource.status === 'no_show' ? 'bg-orange-100 text-orange-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {selectedEvent.resource.status === 'no_show' ? 'No Show' : 
                       selectedEvent.resource.status?.charAt(0).toUpperCase() + selectedEvent.resource.status?.slice(1)}
                    </span>
                  </div>
                </div>
              </div>
            </div>


          </div>
        </div>
      )}
      
      {/* Day Sessions Modal */}
      {showDaySessionsModal && selectedDate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={closeDaySessionsModal}>
          <div 
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <h2 className="text-lg font-semibold text-gray-900">
                  Sessions for {moment(selectedDate).format('dddd, MMMM D, YYYY')}
                </h2>
              </div>
              <button
                onClick={closeDaySessionsModal}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {daySessionsEvents.length === 0 ? (
                <div className="text-center py-8">
                  <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Sessions</h3>
                  <p className="text-gray-500">No sessions scheduled for this day.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 mb-4">
                    {daySessionsEvents.length} session{daySessionsEvents.length !== 1 ? 's' : ''} scheduled
                  </p>
                  
                  {daySessionsEvents
                    .sort((a, b) => a.start.getTime() - b.start.getTime())
                    .map((event, index) => (
                    <div 
                      key={index}
                      className="border rounded-lg p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => {
                        closeDaySessionsModal();
                        setSelectedEvent(event);
                        setShowEventModal(true);
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <div 
                              className="w-3 h-3 rounded-full"
                              style={{ 
                                backgroundColor: (() => {
                                  const therapistColors: { [key: string]: string } = {
                                    'Aastha': '#f93414', 'Ambika': '#fe6c31', 'Anjali': '#feae6c',
                                    'Indrayani': '#06889b', 'Ishika': '#006b8f', 'Muskan': '#011f51'
                                  };
                                  const firstName = event.resource.therapist.split(' ')[0];
                                  return therapistColors[firstName] || '#6B7280';
                                })()
                              }}
                            ></div>
                            <h3 className="font-medium text-gray-900">{event.resource.sessionType}</h3>
                          </div>
                          
                          <div className="space-y-1 text-sm text-gray-600">
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>{moment(event.start).format('h:mm A')} - {moment(event.end).format('h:mm A')}</span>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              <span>{event.resource.client}</span>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-5 0H3m2 0h3M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 8h1m-1-4h1m4 4h1m-1-4h1" />
                              </svg>
                              <span>{event.resource.therapist}</span>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9" />
                              </svg>
                              <span>{event.resource.mode}</span>
                              {event.resource.mode === 'Online' && event.resource.originalAppointment.booking_joining_link && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(event.resource.originalAppointment.booking_joining_link, '_blank');
                                  }}
                                  className="ml-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2 text-xs font-medium"
                                  title="Open Google Meet Link"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                  Join Now
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="ml-4">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            event.resource.status === 'completed' ? 'bg-green-100 text-green-800' :
                            event.resource.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                            event.resource.status === 'no_show' ? 'bg-orange-100 text-orange-800' :
                            'bg-blue-100 text-blue-800'
                          }`}>
                            {event.resource.status === 'no_show' ? 'No Show' : 
                             event.resource.status?.charAt(0).toUpperCase() + event.resource.status?.slice(1)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};