import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Logo } from './Logo';

interface SessionInfo {
  clientName: string;
  clientId: string;
  bookingId: string;
  sessionDate: string;
  sessionTiming: string;
  sessionDuration: string;
  therapistName: string;
  modeOfSession: string;
  bookingStatus: string;
  sessionNumber: number;
}

interface SessionNotesFormProps {
  sessionInfo: SessionInfo;
  onClose: () => void;
  onSubmit: (data: any) => void;
}

const BRAND_COLOR = '#21615D';
const TEAL = BRAND_COLOR; // Keeping alias for backwards compatibility within file

// Reusable components
const RadioGroup = ({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) => (
  <div className="flex flex-col gap-3">
    {options.map(opt => (
      <div 
        key={opt} 
        onClick={() => onChange(opt)}
        className={`flex items-center justify-between px-5 py-4 rounded-xl border cursor-pointer transition-all ${value === opt ? 'bg-[#21615d] border-[#21615d]' : 'border-gray-100 bg-gray-50/50 hover:bg-gray-100'}`}
      >
        <span className={`text-sm ${value === opt ? 'text-white font-medium' : 'text-gray-900'}`}>{opt}</span>
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${value === opt ? 'border-white' : 'border-gray-300'}`}>
          {value === opt && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
        </div>
      </div>
    ))}
  </div>
);

const RadioGrid = ({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) => (
  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
    {options.map(opt => (
      <div 
        key={opt} 
        onClick={() => onChange(opt)}
        className={`flex items-center justify-between px-4 py-3 rounded-xl border cursor-pointer transition-all ${value === opt ? 'bg-[#21615d] border-[#21615d]' : 'border-gray-100 bg-gray-50/50 hover:bg-gray-100'}`}
      >
        <span className={`text-sm ${value === opt ? 'text-white font-medium' : 'text-gray-900'}`}>{opt}</span>
        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${value === opt ? 'border-white' : 'border-gray-300'}`}>
          {value === opt && <div className="w-2 h-2 rounded-full bg-white" />}
        </div>
      </div>
    ))}
  </div>
);

