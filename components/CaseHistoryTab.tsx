import React, { useState, useEffect } from 'react';
import { User, Edit2, ChevronDown, ChevronUp } from 'lucide-react';

interface CaseHistoryTabProps {
  clientId: string;
}

export const CaseHistoryTab: React.FC<CaseHistoryTabProps> = ({ clientId }) => {
  const [caseHistory, setCaseHistory] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<string[]>(['demographic']);

  useEffect(() => {
    fetchCaseHistory();
  }, [clientId]);

  const fetchCaseHistory = async () => {
    try {
      const response = await fetch(`/api/case-history?client_id=${encodeURIComponent(clientId)}`);
      const data = await response.json();
      if (data.success) {
        setCaseHistory(data.data);
      }
    } catch (error) {
      console.error('Error fetching case history:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev =>
      prev.includes(section)
        ? prev.filter(s => s !== section)
        : [...prev, section]
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading case history...</div>
      </div>
    );
  }

  if (!caseHistory) {
    return (
      <div className="text-center py-12">
        <User size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500 text-lg mb-4">No case history available yet</p>
        <p className="text-gray-400 text-sm">Case history will be filled during the first session</p>
      </div>
    );
  }

  const Section = ({ title, id, children }: { title: string; id: string; children: React.ReactNode }) => {
    const isExpanded = expandedSections.includes(id);
    return (
      <div className="border-b last:border-b-0">
        <button
          onClick={() => toggleSection(id)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        >
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {isExpanded && (
          <div className="px-4 pb-4 space-y-3">
            {children}
          </div>
        )}
      </div>
    );
  };

  const Field = ({ label, value }: { label: string; value: any }) => {
    if (!value) return null;
    return (
      <div>
        <span className="text-xs text-gray-500 font-medium">{label}:</span>
        <p className="text-sm text-gray-800 mt-0.5">{value}</p>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg border">
      <div className="p-6 border-b flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold">Case History & Mental Status Examination</h2>
          <p className="text-sm text-gray-500 mt-1">
            Last updated: {new Date(caseHistory.updated_at).toLocaleDateString()}
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 text-teal-700 hover:bg-teal-50 rounded-lg transition-colors">
          <Edit2 size={16} />
          <span className="text-sm font-medium">Edit</span>
        </button>
      </div>

      <div>
        {/* Socio-Demographic Details */}
        <Section title="👤 Socio-Demographic Details" id="demographic">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Age" value={caseHistory.age} />
            <Field label="Gender Identity" value={caseHistory.gender_identity} />
            <Field label="Education" value={caseHistory.education} />
            <Field label="Occupation" value={caseHistory.occupation} />
            <Field label="Primary Income" value={caseHistory.primary_income} />
            <Field label="Marital Status" value={caseHistory.marital_status} />
            <Field label="Children" value={caseHistory.children} />
            <Field label="Religion" value={caseHistory.religion} />
            <Field label="Socio-Economic Status" value={caseHistory.socio_economic_status} />
            <Field label="City & State" value={caseHistory.city_state} />
          </div>
        </Section>

        {/* Presenting Concerns */}
        <Section title="💭 Presenting Concerns" id="concerns">
          <Field label="Presenting Concerns" value={caseHistory.presenting_concerns} />
          <Field label="Duration & Onset" value={caseHistory.duration_onset} />
          <Field label="Triggers & Maintaining Factors" value={caseHistory.triggers_factors} />
        </Section>

        {/* Biological & Daily Functioning */}
        <Section title="🏥 Biological & Daily Functioning" id="biological">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sleep" value={caseHistory.sleep} />
            <Field label="Appetite" value={caseHistory.appetite} />
            <Field label="Energy Levels" value={caseHistory.energy_levels} />
            <Field label="Weight Changes" value={caseHistory.weight_changes} />
            <Field label="Libido" value={caseHistory.libido} />
            <Field label="Menstrual History" value={caseHistory.menstrual_history} />
          </div>
        </Section>

        {/* Family & Personal History */}
        <Section title="👨‍👩‍👧‍👦 Family & Personal History" id="family">
          <Field label="Family History" value={caseHistory.family_history} />
          {caseHistory.genogram_url && (
            <div>
              <span className="text-xs text-gray-500 font-medium">Genogram:</span>
              <a
                href={caseHistory.genogram_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-teal-600 hover:text-teal-700 block mt-1"
              >
                View Genogram 🖼️
              </a>
            </div>
          )}
          <Field label="Developmental History" value={caseHistory.developmental_history} />
        </Section>

        {/* Medical & Mental Health History */}
        <Section title="💊 Medical & Mental Health History" id="medical">
          <Field label="Medical History" value={caseHistory.medical_history} />
          <Field label="Medications" value={caseHistory.medications} />
          <Field label="Previous Mental Health History" value={caseHistory.previous_mental_health} />
          <Field label="Insight Level" value={caseHistory.insight_level} />
        </Section>
      </div>
    </div>
  );
};
