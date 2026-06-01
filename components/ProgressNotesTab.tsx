import React, { useState, useEffect } from 'react';
import { FileText, Search, ChevronRight, ChevronDown } from 'lucide-react';

interface ProgressNotesTabProps {
  clientId: string;
  onViewNote: (noteId: number, isFreeConsultation?: boolean) => void;
  hasFreeConsultation?: boolean;
}

export const ProgressNotesTab: React.FC<ProgressNotesTabProps> = ({ clientId, onViewNote, hasFreeConsultation = false }) => {
  const [notes, setNotes] = useState<any[]>([]);
  const [freeConsultNotes, setFreeConsultNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedSessionNote, setExpandedSessionNote] = useState<number | null>(null);
  const [expandedProgressNote, setExpandedProgressNote] = useState<number | null>(null);

  const formatHeaderDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    
    // Parse DD/MM/YYYY
    const parts = dateStr.split(' ')[0].split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // 0-indexed
      const year = parseInt(parts[2], 10);
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
      }
    }
    
    // Fallback to JS Date
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
    return dateStr;
  };

  useEffect(() => {
    fetchProgressNotes();
    if (hasFreeConsultation) {
      fetchFreeConsultationNotes();
    }
  }, [clientId, hasFreeConsultation]);

  const fetchProgressNotes = async () => {
    try {
      const response = await fetch(`/api/progress-notes?client_id=${encodeURIComponent(clientId)}`);
      const data = await response.json();
      if (data.success) {
        setNotes(data.data);
      }
    } catch (error) {
      console.error('Error fetching progress notes:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFreeConsultationNotes = async () => {
    try {
      const response = await fetch(`/api/free-consultation-notes?client_id=${clientId}`);
      const data = await response.json();
      if (data.success) {
        setFreeConsultNotes(data.data);
      }
    } catch (error) {
      console.error('Error fetching free consultation notes:', error);
    }
  };

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel?.toLowerCase()) {
      case 'none': return 'bg-green-100 text-green-700';
      case 'low': return 'bg-yellow-100 text-yellow-700';
      case 'moderate': return 'bg-orange-100 text-orange-700';
      case 'high': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getRiskIcon = (riskLevel: string) => {
    switch (riskLevel?.toLowerCase()) {
      case 'none': return '🟢';
      case 'low': return '🟡';
      case 'moderate': return '🟠';
      case 'high': return '🔴';
      default: return '⚪';
    }
  };

  const filteredNotes = notes.filter(note => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    // For progress notes
    if (note.note_type === 'progress_note') {
      return note.client_report?.toLowerCase().includes(searchLower) ||
             note.techniques_used?.toLowerCase().includes(searchLower);
    }
    // For session notes
    if (note.note_type === 'session_note') {
      return note.concerns_discussed?.toLowerCase().includes(searchLower) ||
             note.interventions_used?.toLowerCase().includes(searchLower);
    }
    return true;
  });

  const filteredFreeConsultNotes = freeConsultNotes.filter(note => {
    if (!searchTerm) return true;
    return note.presenting_concerns?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           note.other_notes?.toLowerCase().includes(searchTerm.toLowerCase())
  });

  const allNotes = [...filteredFreeConsultNotes.map(n => ({ ...n, isFreeConsultation: true })), ...filteredNotes];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading progress notes...</div>
      </div>
    );
  }

  if (allNotes.length === 0 && !searchTerm) {
    return (
      <div className="text-center py-12">
        <FileText size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500 text-lg mb-4">No progress notes available yet</p>
        <p className="text-gray-400 text-sm">Progress notes will be added after each session</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search sessions..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {/* Notes List */}
      <div className="space-y-3">
        {allNotes.map((note) => {
          if (note.isFreeConsultation) {
            // Free Consultation Note
            return (
              <div
                key={`fc-${note.id}`}
                className="bg-purple-50 rounded-lg border-2 border-purple-200 hover:border-purple-400 transition-colors cursor-pointer"
                onClick={() => onViewNote(note.id, true)}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="px-3 py-1 bg-purple-600 text-white text-xs font-medium rounded-full">
                          FREE CONSULTATION
                        </span>
                        <span className="text-sm text-gray-500">
                          {new Date(note.session_date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-2">
                        <span>Mode: {note.session_mode || 'N/A'}</span>
                        <span>•</span>
                        <span>Pre-therapy Session</span>
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-purple-400" />
                  </div>

                  <div className="space-y-2">
                    <div>
                      <span className="text-xs font-medium text-purple-700">Presenting Concerns:</span>
                      <p className="text-sm text-gray-700 line-clamp-2 mt-0.5">
                        {note.presenting_concerns || 'No concerns recorded'}
                      </p>
                    </div>
                    {note.assigned_therapist_name && (
                      <div>
                        <span className="text-xs font-medium text-purple-700">Assigned Therapist:</span>
                        <p className="text-sm text-gray-700 mt-0.5">
                          {note.assigned_therapist_name}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          } else if (note.note_type === 'session_note') {
            // Session Note (from client_session_notes table) - Expandable accordion
            const isExpanded = expandedSessionNote === note.id;
            return (
              <div
                key={`sn-${note.id}`}
                className="rounded-lg border-2 transition-all"
                style={{ 
                  backgroundColor: '#21615d1a',
                  borderColor: '#21615D'
                }}
              >
                <div 
                  className="p-4 cursor-pointer"
                  onClick={() => setExpandedSessionNote(isExpanded ? null : note.id)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span 
                          className="px-3 py-1 text-white text-xs font-medium rounded-full"
                          style={{ backgroundColor: '#21615D' }}
                        >
                          SESSION NOTE
                        </span>
                        <span className="text-sm text-gray-500">
                          {new Date(note.session_date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                      {note.session_timing && (
                        <div className="text-xs text-gray-500 mt-2">
                          {note.session_timing}
                        </div>
                      )}
                    </div>
                    {isExpanded ? (
                      <ChevronDown size={20} style={{ color: '#21615D' }} />
                    ) : (
                      <ChevronRight size={20} style={{ color: '#21615D' }} />
                    )}
                  </div>

                  {!isExpanded && note.concerns_discussed && (
                    <div>
                      <span className="text-xs font-medium" style={{ color: '#21615D' }}>Concerns Discussed:</span>
                      <p className="text-sm text-gray-700 line-clamp-2 mt-0.5">
                        {note.concerns_discussed}
                      </p>
                    </div>
                  )}
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-5 border-t" style={{ borderColor: '#21615D' }}>

                    {/* ── Context ── */}
                    {(note.client_age || note.gender || note.occupation || note.marital_status) && (
                      <div className="pt-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Client Context</p>
                        <div className="flex flex-wrap gap-4 text-sm text-gray-700">
                          {note.client_age && <span><strong>Age:</strong> {note.client_age}</span>}
                          {note.gender && <span><strong>Gender:</strong> {note.gender}</span>}
                          {note.occupation && <span><strong>Occupation:</strong> {note.occupation}</span>}
                          {note.marital_status && <span><strong>Marital Status:</strong> {note.marital_status}</span>}
                        </div>
                      </div>
                    )}

                    {/* ── Clinical ── */}
                    <div className="space-y-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Clinical Notes</p>

                      {note.concerns_discussed && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Concerns or Themes Discussed:</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.concerns_discussed}</p>
                        </div>
                      )}
                      {note.somatic_cues && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Somatic Cues (Appearance, Behavior, Energy, Mood):</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{Array.isArray(note.somatic_cues) ? note.somatic_cues.join(', ') : note.somatic_cues}</p>
                        </div>
                      )}
                      {note.interventions_used && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Interventions Used:</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.interventions_used}</p>
                        </div>
                      )}
                      {note.interventions_helpful && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Were Interventions Helpful?</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.interventions_helpful}</p>
                        </div>
                      )}
                      {note.client_participation && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Client Participation:</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.client_participation}</p>
                        </div>
                      )}
                      {note.goal_progress && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Goal Progress:</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.goal_progress}</p>
                        </div>
                      )}
                      {note.client_values && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Client Values:</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.client_values}</p>
                        </div>
                      )}
                    </div>

                    {/* ── Risk & Safety ── */}
                    {(note.self_harm_mention || note.self_harm_details || note.current_risk_level || note.protective_factors) && (
                      <div className="space-y-3 bg-red-50 rounded-lg p-3 border border-red-200">
                        <p className="text-xs font-bold uppercase tracking-wider text-red-500">Risk & Safety</p>
                        {note.current_risk_level && (
                          <div>
                            <span className="text-xs font-semibold text-red-700">Current Risk Level:</span>
                            <p className="text-sm text-gray-800 mt-1">{note.current_risk_level}</p>
                          </div>
                        )}
                        {note.self_harm_mention && (
                          <div>
                            <span className="text-xs font-semibold text-red-700">Self-Harm Mention:</span>
                            <p className="text-sm text-gray-800 mt-1">{note.self_harm_mention}</p>
                          </div>
                        )}
                        {note.self_harm_details && (
                          <div>
                            <span className="text-xs font-semibold text-red-700">Self-Harm Details:</span>
                            <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.self_harm_details}</p>
                          </div>
                        )}
                        {note.protective_factors && (
                          <div>
                            <span className="text-xs font-semibold text-red-700">Protective Factors:</span>
                            <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.protective_factors}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── History ── */}
                    {(note.health_history || note.past_diagnoses) && (
                      <div className="space-y-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Medical History</p>
                        {note.health_history && (
                          <div>
                            <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Health History:</span>
                            <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.health_history}</p>
                          </div>
                        )}
                        {note.past_diagnoses && (
                          <div>
                            <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Past Diagnoses:</span>
                            <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.past_diagnoses}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Planning ── */}
                    {(note.next_session_plan || note.homework_suggested) && (
                      <div className="space-y-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Planning</p>
                        {note.next_session_plan && (
                          <div>
                            <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Next Session Plan:</span>
                            <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.next_session_plan}</p>
                          </div>
                        )}
                        {note.homework_suggested && (
                          <div>
                            <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Homework / Suggested Activities:</span>
                            <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.homework_suggested}</p>
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                )}
              </div>
            );
          } else {
            // Regular Progress Note (from client_progress_notes table)
            const isExpanded = expandedProgressNote === note.id;
            return (
              <div
                key={`pn-${note.id}`}
                className="rounded-lg border-2 transition-all"
                style={{ 
                  backgroundColor: '#21615d1a',
                  borderColor: '#21615D'
                }}
              >
                <div 
                  className="p-4 cursor-pointer"
                  onClick={() => setExpandedProgressNote(isExpanded ? null : note.id)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span 
                          className="px-3 py-1 text-white text-xs font-medium rounded-full"
                          style={{ backgroundColor: '#21615D' }}
                        >
                          SESSION NOTE
                        </span>
                        <span className="text-sm text-gray-500">
                          {formatHeaderDate(note.session_date)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 mt-2">
                        {note.session_date}
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronDown size={20} style={{ color: '#21615D' }} />
                    ) : (
                      <ChevronRight size={20} style={{ color: '#21615D' }} />
                    )}
                  </div>

                  {!isExpanded && note.client_report && (
                    <div>
                      <span className="text-xs font-medium" style={{ color: '#21615D' }}>Subjective:</span>
                      <p className="text-sm text-gray-700 line-clamp-2 mt-0.5">
                        {note.client_report}
                      </p>
                    </div>
                  )}
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-5 border-t" style={{ borderColor: '#21615D' }}>

                    {/* ───── Session Info ───── */}
                    <div className="pt-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Session Details</p>
                      <div className="flex flex-wrap gap-4 text-sm text-gray-700">
                        <span><strong>#</strong> {note.session_number}</span>
                        <span>•</span>
                        {note.session_duration && <span><strong>Duration:</strong> {note.session_duration} mins</span>}
                        {note.session_mode && <span><strong>Mode:</strong> {note.session_mode}</span>}
                        {note.session_frequency && <span><strong>Frequency:</strong> {note.session_frequency}</span>}
                      </div>
                    </div>

                    {/* ───── Clinical Notes (S.O.A.P approximation) ───── */}
                    <div className="space-y-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Clinical Narrative</p>

                      {note.client_report && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Subjective Report:</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.client_report}</p>
                        </div>
                      )}
                      
                      {note.direct_quotes && (
                        <div className="bg-gray-50 p-3 rounded italic border-l-4 border-teal-500">
                           <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Direct Quotes:</span>
                           <p className="text-sm text-gray-600 mt-1">"{note.direct_quotes}"</p>
                        </div>
                      )}

                      {note.client_presentation && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Clinical Presentation:</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.client_presentation}</p>
                          {note.presentation_tags && note.presentation_tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {note.presentation_tags.map((tag: string, i: number) => (
                                <span key={i} className="px-2 py-0.5 bg-teal-50 text-teal-700 text-[10px] rounded border border-teal-100">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {note.techniques_used && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Interventions / Techniques:</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.techniques_used}</p>
                        </div>
                      )}

                      {note.engagement_notes && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Engagement & Participation:</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.engagement_notes}</p>
                        </div>
                      )}
                    </div>

                    {/* ───── Progress & Observations ───── */}
                    <div className="space-y-4 pt-2">
                       <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Analysis & Progress</p>
                       
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {note.themes_patterns && (
                            <div>
                              <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Themes & Patterns:</span>
                              <p className="text-sm text-gray-800 mt-1">{note.themes_patterns}</p>
                            </div>
                          )}
                           {note.clinical_concerns && (
                            <div>
                              <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Clinical Concerns:</span>
                              <p className="text-sm text-gray-800 mt-1">{note.clinical_concerns}</p>
                            </div>
                          )}
                       </div>

                       {note.progress_regression && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Overall Progress:</span>
                          <p className="text-sm text-gray-800 mt-1">{note.progress_regression}</p>
                        </div>
                       )}
                    </div>

                    {/* ───── Risk & Safety (Highlighted similar to old system) ───── */}
                    <div className="space-y-3 bg-red-50 rounded-lg p-3 border border-red-200">
                      <p className="text-xs font-bold uppercase tracking-wider text-red-500">Risk Assessment</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <span className="text-xs font-semibold text-red-700">Current Risk Level:</span>
                          <p className="text-sm text-gray-800 mt-1 font-medium capitalize">{note.risk_level || 'None'}</p>
                        </div>
                        {note.self_harm_mention && (
                          <div>
                            <span className="text-xs font-semibold text-red-700">Self-Harm Mention:</span>
                            <p className="text-sm text-gray-800 mt-1">{note.self_harm_mention}</p>
                          </div>
                        )}
                      </div>
                      
                      {note.self_harm_details && (
                        <div className="mt-2 text-sm text-gray-800 pl-2 border-l-2 border-red-300 italic">
                          {note.self_harm_details}
                        </div>
                      )}

                      {(note.risk_factors || note.protective_factors || note.safety_plan) && (
                        <div className="mt-2 space-y-2 pt-2 border-t border-red-100">
                           {note.risk_factors && (
                            <div>
                              <span className="text-xs font-semibold text-red-600">Risk Factors:</span>
                              <p className="text-sm text-gray-700">{note.risk_factors}</p>
                            </div>
                           )}
                           {note.protective_factors && (
                            <div>
                              <span className="text-xs font-semibold text-red-600">Protective Factors:</span>
                              <p className="text-sm text-gray-700">{note.protective_factors}</p>
                            </div>
                           )}
                           {note.safety_plan && (
                            <div className="bg-white p-2 rounded border border-red-100">
                              <span className="text-xs font-bold text-red-600">Safety Plan:</span>
                              <p className="text-sm text-gray-800">{note.safety_plan}</p>
                            </div>
                           )}
                        </div>
                      )}
                    </div>

                    {/* ───── Plan & Therapy ───── */}
                    <div className="space-y-4 pt-2">
                       <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Treatment Planning</p>
                       
                       {note.homework_assigned && (
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Assigned Homework:</span>
                          <p className="text-sm text-gray-800 mt-1">{note.homework_assigned}</p>
                        </div>
                       )}

                       {note.future_interventions && (
                         <div>
                          <span className="text-xs font-semibold" style={{ color: '#21615D' }}>Future Interventions:</span>
                          <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{note.future_interventions}</p>
                        </div>
                       )}
                    </div>

                  </div>
                )}
              </div>
            );
          }
        })}
      </div>

      {allNotes.length === 0 && searchTerm && (
        <div className="text-center py-8 text-gray-500">
          No sessions found matching "{searchTerm}"
        </div>
      )}
    </div>
  );
};
