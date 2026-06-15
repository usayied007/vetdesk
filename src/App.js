import React, { useState, useEffect, useRef } from "react";

// ── API ───────────────────────────────────────────────────────────────────────
async function callClaude(prompt, system) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok || data.type === "error") {
    throw new Error(data?.error?.message || `API error ${res.status}`);
  }
  const text = data.content?.map((b) => b.text || "").join("") || "";
  return text;
}

function parseJSON(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  return null;
}

// ── Triage AI System Prompt ───────────────────────────────────────────────────
const VET_SYSTEM = `You are a veterinary triage AI. You MUST return ONLY a raw JSON object. No markdown, no backticks, no explanation whatsoever. Your ENTIRE response must start with { and end with }. Keep ALL string values concise (under 25 words). Use this exact structure:
{"triageLevel":"Urgent","triageColor":"#EA580C","chiefComplaint":"One sentence","clinicalSummary":"Two short sentences","differentials":[{"name":"Diagnosis 1","likelihood":"High","note":"Brief rationale"},{"name":"Diagnosis 2","likelihood":"Moderate","note":"Brief rationale"},{"name":"Diagnosis 3","likelihood":"Lower","note":"Brief rationale"}],"redFlags":["flag if any, else empty array"],"zoonoticRisk":"one sentence or null","allergyMedAlert":"warning or null","examFocus":["area 1","area 2","area 3"],"diagnostics":["test 1","test 2","test 3"],"ownerQuestions":["question 1","question 2","question 3"],"medicationNote":"one sentence or null","breedNote":"one sentence or null","estimatedVisitType":"short description","prognosisNote":"one sentence"}`;

// ── Data ──────────────────────────────────────────────────────────────────────
const SPECIES_DATA = {
  Dog: {
    emoji: "🐕",
    color: "#0369A1",
    bg: "#F0F9FF",
    breeds: ["Labrador Retriever","Golden Retriever","German Shepherd","French Bulldog","Bulldog","Poodle","Beagle","Rottweiler","Yorkshire Terrier","Dachshund","Shih Tzu","Siberian Husky","Border Collie","Doberman","Great Dane","Boxer","Cocker Spaniel","Mixed breed","Other"],
    symptoms: ["Not eating / reduced appetite","Vomiting","Diarrhea","Lethargy / low energy","Limping or lameness","Scratching / itching","Coughing","Sneezing","Eye discharge","Ear problems","Excessive thirst","Frequent urination","Swollen abdomen","Weight loss","Breathing difficulty","Seizures","Bleeding or wounds","Skin lumps or growths","Behavioural changes","Bad breath / dental issues"],
    medPlaceholder: "e.g. Heartgard Plus (monthly), Apoquel 16mg daily, Rimadyl 75mg as needed",
  },
  Cat: {
    emoji: "🐈",
    color: "#7C3AED",
    bg: "#F5F3FF",
    breeds: ["Domestic Shorthair","Domestic Longhair","Persian","Maine Coon","Siamese","Ragdoll","Bengal","Scottish Fold","Sphynx","British Shorthair","Russian Blue","Burmese","Abyssinian","Mixed breed","Other"],
    symptoms: ["Not eating / reduced appetite","Vomiting","Diarrhea","Lethargy / low energy","Hiding more than usual","Coughing or wheezing","Sneezing","Eye discharge","Straining to urinate","Blood in urine","Excessive grooming","Hair loss or bald patches","Limping","Weight loss","Increased vocalization","Swollen abdomen","Breathing difficulty","Behavioural changes","Bad breath / dental issues"],
    medPlaceholder: "e.g. Revolution (monthly), Onsior 6mg as needed, Prednisolone 5mg daily",
  },
  Rabbit: {
    emoji: "🐇",
    color: "#B45309",
    bg: "#FFFBEB",
    breeds: ["Holland Lop","Mini Rex","Lionhead","Dutch","Flemish Giant","Angora","Himalayan","New Zealand","Mixed breed","Other"],
    symptoms: ["Not eating","No droppings or gut stasis","Diarrhea or soft cecotropes","Lethargy","Head tilt","Eye discharge","Nasal discharge","Teeth grinding (bruxism)","Weight loss","Fur loss or mites","Swelling","Breathing difficulty","Seizures","Urine changes","Behavioural changes"],
    medPlaceholder: "e.g. Metacam 0.5mg/kg daily, Panacur 20mg/kg for 9 days",
  },
  Bird: {
    emoji: "🦜",
    color: "#15803D",
    bg: "#F0FDF4",
    breeds: ["Budgerigar","Cockatiel","African Grey","Macaw","Conure","Lovebird","Canary","Amazon Parrot","Cockatoo","Eclectus","Pionus","Other"],
    symptoms: ["Not eating","Fluffed feathers","Eye discharge","Nasal discharge","Breathing difficulty or tail bobbing","Regurgitating","Abnormal droppings","Feather plucking or destruction","Weight loss","Falling off perch","Seizures","Voice or vocalization changes","Crop issues","Behavioural changes"],
    medPlaceholder: "e.g. Doxycycline 25mg/kg once daily, Nystatin 300,000 IU/kg twice daily",
  },
  "Small Animal": {
    emoji: "🐹",
    color: "#BE185D",
    bg: "#FDF2F8",
    breeds: ["Guinea Pig","Hamster","Gerbil","Rat","Mouse","Chinchilla","Ferret","Hedgehog","Degu","Sugar Glider","Other"],
    symptoms: ["Not eating","Lethargy","Diarrhea or wet tail","Weight loss","Lumps or growths","Fur loss","Eye discharge","Nasal discharge","Limping","Breathing difficulty","Seizures","Abnormal droppings","Behavioural changes"],
    medPlaceholder: "e.g. Baytril 10mg/kg twice daily, Metacam 0.5mg/kg daily",
  },
};

const SPECIES_LIST = Object.keys(SPECIES_DATA);

const VACC_OPTIONS = ["Up to date","Overdue — unsure when last done","Partially vaccinated","Not vaccinated","Unknown"];
const DIET_OPTIONS = ["Dry kibble","Wet food","Raw / BARF","Home-cooked","Mixed","Hay & pellets","Seeds & pellets","Specialist diet","Other"];

// ── Wait Timer ────────────────────────────────────────────────────────────────
function useWaitTimer(startTime) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTime) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startTime]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Shared UI Atoms ───────────────────────────────────────────────────────────
const T = {
  primary: "#0F172A",
  secondary: "#475569",
  muted: "#94A3B8",
  border: "#E2E8F0",
  surface: "#F8FAFC",
  white: "#FFFFFF",
};

function Label({ children, required }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.secondary, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
      {children}{required && <span style={{ color: "#EF4444", marginLeft: 3 }}>*</span>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text", style = {} }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 10,
        padding: "10px 13px", fontSize: 14, outline: "none",
        fontFamily: "inherit", color: T.primary, background: T.white,
        boxSizing: "border-box", transition: "border-color 0.15s", ...style,
      }}
      onFocus={(e) => (e.target.style.borderColor = "#2D9B5A")}
      onBlur={(e) => (e.target.style.borderColor = T.border)}
    />
  );
}

