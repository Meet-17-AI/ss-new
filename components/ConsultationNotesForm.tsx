import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Logo } from './Logo';
import { saveDraft, saveDraftBeacon, hasDraftContent } from './sessionDraft';

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

interface ConsultationNotesFormProps {
  sessionInfo: SessionInfo;
  initialDraft?: any;
  onClose: () => void;
  onSubmit: (data: any) => void;
}

const BRAND_COLOR = '#21615D';

// Reusable UI Components
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

const CheckboxGroup = ({ options, values, onChange, columns = 2 }: { options: string[]; values: string[]; onChange: (v: string[]) => void; columns?: number }) => {
  const toggle = (opt: string) => {
    if (values.includes(opt)) onChange(values.filter(v => v !== opt));
    else onChange([...values, opt]);
  };
  return (
    <div className={`grid grid-cols-${columns} gap-2`}>
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

const TextInput = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) => (
  <div className="flex flex-col gap-1">
    <label className="text-sm text-black font-semibold">{label}</label>
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border-b border-gray-200 px-1 py-2 text-sm text-black focus:outline-none focus:border-[#21615D]"
    />
  </div>
);

const SectionTitle = ({ number, title }: { number: number; title: string }) => (
  <h3 className="font-bold text-gray-900 text-base mb-3">
    {number}. {title}
  </h3>
);

export function ConsultationNotesForm({ sessionInfo, initialDraft, onClose, onSubmit }: ConsultationNotesFormProps) {
  const [step, setStep] = useState(0);

  // Form State matching PreTherapyFormData
  const [age, setAge] = useState('');
  const [language, setLanguage] = useState<string[]>([]);
  const [language_other, setLanguageOther] = useState('');
  const [location, setLocation] = useState('');
  const [location_manual, setLocationManual] = useState('');
  const [mode_of_session, setModeOfSession] = useState<string[]>([]);
  const [previous_therapy, setPreviousTherapy] = useState('');
  const [concerns, setConcerns] = useState<string[]>([]);
  const [concerns_other, setConcernsOther] = useState('');
  const [clinical_concerns_observed, setClinicalConcernsObserved] = useState('');
  const [clinical_concerns, setClinicalConcerns] = useState<string[]>([]);
  const [psychiatric_treatment, setPsychiatricTreatment] = useState('');
  const [suicidal_thoughts, setSuicidalThoughts] = useState('');
  const [suicidal_current, setSuicidalCurrent] = useState('');
  const [suicidal_ideation_1m, setSuicidalIdeation1m] = useState('');
  const [suicidal_attempt_1m, setSuicidalAttempt1m] = useState('');
  const [preferred_therapy_approach, setPreferredApproach] = useState('');
  const [preferred_therapy_text, setPreferredApproachText] = useState('');
  const [consent_explained, setConsentExplained] = useState('');
  const [consent_no_reason, setConsentNoReason] = useState('');
  const [scope_explained, setScopeExplained] = useState('');
  const [preferred_price, setPreferredPrice] = useState('');
  const [preferred_price_other, setPreferredPriceOther] = useState('');
  const [readiness, setReadiness] = useState<string[]>([]);
  const [readiness_other, setReadinessOther] = useState('');
  const [consented_followup, setConsentedFollowup] = useState('');
  const [followup_mode, setFollowupMode] = useState('');
  const [client_questions, setClientQuestions] = useState('');
  const [source, setSource] = useState('');
  const [source_other, setSourceOther] = useState('');
  const [consultation_outcome, setConsultationOutcome] = useState('');
  const [close_reason, setCloseReason] = useState('');

  const [showError, setShowError] = useState(false);

  // ── Draft failsafe (autosave + prefill) ──────────────────────────────────
  // All autosave is best-effort and never blocks the form. Stored in an isolated
  // table that no other query reads, so it can't affect any existing behaviour.
  const bookingId = sessionInfo.bookingId;
  const [hydrated, setHydrated] = useState(!initialDraft);

  useEffect(() => {
    if (!initialDraft) return;
    const d = initialDraft;
    const s = (v: any, def: any = '') => (v === undefined || v === null ? def : v);
    const arr = (v: any) => (Array.isArray(v) ? v : []);
    if (typeof d.step === 'number') setStep(d.step);
    setAge(s(d.age)); setLanguage(arr(d.language)); setLanguageOther(s(d.language_other));
    setLocation(s(d.location)); setLocationManual(s(d.location_manual)); setModeOfSession(arr(d.mode_of_session));
    setPreviousTherapy(s(d.previous_therapy)); setConcerns(arr(d.concerns)); setConcernsOther(s(d.concerns_other));
    setClinicalConcernsObserved(s(d.clinical_concerns_observed)); setClinicalConcerns(arr(d.clinical_concerns));
    setPsychiatricTreatment(s(d.psychiatric_treatment));
    setSuicidalThoughts(s(d.suicidal_thoughts)); setSuicidalCurrent(s(d.suicidal_current));
    setSuicidalIdeation1m(s(d.suicidal_ideation_1m)); setSuicidalAttempt1m(s(d.suicidal_attempt_1m));
    setPreferredApproach(s(d.preferred_therapy_approach)); setPreferredApproachText(s(d.preferred_therapy_text));
    setConsentExplained(s(d.consent_explained)); setConsentNoReason(s(d.consent_no_reason)); setScopeExplained(s(d.scope_explained));
    setPreferredPrice(s(d.preferred_price)); setPreferredPriceOther(s(d.preferred_price_other));
    setReadiness(arr(d.readiness)); setReadinessOther(s(d.readiness_other));
    setConsentedFollowup(s(d.consented_followup)); setFollowupMode(s(d.followup_mode));
    setClientQuestions(s(d.client_questions)); setSource(s(d.source)); setSourceOther(s(d.source_other));
    setConsultationOutcome(s(d.consultation_outcome)); setCloseReason(s(d.close_reason));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftData = {
    step, age, language, language_other, location, location_manual, mode_of_session,
    previous_therapy, concerns, concerns_other, clinical_concerns_observed, clinical_concerns,
    psychiatric_treatment, suicidal_thoughts, suicidal_current, suicidal_ideation_1m, suicidal_attempt_1m,
    preferred_therapy_approach, preferred_therapy_text, consent_explained, consent_no_reason, scope_explained,
    preferred_price, preferred_price_other, readiness, readiness_other, consented_followup, followup_mode,
    client_questions, source, source_other, consultation_outcome, close_reason,
  };
  const draftJson = JSON.stringify(draftData);

  // 'step' is auto-populated on mount, so it alone doesn't make a form "started".
  const draftHasContent = hasDraftContent(draftData, ['step']);

  // Autosave on EVERY field change (short debounce only coalesces keystrokes).
  useEffect(() => {
    if (!hydrated || !bookingId || !draftHasContent) return;
    const t = setTimeout(() => { saveDraft(bookingId, 'consultation', draftData); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, hydrated, bookingId, draftHasContent]);

  useEffect(() => {
    if (!bookingId) return;
    const flush = () => { if (draftHasContent) saveDraftBeacon(bookingId, 'consultation', draftData); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, bookingId, draftHasContent]);

  const handleNext = () => setStep(s => s + 1);
  const handleBack = () => setStep(s => s - 1);

  const handleSubmit = () => {
    if (!scope_explained) {
      setShowError(true);
      return;
    }

    const consultationData = {
      age,
      language,
      language_other,
      location,
      location_manual,
      mode_of_session,
      previous_therapy,
      concerns,
      concerns_other,
      clinical_concerns_observed,
      clinical_concerns,
      psychiatric_treatment,
      suicidal_thoughts,
      suicidal_current,
      suicidal_ideation_1m,
      suicidal_attempt_1m,
      preferred_therapy_approach,
      preferred_therapy_text,
      consent_explained,
      consent_no_reason,
      scope_explained,
      preferred_price,
      preferred_price_other,
      readiness,
      readiness_other,
      consented_followup,
      followup_mode,
      client_questions,
      source,
      source_other,
      consultation_outcome,
      close_reason
    };

    onSubmit({
      session_type: 'Consultation', // This triggers the pretherapy_call_forms branch in backend
      booking_id: sessionInfo.bookingId,
      client_id: sessionInfo.clientId,
      consultation_data: consultationData
    });
  };

  const totalSteps = 4;

  if (step === 0) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 animate-in fade-in duration-500">
        <div className="mb-12">
          <Logo />
        </div>
        <div className="w-full max-w-lg flex flex-col items-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-8">
            Client Pre-therapy Session Status
          </h1>
          
          <div className="space-y-4 mb-12 w-full max-w-xs text-left">
            {[
              { label: 'Client Name', value: sessionInfo.clientName, bold: true },
              { label: 'Booking ID', value: sessionInfo.bookingId, bold: true },
              { label: 'Session Date', value: sessionInfo.sessionDate },
              { label: 'Session Timing', value: sessionInfo.sessionTiming },
              { label: 'Session Duration', value: '15 min' },
              { label: 'Therapist Name', value: 'Safestories' },
              { label: 'Mode of Session', value: sessionInfo.modeOfSession },
            ].map((item, i) => (
              <div key={i} className="flex items-start text-[15px]">
                <span className="text-gray-500 w-32 flex-shrink-0">{item.label}:</span>
                <span className={`text-gray-900 ${item.bold ? 'font-bold' : 'font-medium'}`}>{item.value}</span>
              </div>
            ))}
          </div>
 
          <p className="text-sm text-gray-400 italic mb-12">
            Proceed only if all details are correct....
          </p>
 
          <div className="flex justify-center">
            <button 
              onClick={handleNext}
              className="w-20 h-10 bg-[#4ca09b] text-white rounded-full flex items-center justify-center shadow-sm hover:opacity-90 transition-all"
            >
              <ArrowRight size={22} color="white" strokeWidth={3} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-xl mx-auto px-6 h-4" />
      </div>

      <div className="max-w-xl mx-auto px-6 py-8 pb-32">
        {step === 1 && (
          <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
            <SectionTitle number={1} title="Age & Location" />
            <TextInput label="Age" value={age} onChange={setAge} placeholder="Specify age..." />
            
            <div className="space-y-3">
              <label className="text-sm text-black font-semibold">Location</label>
              <RadioGroup options={['Indian Resident', 'NRI']} value={location} onChange={setLocation} />
              <TextInput label="City/Country" value={location_manual} onChange={setLocationManual} placeholder="Specify city or country..." />
            </div>

            <div className="space-y-3">
              <label className="text-sm text-black font-semibold">Preferred Languages</label>
              <CheckboxGroup 
                options={['Hindi', 'English', 'Gujarathi', 'Marwadi', 'Marathi', 'Malayalam', 'Punjabi', 'Konkani', 'Other']} 
                values={language} 
                onChange={setLanguage} 
              />
              {language.includes('Other') && (
                <TextInput label="Specify Language" value={language_other} onChange={setLanguageOther} />
              )}
            </div>

            <div className="space-y-3">
              <label className="text-sm text-black font-semibold">Mode of Session</label>
              <CheckboxGroup options={['Online', 'In-person', 'Both']} values={mode_of_session} onChange={setModeOfSession} columns={3} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
            <SectionTitle number={2} title="History & Concerns" />
            
            <div className="space-y-3">
              <label className="text-sm text-black font-semibold">Previous Therapy Experience</label>
              <RadioGroup options={['Yes', 'No', "Not sure if they were therapist"]} value={previous_therapy} onChange={setPreviousTherapy} />
            </div>

            <div className="space-y-3">
              <label className="text-sm text-black font-semibold">Primary Concerns — What are you looking for?</label>
              <CheckboxGroup 
                options={[
                  'Anxiety or Depression related concerns',
                  'Relationship / Family related concerns',
                  'Attachment related concerns',
                  'Dealing with life transitions',
                  'Life adjustment concerns',
                  'Anger related concerns',
                  'Mood concerns',
                  'Trauma / past traumatic experiences',
                  'Addiction / Substance use',
                  'Gender, Sexuality & LGBTQAI+',
                  'Grief / loss',
                  'Identity crisis',
                  'Pregnancy or parenting related concerns',
                  'Work place related stress',
                  'Not sure',
                  'Other',
                ]} 
                values={concerns} 
                onChange={setConcerns} 
              />
              {concerns.includes('Other') && (
                <TextInput label="Specify Concern" value={concerns_other} onChange={setConcernsOther} />
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
            <SectionTitle number={3} title="Risk & Clinical assessment" />
            
            <div className="space-y-3">
              <label className="text-sm text-black font-semibold">Any Clinical Concerns Mentioned?</label>
              <RadioGroup options={['Yes', 'No']} value={clinical_concerns_observed} onChange={setClinicalConcernsObserved} />
              {clinical_concerns_observed === 'Yes' && (
                <div className="pt-4 space-y-4">
                  <div className="text-xs text-gray-500 mb-2">Select all that apply:</div>
                  <CheckboxGroup 
                    options={[
                      'Hallucinations', 'Delusions', 'Disorientation / Erratic Mood',
                      'Dissociation', 'Severe Panic Attacks', 'Severe Anxiety',
                      'Severe Depressive Symptoms', 'Self-Harm Ongoing', 'Mania',
                      'Paranoia', 'Impulsivity', 'Anger / Aggression',
                      'Obsessions and Compulsions', 'Health Related Anxiety', 'Seizures',
                      'Amnesia', 'Substance Abuse', 'Eating Disorder Symptoms',
                      'Developmental concerns', 'Other',
                    ]} 
                    values={clinical_concerns} 
                    onChange={setClinicalConcerns} 
                  />
                  <Textarea label="Ongoing/Past Psychiatric Treatment / Medications" value={psychiatric_treatment} onChange={setPsychiatricTreatment} />
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-2xl bg-red-50 p-5 border border-red-100">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <label className="text-sm text-red-900 font-bold uppercase tracking-tight">Clinical Safety Assessment</label>
              </div>
              
              <div className="space-y-6 pt-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-red-800">Any Suicidal Thoughts Mentioned?</p>
                  <RadioGroup options={['Yes', 'No', "Couldn't explore"]} value={suicidal_thoughts} onChange={setSuicidalThoughts} />
                </div>

                {suicidal_thoughts === 'Yes' && (
                  <div className="space-y-6 pt-2 border-t border-red-200">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-red-800">Any ongoing/current suicidal thoughts/attempt?</p>
                      <RadioGroup options={['Yes - Referral to be initiated', 'No']} value={suicidal_current} onChange={setSuicidalCurrent} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-red-800">Suicidal ideation in last 1 month?</p>
                      <RadioGroup options={['Yes', 'No']} value={suicidal_ideation_1m} onChange={setSuicidalIdeation1m} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-red-800">Suicidal attempt in last 1 month?</p>
                      <RadioGroup options={['Yes', 'No']} value={suicidal_attempt_1m} onChange={setSuicidalAttempt1m} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
                <label className="text-sm text-black font-semibold">Any Preferred Therapy Approach/Needs?</label>
                <RadioGroup options={['Yes', 'No']} value={preferred_therapy_approach} onChange={setPreferredApproach} />
                {preferred_therapy_approach === 'Yes' && (
                    <Textarea 
                        label="Specify Preferences" 
                        hint="e.g. gender of therapist, years of Experience, Queer affirmative, techniques, etc." 
                        value={preferred_therapy_text} 
                        onChange={setPreferredApproachText} 
                    />
                )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
            <SectionTitle number={4} title="Logistics & Consent" />
            
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-black font-semibold">Explained Consent Form & Confidentiality</label>
                <RadioGroup options={['Yes, explained', 'Yes, but client had more questions', 'No - Mention Reason']} value={consent_explained} onChange={setConsentExplained} />
                {consent_explained === 'No - Mention Reason' && <TextInput label="Reason" value={consent_no_reason} onChange={setConsentNoReason} />}
              </div>

              <div className="space-y-2 p-4 bg-gray-50 rounded-xl border border-gray-100">
                <label className="text-sm text-black font-semibold flex items-center gap-2">
                    Explained Scope of Service <span className="text-red-500">*</span>
                </label>
                <p className="text-[11px] text-gray-500 mb-2 leading-relaxed">
                  Explained that this is not a medical/crisis/emergency helpline. Team will refer them if concerns are beyond scope. (Mandatory)
                </p>
                <RadioGroup options={['Yes', 'No']} value={scope_explained} onChange={setScopeExplained} />
                {showError && !scope_explained && <div className="text-red-500 text-[10px] mt-1">This field is required.</div>}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-black font-semibold">Preferred Price Range</label>
                <RadioGroup options={['1200', '1700', '3000', 'Other']} value={preferred_price} onChange={setPreferredPrice} />
                {preferred_price === 'Other' && <TextInput label="Specify Price" value={preferred_price_other} onChange={setPreferredPriceOther} />}
              </div>

              <div className="space-y-2">
                <label className="text-sm text-black font-semibold">Readiness — When are you looking for a session?</label>
                <CheckboxGroup options={['Immediate (Within 0-2 days)', '2-5 days', '5-10 days', 'Not sure', 'Other']} values={readiness} onChange={setReadiness} columns={1} />
                {readiness.includes('Other') && <TextInput label="Specify Timeframe" value={readiness_other} onChange={setReadinessOther} />}
              </div>
            </div>

            <div className="space-y-3">
                <label className="text-sm text-black font-semibold">Consented to Follow Up — Can we check in tomorrow?</label>
                <RadioGroup options={['Yes', 'No']} value={consented_followup} onChange={setConsentedFollowup} />
                {consented_followup === 'Yes' && (
                    <div className="mt-2">
                        <label className="text-xs text-gray-500">Preferred Mode</label>
                        <CheckboxGroup options={['Text', 'Call']} values={followup_mode ? [followup_mode] : []} onChange={(v) => setFollowupMode(v[v.length - 1] || '')} />
                    </div>
                )}
            </div>

            <Textarea label="Questions potentially asked about therapy" value={client_questions} onChange={setClientQuestions} />

            <div className="space-y-3">
              <label className="text-sm text-black font-semibold">Source — How did you hear about us?</label>
              <RadioGroup options={['Referred by someone', 'Website', 'Instagram', 'Google Search', 'Linkedin', 'Other (Mention)']} value={source} onChange={setSource} />
              {source === 'Other (Mention)' && <TextInput label="Specify Source" value={source_other} onChange={setSourceOther} />}
            </div>

            <div className="space-y-3">
              <label className="text-sm text-black font-semibold">Consultation Call Done</label>
              <RadioGroup options={['Session booked', 'To be Followed up', 'Referred', 'Closed - Reason']} value={consultation_outcome} onChange={setConsultationOutcome} />
              {consultation_outcome === 'Closed - Reason' && <TextInput label="Reason for closing" value={close_reason} onChange={setCloseReason} />}
            </div>
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-6">
        <div className="max-w-xl mx-auto flex gap-3">
          <button
            onClick={handleBack}
            className="flex-1 py-4 px-6 rounded-2xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft size={18} />
            Back
          </button>
          {step === totalSteps ? (
            <button
              onClick={handleSubmit}
              className="flex-[2] py-4 px-6 rounded-2xl bg-[#21615D] text-white font-bold hover:bg-[#1a4d4a] transition-all shadow-lg flex items-center justify-center gap-2"
            >
              Submit Documentation
              <Check size={18} />
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="flex-[2] py-4 px-6 rounded-2xl bg-[#21615D] text-white font-bold hover:bg-[#1a4d4a] transition-all shadow-lg flex items-center justify-center gap-2"
            >
              Continue
              <ArrowRight size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