const MultiSelectGrid = ({ options, values, onChange }: { options: string[]; values: string[]; onChange: (v: string[]) => void }) => {
  const toggle = (opt: string) => {
    if (values.includes(opt)) onChange(values.filter(v => v !== opt));
    else onChange([...values, opt]);
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map(opt => (
        <div key={opt} onClick={() => toggle(opt)} className={`flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer transition-colors ${values.includes(opt) ? 'border-[#21615D] bg-[#21615D]/10' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
          <span className="text-sm text-black">{opt}</span>
          <div className={`w-4 h-4 rounded border flex items-center justify-center ${values.includes(opt) ? 'bg-[#21615D] border-[#21615D]' : 'border-gray-300'}`}>
            {values.includes(opt) && <Check size={10} color="white" strokeWidth={3} />}
          </div>
        </div>
      ))}
    </div>
  );
};

const Textarea = ({ label, hint, value, onChange, required }: { label: string; hint?: string; value: string; onChange: (v: string) => void; required?: boolean }) => (
  <div className="flex flex-col gap-1">
    <label className="text-sm text-black font-semibold">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
    {hint && <p className="text-xs text-gray-500">{hint}</p>}
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={3}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-black resize-none focus:outline-none focus:border-[#21615D]"
    />
  </div>
);

const TextInput = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div className="flex flex-col gap-1">
    <label className="text-sm text-black font-semibold">{label}</label>
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full border-b border-gray-200 px-1 py-2 text-sm text-black focus:outline-none focus:border-[#21615D]"
    />
  </div>
);

const Toggle = ({ label, value, onChange, required }: { label: string; value: boolean | null; onChange: (v: boolean) => void; required?: boolean }) => (
  <div className="flex flex-col gap-2">
    <label className="text-sm text-black font-semibold">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
    <div className="grid grid-cols-2 gap-2">
      {['YES', 'NO'].map(opt => (
        <button key={opt} type="button"
          onClick={() => onChange(opt === 'YES')}
          className={`py-3 rounded-lg text-sm font-medium transition-colors ${(opt === 'YES' ? value === true : value === false) ? 'bg-[#21615D] text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}>
          {opt}
        </button>
      ))}
    </div>
  </div>
);

const SectionTitle = ({ number, title }: { number: number; title: string }) => (
  <h3 className="font-bold text-gray-900 text-base mb-3">
    {number}. {title}
  </h3>
);

export function SessionNotesForm({ sessionInfo, onClose, onSubmit }: SessionNotesFormProps) {
  const [step, setStep] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dateInputRef.current && !dateInputRef.current.contains(e.target as Node)) {
        dateInputRef.current.blur();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [showDeclarationError, setShowDeclarationError] = useState(false);

  // Step 1 - Session Type & Status
  const [sessionType, setSessionType] = useState('');
  const [sessionStatus, setSessionStatus] = useState('');

  // Auto-select session type based on session number
  useEffect(() => {
    if (sessionInfo.sessionNumber === 1) {
      setSessionType('First Session');
    } else if (sessionInfo.sessionNumber > 1) {
      setSessionType('Follow-up Session');
    }
  }, [sessionInfo.sessionNumber]);

  // Derived — reactive to therapist's selection
  const isFirstSession = sessionType !== 'Follow-up Session'; // default to first session flow
  const totalSteps = isFirstSession ? 5 : 4;

  // Step 2 - Case History (First Session only)
  const [knowAge, setKnowAge] = useState<boolean | null>(null);
  const [exactAge, setExactAge] = useState('');
  const [ageRange, setAgeRange] = useState('');
  const [genderIdentity, setGenderIdentity] = useState('');
  const [education, setEducation] = useState('');
  const [occupation, setOccupation] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [children, setChildren] = useState('');
  const [religion, setReligion] = useState('');
  const [socioEconomicStatus, setSocioEconomicStatus] = useState('');
  const [cityState, setCityState] = useState('');
  const [presentingConcerns, setPresentingConcerns] = useState('');
  const [durationOnset, setDurationOnset] = useState('');
  const [triggerFactors, setTriggerFactors] = useState('');
  const [sleep, setSleep] = useState('');
  const [weightChanges, setWeightChanges] = useState('');
  const [appetite, setAppetite] = useState('');
  const [energyLevels, setEnergyLevels] = useState('');
  const [libido, setLibido] = useState('');
  const [menstrualHistory, setMenstrualHistory] = useState('');
  const [familyHistory, setFamilyHistory] = useState<File | null>(null);
  const [developmentalHistory, setDevelopmentalHistory] = useState('');
  const [medicalHistory, setMedicalHistory] = useState('');
  const [medications, setMedications] = useState('');
  const [previousMentalHealth, setPreviousMentalHealth] = useState('');
  const [insight, setInsight] = useState<string[]>([]);

  // Step 3 - Goal Tracking
  const [therapyGoals, setTherapyGoals] = useState('');
  const [goalStage, setGoalStage] = useState('');

  // Step 4 - Progress Notes
  const [clientReport, setClientReport] = useState('');
  const [directQuotes, setDirectQuotes] = useState('');
  const [clientPresentation, setClientPresentation] = useState<string[]>([]);
  const [techniquesUsed, setTechniquesUsed] = useState('');
  const [homeworkAssigned, setHomeworkAssigned] = useState('');
  const [clientReaction, setClientReaction] = useState('');
  const [engagementNotes, setEngagementNotes] = useState('');
  const [themesPatterns, setThemesPatterns] = useState('');
  const [clinicalConcerns, setClinicalConcerns] = useState('');
  const [selfHarmMention, setSelfHarmMention] = useState<boolean | null>(null);
  const [selfHarmDetails, setSelfHarmDetails] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [riskFactors, setRiskFactors] = useState('');
  const [protectiveFactors, setProtectiveFactors] = useState('');
  const [safetyPlan, setSafetyPlan] = useState<boolean | null>(null);
  const [futureInterventions, setFutureInterventions] = useState('');
  const [sessionFrequency, setSessionFrequency] = useState('');

  // Step 5 - Declaration
  const [signatureDate, setSignatureDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selfDeclaration, setSelfDeclaration] = useState(false);

  // Canvas signature helpers
  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    setHasSignature(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) { ctx.beginPath(); ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY); }
  };
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) { ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY); ctx.stroke(); }
  };
  const stopDraw = () => setIsDrawing(false);

  // Touch support for tablet/phone
  const getTouchPos = (canvas: HTMLCanvasElement, touch: React.Touch) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
  };
  const startDrawTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = getTouchPos(canvas, e.touches[0]);
    if (ctx) { ctx.beginPath(); ctx.moveTo(pos.x, pos.y); }
    setIsDrawing(true);
    setHasSignature(true);
  };
  const drawTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = getTouchPos(canvas, e.touches[0]);
    if (ctx) { ctx.lineTo(pos.x, pos.y); ctx.stroke(); }
  };
  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) { const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height); }
    setHasSignature(false);
  };

  const getStepLabel = () => {
    if (step === 0) return 'Session Details';
    if (step === 1) return 'Session Type & Status';
    if (isFirstSession) {
      if (step === 2) return 'Case History';
      if (step === 3) return 'Goal Tracking';
      if (step === 4) return 'Progress Notes';
      if (step === 5) return 'Declaration';
    } else {
      if (step === 2) return 'Goal Tracking';
      if (step === 3) return 'Progress Notes';
      if (step === 4) return 'Declaration';  // fixed: was step 5
    }
    return '';
  };

  const handleNext = () => setStep(s => Math.min(s + 1, totalSteps));
  const handleBack = () => setStep(s => Math.max(s - 1, 0));

  const handleSubmit = () => {
    // Enforce the fields marked required on the declaration step (signature + self-declaration).
    if (!hasSignature || !selfDeclaration) {
      setShowDeclarationError(true);
      return;
    }
    const signature = canvasRef.current?.toDataURL() || '';
    onSubmit({
      session_type: sessionType,
      session_status: sessionStatus,
      client_id: sessionInfo.clientId,
      client_name: sessionInfo.clientName,
      case_history: isFirstSession ? {
        age: knowAge ? exactAge : ageRange,
        gender_identity: genderIdentity,
        education, occupation,
        marital_status: maritalStatus,
        children, religion,
        socio_economic_status: socioEconomicStatus,
        city_state: cityState,
        presenting_concerns: presentingConcerns,
        duration_onset: durationOnset,
        triggers_factors: triggerFactors,
        sleep, weight_changes: weightChanges,
        appetite, energy_levels: energyLevels,
        libido, menstrual_history: menstrualHistory,
        developmental_history: developmentalHistory,
        family_history: null,
        genogram_url: null,
        medical_history: medicalHistory,
        medications,
        previous_mental_health: previousMentalHealth,
        insight_level: Array.isArray(insight) ? insight.join(', ') : insight,
      } : null,
      therapy_goals: {
        goal_description: therapyGoals,
        current_stage: goalStage || 'Initiation',
      },
      progress_notes: {
        session_number: sessionInfo.sessionNumber,
        session_date: sessionInfo.sessionDate,
        session_duration: sessionInfo.sessionDuration,
        session_mode: sessionInfo.modeOfSession,
        client_report: clientReport,
        direct_quotes: directQuotes,
        client_presentation: Array.isArray(clientPresentation) ? clientPresentation.join(', ') : clientPresentation,
        techniques_used: techniquesUsed,
        homework_assigned: homeworkAssigned,
        client_reaction: clientReaction,
        engagement_notes: engagementNotes,
        themes_patterns: themesPatterns,
        clinical_concerns: clinicalConcerns,
        self_harm_mention: selfHarmMention ? 'YES' : 'NO',
        self_harm_details: selfHarmDetails,
        risk_level: riskLevel,
        risk_factors: riskFactors,
        protective_factors: protectiveFactors,
        safety_plan: safetyPlan ? 'YES' : 'NO',
        future_interventions: futureInterventions,
        session_frequency: sessionFrequency,
        therapist_name: sessionInfo.therapistName,
        therapist_signature: signature,
        signature_date: signatureDate,
      },
      declaration: {
        signature,
        signature_date: signatureDate,
        self_declaration: selfDeclaration,
      },
    });
  };

  // ── STEP RENDERERS ──────────────────────────────────────────────────────────

  const renderStep0 = () => (
    <div className="flex flex-col items-center pt-4">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-lg">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Client Session Status</h2>
        <div className="space-y-4 text-base text-black">
          {[
            ['Client Name', sessionInfo.clientName, true],
            ['Booking ID', sessionInfo.bookingId, true],
            ['Session Date', sessionInfo.sessionDate, false],
            ['Session Timing', sessionInfo.sessionTiming, false],
            ['Session Duration', sessionInfo.sessionDuration, false],
            ['Therapist Name', sessionInfo.therapistName, false],
            ['Mode of Session', sessionInfo.modeOfSession, false],
            ['Session Number', String(sessionInfo.sessionNumber), false],
          ].map(([label, val, bold]) => (
            <p key={label as string}>
              {label}: {bold ? <strong>{val || '—'}</strong> : (val || '—')}
            </p>
          ))}
        </div>
        <p className="text-sm text-gray-600 italic mt-8">Proceed only if all details are correct....</p>
      </div>
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-12 flex flex-col items-center">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 leading-tight">Session Type & Status</h2>
      </div>
      <div className="w-full space-y-8">
        <div>
          <p className="text-sm font-semibold text-black mb-4">Session Type*</p>
          <RadioGroup options={['First Session', 'Follow-up Session']} value={sessionType} onChange={setSessionType} />
        </div>
        <div className="pt-8 border-t border-gray-100">
          <p className="text-sm font-semibold text-black mb-4">Session Status*</p>
          <RadioGrid options={['Completed', 'Cancelled', 'No Show']} value={sessionStatus} onChange={setSessionStatus} />
        </div>
      </div>
    </div>
  );

  const renderCaseHistory = () => (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 leading-tight">
          Case History & Mental Status Examination<br />
          <span className="text-lg font-medium text-gray-600">(Static – First Session only)</span>
        </h2>
      </div>

      {/* Section 1 */}
      <div className="space-y-6 py-4">
        <SectionTitle number={1} title="Socio-Demographic Details" />
        <Toggle label="Do you know Age?" value={knowAge} onChange={setKnowAge} />
        {knowAge === true && (
          <TextInput label="Age" value={exactAge} onChange={setExactAge} />
        )}
        {knowAge === false && (
          <div>
            <p className="text-sm text-gray-700 mb-1">Enter Age Range <span className="text-xs text-gray-400">(if exact age unknown)</span></p>
            <RadioGroup options={['Less than 13', '14–17', '18–24', '25–34', '35–59', '60+']} value={ageRange} onChange={setAgeRange} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="Gender Identity" value={genderIdentity} onChange={setGenderIdentity} />
          <TextInput label="Education" value={education} onChange={setEducation} />
          <TextInput label="Occupation" value={occupation} onChange={setOccupation} />
          <TextInput label="Marital Status" value={maritalStatus} onChange={setMaritalStatus} />
          <TextInput label="Children" value={children} onChange={setChildren} />
          <TextInput label="Religion / Cultural Background" value={religion} onChange={setReligion} />
          <TextInput label="Socio-Economic Status" value={socioEconomicStatus} onChange={setSocioEconomicStatus} />
          <TextInput label="City & State" value={cityState} onChange={setCityState} />
        </div>
      </div>

      {/* Section 2 */}
      <div className="space-y-6 py-4">
        <SectionTitle number={2} title="Presenting Concerns (Client's Words Preferred)" />
        <Textarea label="Presenting concern(s)" value={presentingConcerns} onChange={setPresentingConcerns} />
        <Textarea label="Duration & onset" value={durationOnset} onChange={setDurationOnset} />
        <Textarea label="Any triggers or maintaining factors" value={triggerFactors} onChange={setTriggerFactors} />
      </div>

      {/* Section 3 */}
      <div className="space-y-6 py-4">
        <SectionTitle number={3} title="Biological & Daily Functioning" />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-700 mb-2">Sleep</p>
            <RadioGroup options={['Adequate', 'Disturbed', 'Insomnia', 'Hypersomnia']} value={sleep} onChange={setSleep} />
          </div>
          <div>
            <p className="text-sm text-gray-700 mb-2">Weight Changes</p>
            <RadioGroup options={['None', 'Gain', 'Loss', 'Unsure']} value={weightChanges} onChange={setWeightChanges} />
          </div>
          <div>
            <p className="text-sm text-gray-700 mb-2">Appetite</p>
            <RadioGroup options={['Normal', 'Increased', 'Decreased']} value={appetite} onChange={setAppetite} />
          </div>
          <div>
            <p className="text-sm text-gray-700 mb-2">Energy Levels</p>
            <RadioGroup options={['Low', 'Moderate', 'High']} value={energyLevels} onChange={setEnergyLevels} />
          </div>
        </div>
        <TextInput label="Libido" value={libido} onChange={setLibido} />
        <TextInput label="Menstrual History" value={menstrualHistory} onChange={setMenstrualHistory} />
      </div>

      {/* Section 4 */}
      <div className="space-y-6 py-4">
        <SectionTitle number={4} title="Family & Personal History" />
        <div>
          <p className="text-sm text-gray-700 mb-2">Family History & Genogram</p>
          <label className="flex items-center justify-center w-full border-2 border-dashed border-gray-200 rounded-lg py-6 cursor-pointer hover:border-teal-400 transition-colors">
            <span className="text-sm text-gray-400">{familyHistory ? familyHistory.name : 'CHOOSE A FILE'}</span>
            <input type="file" className="hidden" onChange={e => setFamilyHistory(e.target.files?.[0] || null)} />
          </label>
        </div>
        <Textarea label="Significant Developmental and Personal History" value={developmentalHistory} onChange={setDevelopmentalHistory} />
      </div>

      {/* Section 5 */}
      <div className="space-y-6 py-4">
        <SectionTitle number={5} title="Medical & Mental Health History" />
        <Textarea label="Medical History (current/past)" value={medicalHistory} onChange={setMedicalHistory} />
        <Textarea label="Medications (current/past)" value={medications} onChange={setMedications} />
        <Textarea label="Previous Mental Health History" hint="Any past diagnoses, symptoms, previous therapy, medications." value={previousMentalHealth} onChange={setPreviousMentalHealth} />
        <div>
          <p className="text-sm text-gray-700 mb-2">Insight</p>
          <MultiSelectGrid
            options={['Complete denial of concerns.', 'Slight awareness of concerns and needing help, but denying it at the same time.', 'Awareness of concerns but blaming it on others, external events.', 'Intellectual insight', 'True emotional insight']}
            values={insight}
            onChange={setInsight}
          />
        </div>
      </div>
    </div>
  );

  const renderGoalTracking = () => (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 leading-tight">
          Goal Tracking<br />
          <span className="text-lg font-medium text-gray-600">(Dynamic – Updated as Needed)</span>
        </h2>
      </div>
      <div className="space-y-6 py-4">
        <Textarea label="Therapy goals and expectations" value={therapyGoals} onChange={setTherapyGoals} />
        <div>
          <p className="text-sm text-gray-700 mb-2">Current stage of goals</p>
          <RadioGroup options={['Initiation', 'In-progress', 'Needs Review']} value={goalStage} onChange={setGoalStage} />
        </div>
      </div>
    </div>
  );

  const renderProgressNotes = () => (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 leading-tight">
          Progress Notes<br />
          <span className="text-lg font-medium text-gray-600">(Dynamic – New Every Session)</span>
        </h2>
      </div>

      {/* S - Subjective */}
      <div className="space-y-6 py-4">
        <SectionTitle number={1} title="Subjective (Client Report)" />
        <Textarea label="What did the client bring up today?" hint="(Reported concerns, emotions, thoughts, behaviours, narratives, goals since last session.)" value={clientReport} onChange={setClientReport} />
        <Textarea label="Direct quotes" value={directQuotes} onChange={setDirectQuotes} />
      </div>

      {/* O - Objective */}
      <div className="space-y-6 py-4">
        <SectionTitle number={2} title="Objective (Therapist Observation)" />
        <div>
          <p className="text-sm text-gray-700 mb-1">How did the client present today?</p>
          <p className="text-xs text-gray-400 mb-2">(appearance, behaviour, energy, mood, non-verbal cues)</p>
          <MultiSelectGrid
            options={['Appropriate', 'Low', 'Anxious', 'Stressed', 'Withdrawn', 'Agitated', 'Regulated', 'Flat / Blank', 'Energised', 'Neutral', 'Avoiding eye contact', 'Tearful', 'Restless', 'Slumped', 'Warm', 'Engaged', 'Other']}
            values={clientPresentation}
            onChange={setClientPresentation}
          />
        </div>
      </div>

      {/* Interventions */}
      <div className="space-y-6 py-4">
        <SectionTitle number={3} title="Interventions" />
        <Textarea label="What techniques, interventions or therapeutic modalities were used during the session?" hint="(e.g., CBT, narrative, grounding, psychoeducation)" value={techniquesUsed} onChange={setTechniquesUsed} required />
        <Textarea label="Homework or reflections assigned (if any)" value={homeworkAssigned} onChange={setHomeworkAssigned} />
      </div>

      {/* Client Response */}
      <div className="space-y-6 py-4">
        <SectionTitle number={4} title="Client Response" />
        <div>
          <p className="text-sm text-gray-700 mb-2">What were the client's reaction to interventions and their engagement?</p>
          <RadioGrid options={['Engaged', 'Reflective', 'Responsive', 'Neutral', 'Reluctant', 'Resistant']} value={clientReaction} onChange={setClientReaction} />
        </div>
        <Textarea label="Brief notes on engagement and insight during session" value={engagementNotes} onChange={setEngagementNotes} />
      </div>

      {/* Assessment */}
      <div className="space-y-6 py-4">
        <SectionTitle number={5} title="Assessment (Clinical Impressions)" />
        <Textarea label="What themes and patterns did you observe as their therapist?" hint="Any progress/regression since last session?" value={themesPatterns} onChange={setThemesPatterns} />
        <Textarea label="Any clinical concerns noticed?" value={clinicalConcerns} onChange={setClinicalConcerns} />
      </div>

      {/* Risk Assessment */}
      <div className="space-y-6 py-4">
        <SectionTitle number={6} title="Risk Assessment (If Applicable)" />
        <Toggle label="Any mention of self-harm?" value={selfHarmMention} onChange={setSelfHarmMention} required />
        {selfHarmMention === true && (
          <Textarea label="If yes, specify" hint="(thoughts - intensity & frequency, intent, plan, previous attempts)" value={selfHarmDetails} onChange={setSelfHarmDetails} />
        )}
        <div>
          <p className="text-sm text-gray-700 mb-3">Current Risk Level <span className="text-red-500">*</span></p>
          <div className="relative pt-2 pb-6">
            <div className="flex justify-between mb-2">
              {['None', 'Low', 'Moderate', 'High'].map((lvl, i) => (
                <button key={lvl} type="button"
                  onClick={() => setRiskLevel(lvl)}
                  className={`flex flex-col items-center gap-1 ${riskLevel === lvl ? 'text-[#21615D]' : 'text-gray-400'}`}>
                  <div className={`w-4 h-4 rounded-full border-2 ${riskLevel === lvl ? 'border-[#21615D] bg-[#21615D]' : 'border-gray-300 bg-white'}`} />
                  <span className="text-xs">{lvl}</span>
                </button>
              ))}
            </div>
            <div className="absolute top-4 left-2 right-2 h-0.5 bg-gray-200 -z-10" />
          </div>
        </div>
        <Textarea label="Risk Factors" value={riskFactors} onChange={setRiskFactors} />
        <Textarea label="Protective Factors" value={protectiveFactors} onChange={setProtectiveFactors} />
        <Toggle label="Any actions to be taken (Raise an SOS?) or Safety Plan?" value={safetyPlan} onChange={setSafetyPlan} required />
      </div>

      {/* Plan */}
      <div className="space-y-6 py-4">
        <SectionTitle number={7} title="Plan" />
        <Textarea label="Future interventions and explorations" value={futureInterventions} onChange={setFutureInterventions} />
        <div>
          <p className="text-sm text-gray-700 mb-2">Frequency of sessions</p>
          <RadioGroup options={['Weekly', 'Bi-weekly', 'Monthly', 'As needed']} value={sessionFrequency} onChange={setSessionFrequency} />
        </div>
      </div>
    </div>
  );

  const renderDeclaration = () => (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 leading-tight">Therapist Declaration</h2>
      </div>
      <div className="space-y-6 py-4">
        <div>
          <p className="text-sm text-gray-700 mb-2">Therapist Signature <span className="text-red-500">*</span></p>
          <div className="border border-gray-200 rounded-lg overflow-hidden relative">
            <canvas
              ref={canvasRef}
              width={500}
              height={150}
              className="w-full cursor-crosshair bg-white"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDrawTouch}
              onTouchMove={drawTouch}
              onTouchEnd={stopDraw}
              style={{ touchAction: 'none' }}
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-gray-200 text-lg font-light tracking-widest">SIGN HERE</span>
            </div>
          </div>
          <button type="button" onClick={clearSignature} className="text-xs text-gray-400 mt-1 hover:text-gray-600">Clear</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-700 mb-1">Date <span className="text-red-500">*</span></p>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <input
                ref={dateInputRef}
                type="date"
                value={signatureDate}
                onChange={e => setSignatureDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#21615D] bg-white"
              />
            </div>
          </div>
          <div>
            <p className="text-sm text-gray-700 mb-2">Self-declaration <span className="text-red-500">*</span></p>
            <label className={`flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer ${selfDeclaration ? 'border-[#21615D] bg-[#21615D]/10' : 'border-gray-200'}`}>
              <span className="text-sm text-gray-800">Documentation completed and reviewed</span>
              <div className={`w-4 h-4 rounded border flex items-center justify-center ${selfDeclaration ? 'bg-[#21615D] border-[#21615D]' : 'border-gray-300'}`}>
                {selfDeclaration && <Check size={10} color="white" strokeWidth={3} />}
              </div>
              <input type="checkbox" className="hidden" checked={selfDeclaration} onChange={e => { setSelfDeclaration(e.target.checked); if (e.target.checked) setShowDeclarationError(false); }} />
            </label>
          </div>
        </div>
        {showDeclarationError && (!hasSignature || !selfDeclaration) && (
          <p className="text-red-500 text-xs mt-1">
            {!hasSignature && !selfDeclaration
              ? 'Please sign and confirm the self-declaration before submitting.'
              : !hasSignature
                ? 'Please add your signature before submitting.'
                : 'Please confirm the self-declaration before submitting.'}
          </p>
        )}
      </div>
      <p className="text-xs text-gray-400 italic text-center">Confidential clinical document. To be stored securely as per ethical and legal guidelines (India).</p>
    </div>
  );

  const getStepContent = () => {
    if (step === 0) return renderStep0();
    if (step === 1) return renderStep1();
    if (isFirstSession) {
      if (step === 2) return renderCaseHistory();
      if (step === 3) return renderGoalTracking();
      if (step === 4) return renderProgressNotes();
      if (step === 5) return renderDeclaration();
    } else {
      if (step === 2) return renderGoalTracking();
      if (step === 3) return renderProgressNotes();
      if (step === 4) return renderDeclaration();
    }
  };

  const isLastStep = step === totalSteps;

  return (
    <div className="min-h-screen bg-white flex items-start justify-center py-8 pb-32">
      {/* Main container with single boundary boundary */}
      <div className="w-full max-w-[660px] mx-4 bg-white rounded-2xl border border-gray-200 px-10 py-10 overflow-y-auto">
        {getStepContent()}
      </div>

      {/* Footer Nav */}
      <div className="fixed bottom-0 left-0 right-0 py-10 flex flex-col items-center gap-4 pointer-events-none">
        <div className="w-full max-w-[660px] px-4 pointer-events-auto flex flex-col items-center gap-4">
          {step === 0 ? (
            <button
              onClick={handleNext}
              className="w-full py-4 rounded-full text-white font-semibold text-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ backgroundColor: TEAL }}>
              Next <ArrowRight size={20} />
            </button>
          ) : isLastStep ? (
            <div className="w-full flex flex-col items-center gap-4">
              <button
                onClick={handleSubmit}
                disabled={!hasSignature || !selfDeclaration}
                className="w-full py-4 rounded-full text-white font-semibold text-lg shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                style={{ backgroundColor: TEAL }}>
                Submit
              </button>
              <button 
                onClick={handleBack} 
                className="w-12 h-12 rounded-full text-white flex items-center justify-center shadow-lg transition-all active:scale-95"
                style={{ backgroundColor: TEAL }}>
                <ArrowLeft size={20} />
              </button>
            </div>
          ) : (
            <div className="flex rounded-full overflow-hidden shadow-lg" style={{ backgroundColor: TEAL }}>
              <button onClick={handleBack} className="px-8 py-4 text-white hover:bg-black/10 transition-colors border-r border-white/20">
                <ArrowLeft size={20} />
              </button>
              <button 
                onClick={handleNext}
                disabled={step === 1 && (!sessionType || !sessionStatus)}
                className="px-8 py-4 text-white hover:bg-black/10 transition-colors disabled:opacity-50">
                <ArrowRight size={20} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