function SelectInput({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 10,
        padding: "10px 13px", fontSize: 14, outline: "none",
        fontFamily: "inherit", color: value ? T.primary : T.muted,
        background: T.white, boxSizing: "border-box", cursor: "pointer",
        appearance: "none", WebkitAppearance: "none",
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 10,
        padding: "10px 13px", fontSize: 14, outline: "none",
        fontFamily: "inherit", color: T.primary, background: T.white,
        boxSizing: "border-box", resize: "vertical", lineHeight: 1.5,
      }}
      onFocus={(e) => (e.target.style.borderColor = "#2D9B5A")}
      onBlur={(e) => (e.target.style.borderColor = T.border)}
    />
  );
}

function Chip({ label, active, onClick, activeColor = "#15803D", activeBg = "#DCFCE7" }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer",
        fontFamily: "inherit", transition: "all 0.15s", border: "1.5px solid",
        borderColor: active ? activeColor : T.border,
        background: active ? activeBg : T.white,
        color: active ? activeColor : T.secondary,
        fontWeight: active ? 700 : 400,
      }}
    >
      {label}
    </button>
  );
}

function Row2({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>{children}</div>;
}

function Row3({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>{children}</div>;
}

function Field({ label, required, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: T.border, margin: "4px 0" }} />;
}

function SectionTitle({ children }) {
  return <div style={{ fontWeight: 800, fontSize: 16, color: T.primary, marginBottom: 16 }}>{children}</div>;
}

function ErrorBox({ msg }) {
  return (
    <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#DC2626", marginTop: 8 }}>
      ⚠️ {msg}
    </div>
  );
}

// ── Progress Header ───────────────────────────────────────────────────────────
function ProgressHeader({ step, species }) {
  const sp = SPECIES_DATA[species] || SPECIES_DATA.Dog;
  const steps = ["Owner & Pet", "Symptoms", "History", "Review"];
  const pct = Math.round(((step - 1) / 3) * 100);
  return (
    <div style={{ background: "linear-gradient(135deg, #052e16 0%, #14532d 60%, #15803d 100%)", borderRadius: "20px 20px 0 0", padding: "22px 28px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: "#ffffff18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>
          {sp.emoji}
        </div>
        <div>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: 21, letterSpacing: "-0.02em" }}>Pawprint Animal Clinic</div>
          <div style={{ color: "#86efac", fontSize: 13 }}>Pet check-in — takes about 2 minutes</div>
        </div>
      </div>
      <div style={{ display: "flex" }}>
        {steps.map((s, i) => (
          <div key={s} style={{ flex: 1, textAlign: "center" }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", margin: "0 auto 7px",
              background: step > i + 1 ? "#86efac" : step === i + 1 ? "#fff" : "#ffffff25",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700,
              color: step > i + 1 ? "#14532d" : step === i + 1 ? "#15803d" : "#ffffff60",
            }}>
              {step > i + 1 ? "✓" : i + 1}
            </div>
            <div style={{ fontSize: 11, paddingBottom: 12, color: step === i + 1 ? "#fff" : "#ffffff60", fontWeight: step === i + 1 ? 700 : 400 }}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 3, background: "#ffffff20", borderRadius: 3 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "#86efac", borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

// ── Nav Buttons ───────────────────────────────────────────────────────────────
function NavButtons({ step, onBack, onNext, onSubmit, canProceed, loading }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28, paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
      {step > 1
        ? <button onClick={onBack} style={{ background: "none", border: `1.5px solid ${T.border}`, borderRadius: 12, padding: "11px 22px", fontSize: 14, color: T.secondary, cursor: "pointer", fontFamily: "inherit" }}>← Back</button>
        : <div />
      }
      {step < 4
        ? <button onClick={onNext} disabled={!canProceed} style={{ background: canProceed ? "#15803d" : T.border, color: "#fff", border: "none", borderRadius: 12, padding: "11px 26px", fontSize: 14, fontWeight: 700, cursor: canProceed ? "pointer" : "not-allowed", fontFamily: "inherit", transition: "background 0.2s" }}>
            Continue →
          </button>
        : <button onClick={onSubmit} disabled={!canProceed || loading} style={{ background: canProceed ? "#15803d" : T.border, color: "#fff", border: "none", borderRadius: 12, padding: "11px 26px", fontSize: 14, fontWeight: 700, cursor: canProceed ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
            {loading ? "Submitting…" : "Submit check-in ✓"}
          </button>
      }
    </div>
  );
}

// ── STEP 1: Owner & Pet ───────────────────────────────────────────────────────
function Step1({ form, upd, photoPreview, onPhoto }) {
  const photoRef = useRef();
  const sp = SPECIES_DATA[form.species];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionTitle>Your details</SectionTitle>
      <Row2>
        <Field label="Your first name" required><TextInput value={form.ownerFirst} onChange={(v) => upd("ownerFirst", v)} placeholder="Sarah" /></Field>
        <Field label="Last name" required><TextInput value={form.ownerLast} onChange={(v) => upd("ownerLast", v)} placeholder="Johnson" /></Field>
      </Row2>
      <Row2>
        <Field label="Phone"><TextInput value={form.ownerPhone} onChange={(v) => upd("ownerPhone", v)} placeholder="(416) 555-0100" /></Field>
        <Field label="Email"><TextInput value={form.ownerEmail} onChange={(v) => upd("ownerEmail", v)} placeholder="sarah@email.com" /></Field>
      </Row2>

      <Divider />
      <SectionTitle>Your pet</SectionTitle>

      {/* Photo + name */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          onClick={() => photoRef.current.click()}
          style={{ width: 82, height: 82, borderRadius: 18, background: photoPreview ? "transparent" : "#F0FDF4", border: `2px dashed #86efac`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", flexShrink: 0, transition: "background 0.2s" }}
        >
          {photoPreview
            ? <img src={photoPreview} alt="pet" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontSize: 36 }}>📷</span>
          }
        </div>
        <div>
          <div style={{ fontWeight: 600, color: T.primary, fontSize: 14, marginBottom: 5 }}>Pet photo <span style={{ color: T.muted, fontWeight: 400 }}>(helps the vet recognise them)</span></div>
          <button onClick={() => photoRef.current.click()} style={{ background: "#F0FDF4", border: "1.5px solid #86efac", borderRadius: 8, padding: "7px 16px", fontSize: 13, color: "#15803d", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
            {photoPreview ? "Change photo" : "Upload photo"}
          </button>
        </div>
        <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPhoto} />
      </div>

      <Field label="Pet's name" required><TextInput value={form.petName} onChange={(v) => upd("petName", v)} placeholder="e.g. Buddy" /></Field>

      <Field label="Species" required>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
          {SPECIES_LIST.map((s) => (
            <Chip key={s} label={`${SPECIES_DATA[s].emoji} ${s}`} active={form.species === s}
              onClick={() => { upd("species", s); upd("symptoms", []); upd("breed", ""); }}
              activeColor={SPECIES_DATA[s].color} activeBg={SPECIES_DATA[s].bg} />
          ))}
        </div>
      </Field>

      <Row2>
        <Field label="Breed">
          <SelectInput value={form.breed} onChange={(v) => upd("breed", v)} placeholder="Unknown / mixed" options={sp.breeds} />
        </Field>
        <Field label="Age">
          <div style={{ display: "flex", gap: 8 }}>
            <TextInput value={form.age} onChange={(v) => upd("age", v)} placeholder="e.g. 3" style={{ flex: 1 }} />
            <select value={form.ageUnit} onChange={(e) => upd("ageUnit", e.target.value)} style={{ border: "1.5px solid #E2E8F0", borderRadius: 10, padding: "10px 12px", fontSize: 14, outline: "none", fontFamily: "inherit", color: "#0F172A", background: "#FFFFFF", cursor: "pointer" }}>
              <option value="years">years</option>
              <option value="months">months</option>
              <option value="weeks">weeks</option>
            </select>
          </div>
        </Field>
      </Row2>

      <Row3>
        <Field label="Weight (kg)"><TextInput value={form.weight} onChange={(v) => upd("weight", v)} placeholder="12.5" /></Field>
        <Field label="Sex">
          <SelectInput value={form.sex} onChange={(v) => upd("sex", v)} placeholder="Unknown" options={["Male", "Female"]} />
        </Field>
        <Field label="Neutered / spayed?">
          <SelectInput value={form.neutered} onChange={(v) => upd("neutered", v)} placeholder="Unknown" options={["Yes", "No"]} />
        </Field>
      </Row3>
    </div>
  );
}

// ── STEP 2: Symptoms ──────────────────────────────────────────────────────────
function Step2({ form, upd, toggleSym }) {
  const sp = SPECIES_DATA[form.species];
  const sevColor = form.severity >= 8 ? "#DC2626" : form.severity >= 5 ? "#EA580C" : "#15803d";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionTitle>What's going on with {form.petName || "your pet"}?</SectionTitle>

      <Field label="Select all symptoms" required>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {sp.symptoms.map((s) => (
            <Chip key={s} label={s} active={form.symptoms.includes(s)} onClick={() => toggleSym(s)} activeColor={sp.color} activeBg={sp.bg} />
          ))}
        </div>
      </Field>

      <Row2>
        <Field label="How long?" required><TextInput value={form.duration} onChange={(v) => upd("duration", v)} placeholder="e.g. 2 days, since this morning" /></Field>
        <Field label="Onset">
          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            {["Sudden", "Gradual", "Recurring"].map((o) => (
              <Chip key={o} label={o} active={form.onset === o} onClick={() => upd("onset", o)} />
            ))}
          </div>
        </Field>
      </Row2>

      <Field label={`Severity — ${form.severity}/10`}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
          <span style={{ fontSize: 13, color: "#15803d" }}>Mild</span>
          <input type="range" min="1" max="10" value={form.severity} step="1"
            onChange={(e) => upd("severity", parseInt(e.target.value))}
            style={{ flex: 1, accentColor: sevColor, cursor: "pointer" }} />
          <span style={{ fontSize: 13, color: "#DC2626" }}>Severe</span>
        </div>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 28, color: sevColor, marginTop: 6 }}>{form.severity}<span style={{ fontSize: 16, fontWeight: 400, color: T.muted }}>/10</span></div>
      </Field>

      <Field label="When did your pet last eat normally?">
        <TextInput value={form.lastAte} onChange={(v) => upd("lastAte", v)} placeholder="e.g. This morning, 2 days ago, yesterday evening" />
      </Field>

      <Field label="Additional flags">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {[
            ["recentTravel", "✈️ Recent travel or boarding"],
            ["contactAnimals", "🐾 Contact with other animals"],
            ["outdoor", "🌿 Outdoor or garden access"],
            ["recentChange", "🏠 Recent change at home"],
          ].map(([key, label]) => (
            <Chip key={key} label={label} active={form[key]} onClick={() => upd(key, !form[key])} />
          ))}
        </div>
      </Field>
    </div>
  );
}

// ── STEP 3: History ───────────────────────────────────────────────────────────
function Step3({ form, upd }) {
  const sp = SPECIES_DATA[form.species];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionTitle>Medical background</SectionTitle>

      <Row2>
        <Field label="Vaccination status">
          <SelectInput value={form.vaccinations} onChange={(v) => upd("vaccinations", v)} placeholder="Unknown" options={VACC_OPTIONS} />
        </Field>
        <Field label="Last vet visit">
          <TextInput value={form.lastVisit} onChange={(v) => upd("lastVisit", v)} placeholder="e.g. 6 months ago, Jan 2024" />
        </Field>
      </Row2>

      <Field label="Current medications & supplements">
        <TextArea value={form.currentMeds} onChange={(v) => upd("currentMeds", v)} placeholder={sp.medPlaceholder} rows={3} />
      </Field>

      <Field label="Known allergies or previous adverse reactions">
        <TextInput value={form.allergies} onChange={(v) => upd("allergies", v)} placeholder="e.g. Amoxicillin — vomiting and hives, chicken protein — skin flare" />
      </Field>

      <Field label="Current diet">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {DIET_OPTIONS.map((d) => (
            <Chip key={d} label={d} active={form.diet === d} onClick={() => upd("diet", d)} />
          ))}
        </div>
      </Field>

      <Divider />

      <Field label="Anything else the vet should know?">
        <TextArea value={form.extraNotes} onChange={(v) => upd("extraNotes", v)}
          placeholder={`Personality, previous diagnoses, what worries you most about ${form.petName || "your pet"} today…`} rows={4} />
      </Field>
    </div>
  );
}

// ── STEP 4: Review ────────────────────────────────────────────────────────────
function Step4({ form, photoPreview }) {
  const sp = SPECIES_DATA[form.species];
  const flags = [
    form.recentTravel && "Recent travel / boarding",
    form.contactAnimals && "Contact with other animals",
    form.outdoor && "Outdoor access",
    form.recentChange && "Recent home change",
  ].filter(Boolean);

  const vaccAlert = form.vaccinations && (form.vaccinations.includes("Overdue") || form.vaccinations === "Not vaccinated");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionTitle>Review before submitting</SectionTitle>

      {/* Pet summary card */}
      <div style={{ background: sp.bg, border: `1.5px solid ${sp.color}40`, borderRadius: 16, padding: "16px 18px", display: "flex", gap: 16, alignItems: "center" }}>
        {photoPreview
          ? <img src={photoPreview} alt="pet" style={{ width: 68, height: 68, borderRadius: 14, objectFit: "cover", flexShrink: 0, border: `2px solid ${sp.color}60` }} />
          : <div style={{ width: 68, height: 68, borderRadius: 14, background: `${sp.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, flexShrink: 0 }}>{sp.emoji}</div>
        }
        <div>
          <div style={{ fontWeight: 900, fontSize: 20, color: T.primary }}>{form.petName || "—"}</div>
          <div style={{ fontSize: 14, color: sp.color, fontWeight: 600 }}>{form.species}{form.breed ? ` · ${form.breed}` : ""}</div>
          <div style={{ fontSize: 13, color: T.secondary, marginTop: 2 }}>
            {form.age ? `${form.age} ${form.ageUnit}` : "Age unknown"}{form.weight ? ` · ${form.weight} kg` : ""}{form.sex ? ` · ${form.sex}` : ""}{form.neutered ? ` · ${form.neutered === "Yes" ? "Neutered/Spayed" : "Intact"}` : ""}
          </div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 1 }}>Owner: {form.ownerFirst} {form.ownerLast}{form.ownerPhone ? ` · ${form.ownerPhone}` : ""}</div>
        </div>
      </div>

      {[
        ["Symptoms", form.symptoms.join(", ") || "—"],
        ["Duration", `${form.duration}${form.onset ? ` · ${form.onset} onset` : ""}`],
        ["Severity", `${form.severity}/10`, form.severity >= 7],
        ["Last ate", form.lastAte || "Not specified"],
        ["Vaccinations", form.vaccinations || "Unknown", vaccAlert],
        ["Medications", form.currentMeds || "None listed"],
        form.allergies ? ["⚠️ Allergies", form.allergies, true] : null,
        form.diet ? ["Diet", form.diet] : null,
        flags.length ? ["Flags", flags.join(", ")] : null,
        form.extraNotes ? ["Notes", form.extraNotes] : null,
      ].filter(Boolean).map(([label, value, highlight]) => (
        <div key={label} style={{ display: "flex", gap: 14, padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 13, color: T.muted, minWidth: 110 }}>{label}</div>
          <div style={{ fontSize: 13, color: highlight ? "#DC2626" : T.primary, fontWeight: highlight ? 700 : 400, flex: 1 }}>{value}</div>
        </div>
      ))}

      <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
        Information is shared with your vet team for this visit only.
      </div>
    </div>
  );
}

// ── INTAKE FORM (container) ───────────────────────────────────────────────────
function IntakeForm({ onSubmit }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    ownerFirst: "", ownerLast: "", ownerPhone: "", ownerEmail: "",
    petName: "", species: "Dog", breed: "", age: "", ageUnit: "years",
    weight: "", sex: "", neutered: "",
    symptoms: [], duration: "", severity: 5, onset: "Gradual",
    lastAte: "", recentTravel: false, contactAnimals: false, outdoor: false, recentChange: false,
    vaccinations: "", lastVisit: "", currentMeds: "", allergies: "",
    diet: "", extraNotes: "",
  });
  const [photoPreview, setPhotoPreview] = useState(null);

  const upd = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const toggleSym = (s) => setForm((f) => ({
    ...f, symptoms: f.symptoms.includes(s) ? f.symptoms.filter((x) => x !== s) : [...f.symptoms, s],
  }));

  const canProceed = step === 1
    ? !!(form.ownerFirst && form.ownerLast && form.petName)
    : step === 2
    ? form.symptoms.length > 0 && !!form.duration
    : true;

  function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => setPhotoPreview(ev.target.result);
    r.readAsDataURL(file);
  }

  return (
    <div style={{ background: T.white, borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.10)", overflow: "hidden", maxWidth: 660, margin: "0 auto" }}>
      <ProgressHeader step={step} species={form.species} />
      <div style={{ padding: "28px 32px" }}>
        {step === 1 && <Step1 form={form} upd={upd} photoPreview={photoPreview} onPhoto={handlePhoto} />}
        {step === 2 && <Step2 form={form} upd={upd} toggleSym={toggleSym} />}
        {step === 3 && <Step3 form={form} upd={upd} />}
        {step === 4 && <Step4 form={form} photoPreview={photoPreview} />}
        <NavButtons step={step} onBack={() => setStep((s) => s - 1)} onNext={() => setStep((s) => s + 1)}
          onSubmit={() => onSubmit(form, photoPreview)} canProceed={canProceed} />
      </div>
    </div>
  );
}

// ── VITALS PANEL ─────────────────────────────────────────────────────────────
function VitalsPanel({ vitals, setVitals, species, petName }) {
  const isBird = species === "Bird";
  const isSmall = species === "Small Animal" || species === "Rabbit";
  const hrPlaceholder = isBird ? "300" : species === "Cat" ? "160" : isSmall ? "200" : "80";
  const tempPlaceholder = isBird ? "41.0" : "38.5";

  const fields = [
    { key: "temp", label: "Temperature", unit: "°C", placeholder: tempPlaceholder },
    { key: "hr", label: "Heart rate", unit: "bpm", placeholder: hrPlaceholder },
    { key: "rr", label: "Respiratory rate", unit: "/min", placeholder: "20" },
    { key: "weight", label: "Weight (confirm)", unit: "kg", placeholder: "—" },
    { key: "bcs", label: "Body condition score", unit: "/9", placeholder: "5" },
    { key: "mm", label: "Mucous membranes", unit: "", placeholder: "Pink & moist" },
  ];

  return (
    <div style={{ background: T.white, borderRadius: 16, padding: "22px 24px", border: `1.5px solid ${T.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "#F0FDF4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🩺</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.primary }}>Vet tech vitals entry</div>
          <div style={{ fontSize: 12, color: T.muted }}>Record {petName}'s vitals before generating the vet card</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {fields.map((f) => (
          <div key={f.key}>
            <Label>{f.label}{f.unit ? ` (${f.unit})` : ""}</Label>
            <TextInput value={vitals[f.key] || ""} onChange={(v) => setVitals((prev) => ({ ...prev, [f.key]: v }))} placeholder={f.placeholder} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TRIAGE CARD ───────────────────────────────────────────────────────────────
function TriageCard({ result, form, photoPreview, vitals, startTime }) {
  const wait = useWaitTimer(startTime);
  const sp = SPECIES_DATA[form.species];
  const c = result.triageColor || "#15803d";
  const levelLabel = {
    "#DC2626": "EMERGENCY",
    "#EA580C": "URGENT",
    "#CA8A04": "SEMI-URGENT",
    "#15803D": "ROUTINE",
  }[c] || result.triageLevel;

  const vitalsDisplay = [
    vitals.temp && { label: "Temp", value: `${vitals.temp}°C` },
    vitals.hr && { label: "HR", value: `${vitals.hr} bpm` },
    vitals.rr && { label: "RR", value: `${vitals.rr}/min` },
    vitals.weight && { label: "Weight", value: `${vitals.weight} kg` },
    vitals.bcs && { label: "BCS", value: `${vitals.bcs}/9` },
    vitals.mm && { label: "MM", value: vitals.mm },
  ].filter(Boolean);

  const SL = ({ children, color }) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: color || T.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7 }}>{children}</div>
  );

  const likelihoodColor = { High: "#DC2626", Moderate: "#EA580C", Lower: "#64748B" };

  return (
    <div style={{ border: `2px solid ${c}`, borderRadius: 20, overflow: "hidden", background: T.white, boxShadow: "0 8px 40px rgba(0,0,0,0.10)" }}>

      {/* Header band */}
      <div style={{ background: c, padding: "18px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {photoPreview
              ? <img src={photoPreview} alt="pet" style={{ width: 70, height: 70, borderRadius: 16, objectFit: "cover", border: "3px solid rgba(255,255,255,0.4)", flexShrink: 0 }} />
              : <div style={{ width: 70, height: 70, borderRadius: 16, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, flexShrink: 0 }}>{sp.emoji}</div>
            }
            <div>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: 24, letterSpacing: "-0.02em" }}>{form.petName}</div>
              <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 3 }}>
                {form.species}{form.breed ? ` · ${form.breed}` : ""} · {form.age ? `${form.age} ${form.ageUnit}` : "Age unknown"} · {form.weight ? `${form.weight} kg` : "Weight TBD"}
              </div>
              <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 3 }}>
                {form.sex || "Sex unknown"}{form.neutered ? ` · ${form.neutered === "Yes" ? "Neutered/Spayed" : "Intact"}` : ""} · Owner: {form.ownerFirst} {form.ownerLast}{form.ownerPhone ? ` · ${form.ownerPhone}` : ""}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ background: "rgba(255,255,255,0.25)", color: "#fff", borderRadius: 10, padding: "8px 16px", fontWeight: 900, fontSize: 15, letterSpacing: "0.05em" }}>{levelLabel}</div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 7 }}>⏱ Wait: {wait}</div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 3 }}>Vacc: {form.vaccinations || "Unknown"}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Alerts */}
        {result.allergyMedAlert && (
          <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 12, padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 11, color: "#DC2626", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Allergy / Medication Alert</div>
              <div style={{ fontSize: 13, color: "#7F1D1D", lineHeight: 1.6 }}>{result.allergyMedAlert}</div>
            </div>
          </div>
        )}

        {result.zoonoticRisk && (
          <div style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA", borderRadius: 12, padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>🦠</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 11, color: "#C2410C", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>Zoonotic Risk — Advise Owner</div>
              <div style={{ fontSize: 13, color: "#7C2D12", lineHeight: 1.6 }}>{result.zoonoticRisk}</div>
            </div>
          </div>
        )}

        {/* Chief complaint */}
        <div style={{ background: `${c}12`, borderLeft: `4px solid ${c}`, borderRadius: "0 10px 10px 0", padding: "12px 16px" }}>
          <SL color={c}>Chief Complaint</SL>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.primary, lineHeight: 1.5 }}>{result.chiefComplaint}</div>
        </div>

        {/* Clinical summary */}
        <div>
          <SL>Clinical Summary</SL>
          <div style={{ fontSize: 13, color: T.secondary, lineHeight: 1.75 }}>{result.clinicalSummary}</div>
        </div>

        {/* Vitals */}
        {vitalsDisplay.length > 0 && (
          <div>
            <SL>Vitals</SL>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {vitalsDisplay.map((v, i) => (
                <div key={i} style={{ background: T.surface, borderRadius: 10, padding: "10px 16px", textAlign: "center", border: `1px solid ${T.border}`, minWidth: 72 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.primary }}>{v.value}</div>
                  <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, marginTop: 2 }}>{v.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Differentials */}
        <div>
          <SL>Differential Diagnoses</SL>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {result.differentials?.map((d, i) => (
              <div key={i} style={{ background: T.surface, borderRadius: 10, padding: "10px 14px", border: `1px solid ${T.border}`, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: likelihoodColor[d.likelihood] || T.muted, background: `${likelihoodColor[d.likelihood]}18`, borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap", marginTop: 1 }}>{d.likelihood}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: T.primary }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: T.secondary, marginTop: 2 }}>{d.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Red flags */}
        {result.redFlags?.filter(Boolean).length > 0 && (
          <div style={{ background: "#FFF1F2", borderRadius: 12, padding: "12px 16px", border: "1.5px solid #FECDD3" }}>
            <SL color="#E11D48">⚑ Red Flags</SL>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {result.redFlags.filter(Boolean).map((r, i) => (
                <span key={i} style={{ background: "#FFE4E6", color: "#9F1239", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700 }}>{r}</span>
              ))}
            </div>
          </div>
        )}

        {/* Breed note */}
        {result.breedNote && (
          <div style={{ background: "#F0FDF4", borderRadius: 12, padding: "12px 16px", border: "1.5px solid #BBF7D0" }}>
            <SL color="#15803D">🧬 Breed Considerations</SL>
            <div style={{ fontSize: 13, color: "#14532D", lineHeight: 1.6 }}>{result.breedNote}</div>
          </div>
        )}

        {/* Medication note */}
        {result.medicationNote && (
          <div style={{ background: "#FFF7ED", borderRadius: 12, padding: "12px 16px", border: "1.5px solid #FED7AA" }}>
            <SL color="#C2410C">💊 Medication Notes</SL>
            <div style={{ fontSize: 13, color: "#7C2D12", lineHeight: 1.6 }}>{result.medicationNote}</div>
          </div>
        )}

        {/* 3-column: exam, diagnostics, questions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <div>
            <SL>Exam Focus</SL>
            {result.examFocus?.map((e, i) => (
              <div key={i} style={{ fontSize: 12, color: T.secondary, marginBottom: 5, paddingLeft: 10, borderLeft: `2px solid ${T.border}` }}>{e}</div>
            ))}
          </div>
          <div>
            <SL>Diagnostics</SL>
            {result.diagnostics?.map((d, i) => (
              <div key={i} style={{ fontSize: 12, color: T.secondary, marginBottom: 5, paddingLeft: 10, borderLeft: `2px solid ${T.border}` }}>{d}</div>
            ))}
          </div>
          <div>
            <SL>Ask Owner</SL>
            {result.ownerQuestions?.map((q, i) => (
              <div key={i} style={{ fontSize: 12, color: T.secondary, marginBottom: 5, paddingLeft: 10, borderLeft: `2px solid ${T.border}` }}>{q}</div>
            ))}
          </div>
        </div>

        {/* Prognosis */}
        {result.prognosisNote && (
          <div style={{ background: T.surface, borderRadius: 10, padding: "10px 16px", border: `1px solid ${T.border}` }}>
            <SL>Prognosis</SL>
            <div style={{ fontSize: 13, color: T.secondary, lineHeight: 1.6 }}>{result.prognosisNote}</div>
          </div>
        )}

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: T.muted }}>Visit type: <strong style={{ color: T.secondary }}>{result.estimatedVisitType}</strong></div>
          <div style={{ fontSize: 11, color: T.muted }}>Generated {new Date().toLocaleTimeString()}</div>
        </div>
      </div>
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("intro"); // intro | form | vitals | card
  const [formData, setFormData] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [vitals, setVitals] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [startTime, setStartTime] = useState(null);

  async function handleFormSubmit(form, photoPreview) {
    setFormData(form);
    setPhoto(photoPreview);
    setStartTime(Date.now());
    setView("vitals");
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    const f = formData;
    const flags = [
      f.recentTravel && "Recent travel or boarding",
      f.contactAnimals && "Contact with other animals",
      f.outdoor && "Outdoor/garden access",
      f.recentChange && "Recent change at home",
    ].filter(Boolean);

    const prompt = `
Pet name: ${f.petName}
Species: ${f.species}
Breed: ${f.breed || "Unknown"}
Age: ${f.age ? `${f.age} ${f.ageUnit}` : "Unknown"}
Weight: ${f.weight ? `${f.weight} kg` : "Unknown"}
Sex: ${f.sex || "Unknown"}
Neutered/Spayed: ${f.neutered || "Unknown"}
Owner: ${f.ownerFirst} ${f.ownerLast}

Presenting symptoms: ${f.symptoms.join(", ")}
Duration: ${f.duration}
Onset: ${f.onset}
Severity: ${f.severity}/10
Last ate normally: ${f.lastAte || "Not reported"}
Environmental flags: ${flags.join(", ") || "None"}

Vaccination status: ${f.vaccinations || "Unknown"}
Last vet visit: ${f.lastVisit || "Unknown"}
Current medications: ${f.currentMeds || "None"}
Known allergies: ${f.allergies || "None"}
Diet: ${f.diet || "Not specified"}
Vitals recorded: ${Object.entries(vitals).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ") || "Not yet recorded"}

Owner notes: ${f.extraNotes || "None"}
    `.trim();

    try {
      const raw = await callClaude(prompt, VET_SYSTEM);
      const parsed = parseJSON(raw);
      if (!parsed) {
        // Show first 300 chars of raw response to help diagnose
        const preview = raw ? raw.substring(0, 300) : "(empty response)";
        throw new Error("Parse failed. Raw response: " + preview);
      }
      setResult(parsed);
      setView("card");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Suggested notes state ────────────────────────────────────────────────────
  const [suggestedNotes, setSuggestedNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // ── Release notes state ──────────────────────────────────────────────────────
  const [releaseNotes, setReleaseNotes] = useState("");
  const [vetName, setVetName] = useState("");
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split("T")[0]);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanced, setEnhanced] = useState("");
  const [released, setReleased] = useState(false);

  async function loadSuggestions(triageResult, form) {
    setLoadingSuggestions(true);
    const prompt = `Based on this veterinary case, generate exactly 3 concise clinical consultation note options a vet could use. Each should be a brief paragraph (3-5 sentences) covering: findings, assessment, and plan. Make each option distinct in approach — one more conservative, one moderate, one more thorough. Return ONLY a JSON array of 3 strings: ["note1","note2","note3"]

Pet: ${form.petName}, ${form.species}${form.breed ? `, ${form.breed}` : ""}, ${form.age ? `${form.age} ${form.ageUnit}` : "age unknown"}.
Chief complaint: ${triageResult.chiefComplaint}
Triage level: ${triageResult.triageLevel}
Top differentials: ${triageResult.differentials?.map(d => d.name).join(", ")}
Clinical summary: ${triageResult.clinicalSummary}`;
    try {
      const raw = await callClaude(prompt, "You are a veterinary clinical notes assistant. Return ONLY a valid JSON array of exactly 3 strings. No preamble, no markdown.");
      let parsed = null;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch {}
      if (!parsed) { const m = raw.match(/\[[\s\S]*\]/); if (m) try { parsed = JSON.parse(m[0]); } catch {} }
      if (parsed && Array.isArray(parsed)) setSuggestedNotes(parsed);
    } catch {}
    finally { setLoadingSuggestions(false); }
  }

  async function handleEnhance() {
    if (!releaseNotes.trim()) return;
    setEnhancing(true);
    const prompt = `Enhance these veterinary discharge/release notes to be more professional, clear, and complete. Keep the same core information and intent but improve clinical language, structure, and completeness. Return ONLY the enhanced notes text, no preamble.

Original notes: ${releaseNotes}
Pet: ${formData?.petName}, ${formData?.species}
Vet: ${vetName || "Dr. [Name]"}
Date: ${visitDate}`;
    try {
      const enhanced = await callClaude(prompt, "You are a veterinary clinical documentation specialist. Return only the enhanced notes text, ready to use as-is.");
      setEnhanced(enhanced);
    } catch (e) { setEnhanced("Enhancement failed — " + e.message); }
    finally { setEnhancing(false); }
  }

  function handleRelease() { setReleased(true); }

  function reset() {
    setView("intro"); setFormData(null); setPhoto(null); setVitals({});
    setResult(null); setError(null); setStartTime(null);
    setSuggestedNotes([]); setSelectedNote(null); setLoadingSuggestions(false);
    setReleaseNotes(""); setVetName(""); setVisitDate(new Date().toISOString().split("T")[0]);
    setEnhancing(false); setEnhanced(""); setReleased(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F1F8F4", fontFamily: "'Inter', system-ui, -apple-system, sans-serif", padding: "28px 16px 56px" }}>

      {/* INTRO */}
      {view === "intro" && (
        <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", paddingTop: 32 }}>
          <div style={{ fontSize: 68, marginBottom: 14 }}>🐾</div>
          <h1 style={{ fontWeight: 900, fontSize: 30, color: "#052e16", margin: "0 0 12px", letterSpacing: "-0.03em" }}>Welcome to VetDesk</h1>
          <p style={{ color: "#166534", fontSize: 15, lineHeight: 1.75, margin: "0 0 32px" }}>
            Help us give your pet the best care by checking in before your appointment.
            Takes about <strong>2–3 minutes.</strong>
          </p>
          <div style={{ background: T.white, borderRadius: 18, padding: "24px 26px", marginBottom: 32, boxShadow: "0 4px 20px rgba(0,0,0,0.06)", textAlign: "left", border: "1px solid #D1FAE5" }}>
            {[
              ["🧑", "Owner & pet details", "Your name, your pet's name, species, age, and a photo"],
              ["🤒", "What's wrong today", "Symptoms, how long, and how severe"],
              ["💊", "Medical background", "Vaccinations, medications, and known allergies"],
              ["✅", "Review & submit", "Confirm everything and send directly to your vet team"],
            ].map(([icon, title, desc]) => (
              <div key={title} style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 16 }}>
                <span style={{ fontSize: 22, width: 34, flexShrink: 0 }}>{icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: T.primary }}>{title}</div>
                  <div style={{ fontSize: 13, color: T.secondary, marginTop: 2 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setView("form")} style={{ background: "linear-gradient(135deg, #052e16 0%, #15803d 100%)", color: "#fff", border: "none", borderRadius: 16, padding: "17px 48px", fontSize: 16, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.01em", boxShadow: "0 4px 16px rgba(21,128,61,0.35)" }}>
            Begin check-in →
          </button>
          <div style={{ fontSize: 12, color: "#86efac", marginTop: 16 }}>Information shared with your vet team for this visit only</div>
        </div>
      )}

      {/* FORM */}
      {view === "form" && <IntakeForm onSubmit={handleFormSubmit} />}

      {/* VITALS */}
      {view === "vitals" && (
        <div style={{ maxWidth: 580, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: "#DCFCE7", borderRadius: 16, padding: "18px 22px", border: "1.5px solid #86efac", display: "flex", gap: 14, alignItems: "center" }}>
            <span style={{ fontSize: 32 }}>✅</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#14532D" }}>Check-in complete — thank you, {formData?.ownerFirst}!</div>
              <div style={{ fontSize: 13, color: "#166534", marginTop: 3 }}>A vet tech will be with {formData?.petName} shortly. Please remain in the waiting area.</div>
            </div>
          </div>
          <div style={{ background: "#EFF6FF", borderRadius: 12, padding: "12px 18px", border: "1px solid #BFDBFE", fontSize: 13, color: "#1E40AF" }}>
            <strong>For clinic staff:</strong> Enter {formData?.petName}'s vitals below, then generate the consultation card.
          </div>
          <VitalsPanel vitals={vitals} setVitals={setVitals} species={formData?.species} petName={formData?.petName} />
          {error && <ErrorBox msg={error} />}
          <button onClick={handleGenerate} disabled={loading} style={{ background: loading ? T.muted : "linear-gradient(135deg, #052e16, #15803d)", color: "#fff", border: "none", borderRadius: 14, padding: "17px", fontSize: 15, fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", boxShadow: loading ? "none" : "0 4px 16px rgba(21,128,61,0.35)" }}>
            {loading ? `⏳ Generating ${formData?.petName}'s consultation card…` : `Generate Vet Consultation Card →`}
          </button>
          <button onClick={() => setView("form")} style={{ background: "none", border: "none", color: T.muted, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>← Go back and edit</button>
        </div>
      )}

      {/* CARD */}
      {view === "card" && result && (
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Top bar */}
          <div style={{ background: T.white, borderRadius: 12, padding: "12px 20px", border: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: T.secondary }}>🐾 <strong style={{ color: T.primary }}>VetDesk</strong> — {formData?.petName}'s visit · {new Date().toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}</div>
            <button onClick={reset} style={{ background: "#15803d", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>+ New patient</button>
          </div>

          {/* Triage card */}
          <TriageCard result={result} form={formData} photoPreview={photo} vitals={vitals} startTime={startTime} />

          {/* ── SECTION 2: Suggested consultation notes ── */}
          <div style={{ background: T.white, borderRadius: 20, border: `1px solid ${T.border}`, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
            <div style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)", padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>📋 Suggested Consultation Notes</div>
                <div style={{ color: "#bfdbfe", fontSize: 13, marginTop: 2 }}>Select one as your starting point — or write your own below</div>
              </div>
              {suggestedNotes.length === 0 && !loadingSuggestions && (
                <button
                  onClick={() => loadSuggestions(result, formData)}
                  style={{ background: "#fff", color: "#1d4ed8", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                  Generate suggestions →
                </button>
              )}
            </div>

            <div style={{ padding: "20px 24px" }}>
              {loadingSuggestions && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 0", color: T.secondary, fontSize: 14 }}>
                  <div style={{ width: 20, height: 20, border: "2px solid #E2E8F0", borderTopColor: "#1d4ed8", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                  Generating 3 clinical note options…
                </div>
              )}

              {!loadingSuggestions && suggestedNotes.length === 0 && (
                <div style={{ padding: "24px 0", textAlign: "center", color: T.muted, fontSize: 14 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>📝</div>
                  Click <strong>Generate suggestions</strong> above to get 3 AI-drafted note options based on this case
                </div>
              )}

              {suggestedNotes.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {suggestedNotes.map((note, i) => {
                    const labels = ["Conservative approach", "Moderate approach", "Comprehensive approach"];
                    const icons = ["🟢", "🟡", "🔵"];
                    const isSelected = selectedNote === i;
                    return (
                      <div
                        key={i}
                        onClick={() => { setSelectedNote(i); setReleaseNotes(note); setEnhanced(""); }}
                        style={{ borderRadius: 14, border: `2px solid ${isSelected ? "#1d4ed8" : T.border}`, background: isSelected ? "#EFF6FF" : T.surface, padding: "16px 18px", cursor: "pointer", transition: "all 0.15s" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 16 }}>{icons[i]}</span>
                            <span style={{ fontWeight: 700, fontSize: 13, color: isSelected ? "#1d4ed8" : T.primary }}>{labels[i]}</span>
                          </div>
                          <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${isSelected ? "#1d4ed8" : T.border}`, background: isSelected ? "#1d4ed8" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {isSelected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />}
                          </div>
                        </div>
                        <div style={{ fontSize: 13, color: T.secondary, lineHeight: 1.7 }}>{note}</div>
                        {isSelected && (
                          <div style={{ marginTop: 10, fontSize: 12, color: "#1d4ed8", fontWeight: 600 }}>✓ Selected — edit below or use as-is</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── SECTION 3: Release / Discharge Notes ── */}
          <div style={{ background: T.white, borderRadius: 20, border: `1px solid ${T.border}`, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
            <div style={{ background: "linear-gradient(135deg, #3b0764 0%, #7c3aed 100%)", padding: "18px 24px" }}>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>📄 Discharge & Release Notes</div>
              <div style={{ color: "#e9d5ff", fontSize: 13, marginTop: 2 }}>Write your notes, then sign and release to the owner</div>
            </div>

            <div style={{ padding: "24px" }}>
              {!released ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

                  {/* Notes textarea */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.secondary, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                      Consultation & discharge notes
                    </div>
                    <textarea
                      value={enhanced || releaseNotes}
                      onChange={(e) => { if (enhanced) setEnhanced(e.target.value); else setReleaseNotes(e.target.value); }}
                      placeholder={`Write your notes for ${formData?.petName}'s visit…\n\nE.g. findings on exam, diagnosis, treatment given, medications dispensed, follow-up instructions, owner education provided.`}
                      rows={7}
                      style={{ width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", fontSize: 14, outline: "none", fontFamily: "inherit", color: T.primary, background: enhanced ? "#FAFAF5" : T.white, boxSizing: "border-box", resize: "vertical", lineHeight: 1.7 }}
                      onFocus={(e) => (e.target.style.borderColor = "#7c3aed")}
                      onBlur={(e) => (e.target.style.borderColor = T.border)}
                    />
                    {enhanced && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                        <div style={{ fontSize: 12, color: "#7c3aed", fontWeight: 600 }}>✨ AI-enhanced version — edit freely</div>
                        <button onClick={() => { setEnhanced(""); }} style={{ background: "none", border: "none", fontSize: 12, color: T.muted, cursor: "pointer", fontFamily: "inherit" }}>← Use original</button>
                      </div>
                    )}
                  </div>

                  {/* AI Enhance button */}
                  <button
                    onClick={handleEnhance}
                    disabled={enhancing || !(enhanced || releaseNotes).trim()}
                    style={{ background: enhancing || !(enhanced || releaseNotes).trim() ? T.surface : "#F5F3FF", color: enhancing || !(enhanced || releaseNotes).trim() ? T.muted : "#7c3aed", border: `1.5px solid ${enhancing || !(enhanced || releaseNotes).trim() ? T.border : "#DDD6FE"}`, borderRadius: 12, padding: "12px 20px", fontSize: 14, fontWeight: 700, cursor: enhancing || !(enhanced || releaseNotes).trim() ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    {enhancing ? <><div style={{ width: 16, height: 16, border: "2px solid #DDD6FE", borderTopColor: "#7c3aed", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /> Enhancing notes…</> : "✨ Enhance with AI"}
                  </button>

                  {/* Vet info + date + signature */}
                  <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.secondary, textTransform: "uppercase", letterSpacing: "0.07em" }}>Sign & date</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <div>
                        <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Veterinarian name</div>
                        <input
                          value={vetName}
                          onChange={(e) => setVetName(e.target.value)}
                          placeholder="Dr. Sarah Chen"
                          style={{ width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "10px 13px", fontSize: 14, outline: "none", fontFamily: "inherit", color: T.primary, background: T.white, boxSizing: "border-box" }}
                          onFocus={(e) => (e.target.style.borderColor = "#7c3aed")}
                          onBlur={(e) => (e.target.style.borderColor = T.border)}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Visit date</div>
                        <input
                          type="date"
                          value={visitDate}
                          onChange={(e) => setVisitDate(e.target.value)}
                          style={{ width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "10px 13px", fontSize: 14, outline: "none", fontFamily: "inherit", color: T.primary, background: T.white, boxSizing: "border-box", cursor: "pointer" }}
                          onFocus={(e) => (e.target.style.borderColor = "#7c3aed")}
                          onBlur={(e) => (e.target.style.borderColor = T.border)}
                        />
                      </div>
                    </div>

                    {/* Signature box */}
                    <div>
                      <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Signature (type your name to sign)</div>
                      <div style={{ border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "14px 18px", background: "#FAFAFA", minHeight: 52, display: "flex", alignItems: "center" }}>
                        {vetName
                          ? <span style={{ fontFamily: "Georgia, serif", fontSize: 22, color: "#1e3a5f", fontStyle: "italic", letterSpacing: "0.02em" }}>{vetName}</span>
                          : <span style={{ color: T.muted, fontSize: 13 }}>Enter your name above to generate signature</span>
                        }
                      </div>
                    </div>
                  </div>

                  {/* Release button */}
                  <button
                    onClick={handleRelease}
                    disabled={!(enhanced || releaseNotes).trim() || !vetName.trim()}
                    style={{ background: !(enhanced || releaseNotes).trim() || !vetName.trim() ? T.border : "linear-gradient(135deg, #3b0764, #7c3aed)", color: "#fff", border: "none", borderRadius: 14, padding: "15px", fontSize: 15, fontWeight: 800, cursor: !(enhanced || releaseNotes).trim() || !vetName.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", boxShadow: !(enhanced || releaseNotes).trim() || !vetName.trim() ? "none" : "0 4px 16px rgba(124,58,237,0.35)" }}>
                    Release to owner →
                  </button>
                </div>
              ) : (
                /* Released state */
                <div style={{ display: "flex", flexDirection: "column", gap: 0, borderRadius: 16, border: "1.5px solid #DDD6FE", overflow: "hidden" }}>
                  {/* Released header */}
                  <div style={{ background: "#7c3aed", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>✅ Released to owner</div>
                    <div style={{ color: "#e9d5ff", fontSize: 12 }}>{new Date(visitDate).toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
                  </div>

                  {/* Printable content */}
                  <div id="release-note-printable">
                    {/* Pet + vet row */}
                    <div style={{ background: "#F5F3FF", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #DDD6FE" }}>
                      <div style={{ fontSize: 14, color: T.primary }}>
                        <strong>{formData?.petName}</strong> — {formData?.species}{formData?.breed ? `, ${formData.breed}` : ""} · Owner: {formData?.ownerFirst} {formData?.ownerLast}
                      </div>
                      <div style={{ fontSize: 13, color: T.secondary }}>Seen by: <strong>{vetName}</strong></div>
                    </div>

                    {/* Notes body */}
                    <div style={{ padding: "24px 20px", background: T.white }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Consultation & Discharge Notes</div>
                      <div style={{ fontSize: 14, color: T.primary, lineHeight: 1.85, whiteSpace: "pre-wrap" }}>{enhanced || releaseNotes}</div>
                    </div>

                    {/* Signature footer */}
                    <div style={{ background: "#F5F3FF", padding: "18px 20px", borderTop: "1px solid #DDD6FE", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                      <div>
                        <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Signed by</div>
                        <div style={{ fontFamily: "Georgia, serif", fontSize: 26, color: "#1e3a5f", fontStyle: "italic", letterSpacing: "0.01em" }}>{vetName}</div>
                        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Veterinarian · VetDesk</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: T.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Visit date</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: T.primary }}>{new Date(visitDate).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}</div>
                        <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>VetDesk · Discharge Record</div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ padding: "14px 20px", background: T.surface, borderTop: `1px solid ${T.border}`, display: "flex", gap: 10 }}>
                    <button
                      onClick={() => {
                        const notes = enhanced || releaseNotes;
                        const dateStr = new Date(visitDate).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
                        const petLine = `${formData?.petName} — ${formData?.species}${formData?.breed ? `, ${formData.breed}` : ""} · Owner: ${formData?.ownerFirst} ${formData?.ownerLast}`;
                        const html = `<!DOCTYPE html><html><head><title>VetDesk — Discharge Note · ${formData?.petName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', Georgia, sans-serif; max-width: 720px; margin: 48px auto; padding: 0 24px; color: #0f172a; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 2px solid #0f172a; margin-bottom: 24px; }
  .brand { font-size: 22px; font-weight: 700; color: #052e16; }
  .brand span { color: #15803d; }
  .date-badge { font-size: 13px; color: #475569; text-align: right; }
  .pet-row { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; display: flex; justify-content: space-between; margin-bottom: 24px; font-size: 14px; }
  .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin-bottom: 10px; }
  .notes-body { font-size: 15px; line-height: 1.9; white-space: pre-wrap; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fafafa; margin-bottom: 32px; }
  .sig-footer { display: flex; justify-content: space-between; align-items: flex-end; padding-top: 20px; border-top: 2px solid #0f172a; }
  .sig-name { font-family: Georgia, serif; font-style: italic; font-size: 28px; color: #1e3a5f; margin: 6px 0 4px; }
  .sig-sub { font-size: 12px; color: #64748b; }
  .visit-date { font-size: 15px; font-weight: 700; color: #0f172a; }
  @media print { body { margin: 24px auto; } }
</style></head><body>
  <div class="header">
    <div><div class="brand">Vet<span>Desk</span></div><div style="font-size:13px;color:#64748b;margin-top:4px;">Discharge & Release Record</div></div>
    <div class="date-badge">${dateStr}</div>
  </div>
  <div class="pet-row">
    <div><strong>${petLine}</strong></div>
    <div style="color:#475569">Seen by: <strong>${vetName}</strong></div>
  </div>
  <div class="section-label">Consultation & Discharge Notes</div>
  <div class="notes-body">${notes}</div>
  <div class="sig-footer">
    <div>
      <div class="section-label">Signed by</div>
      <div class="sig-name">${vetName}</div>
      <div class="sig-sub">Veterinarian · VetDesk</div>
    </div>
    <div style="text-align:right">
      <div class="section-label">Visit date</div>
      <div class="visit-date">${dateStr}</div>
      <div class="sig-sub" style="margin-top:4px">VetDesk · Discharge Record</div>
    </div>
  </div>
</body></html>`;
                        const w = window.open("", "_blank");
                        w.document.write(html);
                        w.document.close();
                        setTimeout(() => w.print(), 600);
                      }}
                      style={{ flex: 1, background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      🖨️ Print / Save PDF
                    </button>
                    <button onClick={() => setReleased(false)} style={{ flex: 1, background: T.white, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: T.secondary }}>✏️ Edit notes</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Spin animation injected globally
const style = document.createElement("style");
style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(style);
