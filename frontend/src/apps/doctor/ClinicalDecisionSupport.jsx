import { useEffect, useState } from 'react'
import { api } from '../../api'

const SITES = [
  ['breast', 'Breast'],
  ['lung_nsclc', 'Lung (NSCLC)'],
  ['lung_sclc', 'Lung (SCLC)'],
  ['colorectal', 'Colorectal'],
  ['head_neck', 'Head & neck'],
  ['prostate', 'Prostate'],
]
const TNM = {
  breast: {
    t: ['T0', 'Tis', 'T1', 'T1mi', 'T1a', 'T1b', 'T1c', 'T2', 'T3', 'T4'],
    n: ['N0', 'N0(i+)', 'N1mi', 'N1', 'N2', 'N3'],
    m: ['M0', 'M0(i+)', 'M1'],
  },
  lung_nsclc: {
    t: ['Tis', 'T1mi', 'T1a', 'T1b', 'T1c', 'T2a', 'T2b', 'T3', 'T4'],
    n: ['N0', 'N1', 'N2', 'N3'],
    m: ['M0', 'M1a', 'M1b', 'M1c'],
  },
}
const optionalNumber = (value) => value === '' ? null : Number(value)
const siteFromRecord = (value) => {
  const text = String(value || '').toLowerCase()
  if (text.includes('breast')) return 'breast'
  if (text.includes('sclc') || text.includes('small cell')) return 'lung_sclc'
  if (text.includes('lung') || text.includes('nsclc') || text.includes('non-small cell')) return 'lung_nsclc'
  if (text.includes('colorectal') || text.includes('colon') || text.includes('rect')) return 'colorectal'
  if (text.includes('head') && text.includes('neck')) return 'head_neck'
  if (text.includes('prostate')) return 'prostate'
  return ''
}

function TnmField({ label, value, onChange, options }) {
  return (
    <label className="field small">{label}
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Not recorded</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )
}

export default function ClinicalDecisionSupport({ patient }) {
  const [site, setSite] = useState(siteFromRecord(patient?.cancer_type))
  const [stage, setStage] = useState(patient?.stage || '')
  const [tnm, setTnm] = useState({ t_stage: '', n_stage: '', m_stage: '' })
  const [biomarkers, setBiomarkers] = useState('')
  const [receptors, setReceptors] = useState({ er_status: '', pr_status: '', her2_ihc: '', her2_fish: '', ki67_index: '' })
  const [intent, setIntent] = useState('')
  const [notes, setNotes] = useState('')
  const [regimen, setRegimen] = useState(patient?.current_regimen || '')
  const [labs, setLabs] = useState({ lvef: '', crcl: '', anc: '', platelets: '', bilirubin: '', dpd_status: '' })
  const [result, setResult] = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [busy, setBusy] = useState(false)
  const [benchmarkBusy, setBenchmarkBusy] = useState(false)
  const [error, setError] = useState('')
  const [benchmarkError, setBenchmarkError] = useState('')

  useEffect(() => {
    setSite(siteFromRecord(patient?.cancer_type))
    setStage(patient?.stage || '')
    setRegimen(patient?.current_regimen || '')
    setTnm({ t_stage: '', n_stage: '', m_stage: '' })
    setResult(null)
  }, [patient?.id, patient?.cancer_type, patient?.stage, patient?.current_regimen])

  const siteTnm = TNM[site]
  function setReceptor(name, value) {
    setReceptors((previous) => ({ ...previous, [name]: value }))
  }

  async function review(event) {
    event.preventDefault()
    const hasCompleteTnm = Object.values(tnm).every(Boolean)
    if (!stage.trim() && !hasCompleteTnm) {
      setError('Enter a recorded stage or select all three TNM categories.')
      return
    }
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const data = await api.clinicalCaseEvaluation({
        patient_id: patient?.id,
        cancer_site: site,
        stage: stage.trim() || null,
        ...tnm,
        age: patient?.age ? Number(patient.age) : null,
        biomarkers: biomarkers.split(',').map((value) => value.trim()).filter(Boolean),
        er_status: receptors.er_status || null,
        pr_status: receptors.pr_status || null,
        her2_ihc: optionalNumber(receptors.her2_ihc),
        her2_fish: receptors.her2_fish || null,
        ki67_index: optionalNumber(receptors.ki67_index),
        intent: intent || null,
        clinical_notes: notes.trim(),
        proposed_regimen: regimen.trim(),
        lvef: optionalNumber(labs.lvef),
        crcl: optionalNumber(labs.crcl),
        anc: optionalNumber(labs.anc),
        platelets: optionalNumber(labs.platelets),
        bilirubin: optionalNumber(labs.bilirubin),
        dpd_status: labs.dpd_status || null,
      })
      setResult(data)
    } catch (e) {
      setError(e.message || 'Review could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  async function runEvaluation() {
    setBenchmarkBusy(true)
    setBenchmarkError('')
    try {
      setEvaluation(await api.clinicalEvaluation())
    } catch (e) {
      setBenchmarkError(e.message || 'Validation could not be completed.')
    } finally {
      setBenchmarkBusy(false)
    }
  }

  return (
    <details className="panel clinical-decision-support">
      <summary className="panel-head" style={{ cursor: 'pointer' }}>
        <h2>Structured tumor-board evaluation</h2>
        <span className="muted small">TNM · safety screening · verified sources</span>
      </summary>
      <div className="stack" style={{ padding: '0 16px 16px' }}>
        <p className="small muted">
          This review calculates anatomical stage only for supported sites, retrieves source-verified excerpts with site and stage filters, and screens entered labs. It does not select a regimen, dose, or resource tier.
        </p>
        <form className="grid2" onSubmit={review}>
          <label className="field">Primary cancer site
            <select className="select" value={site} onChange={(event) => { setSite(event.target.value); setResult(null) }} required>
              <option value="">Select an explicit site</option>
              {SITES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">Recorded stage (if known)
            <input className="input" value={stage} onChange={(event) => setStage(event.target.value)} placeholder="e.g. IIB or IV" />
          </label>
          {siteTnm && (
            <fieldset className="field" style={{ gridColumn: '1 / -1', border: '1px solid var(--line, #dbe3e8)', borderRadius: 10, padding: 12 }}>
              <legend className="small muted">Anatomic TNM · AJCC 8 mapping where supported</legend>
              <div className="grid2">
                <TnmField label="T category" value={tnm.t_stage} options={siteTnm.t} onChange={(value) => setTnm({ ...tnm, t_stage: value })} />
                <TnmField label="N category" value={tnm.n_stage} options={siteTnm.n} onChange={(value) => setTnm({ ...tnm, n_stage: value })} />
                <TnmField label="M category" value={tnm.m_stage} options={siteTnm.m} onChange={(value) => setTnm({ ...tnm, m_stage: value })} />
              </div>
            </fieldset>
          )}
          {site === 'breast' && (
            <fieldset className="field" style={{ gridColumn: '1 / -1', border: '1px solid var(--line, #dbe3e8)', borderRadius: 10, padding: 12 }}>
              <legend className="small muted">Breast receptor results · enter reported findings only</legend>
              <div className="grid2">
                {[
                  ['er_status', 'ER status'],
                  ['pr_status', 'PR status'],
                ].map(([key, label]) => (
                  <label className="field small" key={key}>{label}
                    <select className="select" value={receptors[key]} onChange={(event) => setReceptor(key, event.target.value)}>
                      <option value="">Not recorded</option>
                      <option value="Positive">Positive</option>
                      <option value="Negative">Negative</option>
                      <option value="Unknown">Unknown</option>
                    </select>
                  </label>
                ))}
                <label className="field small">HER2 IHC
                  <select className="select" value={receptors.her2_ihc} onChange={(event) => setReceptor('her2_ihc', event.target.value)}>
                    <option value="">Not recorded</option>
                    <option value="0">0</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option>
                  </select>
                </label>
                <label className="field small">HER2 ISH/FISH
                  <select className="select" value={receptors.her2_fish} onChange={(event) => setReceptor('her2_fish', event.target.value)}>
                    <option value="">Not recorded</option><option value="Positive">Positive</option><option value="Negative">Negative</option><option value="Not Tested">Not tested</option>
                  </select>
                </label>
                <label className="field small">Ki-67 (%) · recorded value
                  <input className="input" type="number" min="0" max="100" step="any" value={receptors.ki67_index} onChange={(event) => setReceptor('ki67_index', event.target.value)} />
                </label>
              </div>
            </fieldset>
          )}
          <label className="field">Additional biomarkers (comma-separated)
            <input className="input" value={biomarkers} onChange={(event) => setBiomarkers(event.target.value)} placeholder="e.g. EGFR_ex19del, PD-L1_pos" />
          </label>
          <label className="field">Treatment intent
            <select className="select" value={intent} onChange={(event) => setIntent(event.target.value)}>
              <option value="">Not recorded</option>
              <option value="curative">Curative</option><option value="neoadjuvant">Neoadjuvant</option>
              <option value="adjuvant">Adjuvant</option><option value="palliative_metastatic">Palliative / metastatic</option>
            </select>
          </label>
          <label className="field">Clinical notes / query
            <textarea className="input" rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} required maxLength={4000} />
          </label>
          <label className="field">Clinician-proposed regimen · safety screening only
            <input className="input" value={regimen} onChange={(event) => setRegimen(event.target.value)} placeholder="Leave blank if none proposed" />
          </label>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <b>Baseline measurements · leave blank if not recorded</b>
            <div className="grid2">
              {[
                ['lvef', 'LVEF (%)'], ['crcl', 'CrCl (mL/min)'], ['anc', 'ANC (/uL)'],
                ['platelets', 'Platelets (/uL)'], ['bilirubin', 'Bilirubin (mg/dL)'],
              ].map(([key, label]) => (
                <label className="field small" key={key}>{label}
                  <input className="input" type="number" min="0" step="any" value={labs[key]} onChange={(event) => setLabs({ ...labs, [key]: event.target.value })} />
                </label>
              ))}
              <label className="field small">DPD/DPYD status
                <select className="select" value={labs.dpd_status} onChange={(event) => setLabs({ ...labs, dpd_status: event.target.value })}>
                  <option value="">Not recorded</option><option value="normal">Normal</option>
                  <option value="intermediate">Intermediate</option><option value="deficient">Deficient</option>
                </select>
              </label>
            </div>
          </div>
          <button className="btn primary" type="submit" disabled={busy || !patient?.id}>
            {busy ? 'Reviewing…' : 'Calculate stage, retrieve evidence and screen safety'}
          </button>
        </form>
        {!patient?.id && <p className="care-notice warning">Select an authorized patient record to run this review.</p>}
        {error && <p className="care-error" role="alert">{error}</p>}
        {result && (
          <section className="stack" aria-live="polite">
            <div className="row wrap">
              <b>{result.calculated_stage?.stage || 'Stage not calculated'}</b>
              <span className={'chip ' + (result.retrieval_confidence === 'HIGH' ? 'ok' : 'warning')}>{result.retrieval_confidence} retrieval confidence</span>
              {result.calculated_stage?.basis && <span className="small muted">{result.calculated_stage.basis}</span>}
            </div>
            <p className="small">{result.molecular_subtype}</p>
            {result.safety_alerts.length === 0
              ? <p className="care-notice">No configured alert was triggered. This is not a safety clearance.</p>
              : result.safety_alerts.map((alert, index) => (
                <div className={'care-notice ' + alert.severity.toLowerCase()} key={alert.parameter + index}>
                  <b>{alert.severity} · {alert.parameter}</b><p>{alert.observation}</p><p>{alert.guideline_action}</p>
                </div>
              ))}
            {result.mandatory_pre_checks.length > 0 && <div>
              <b>Baseline checks to verify against the approved protocol</b>
              <ul>{result.mandatory_pre_checks.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>}
            <p className="care-notice">{result.notice}</p>
            <div className="stack">
              <b>Guideline source verification</b>
              {result.retrieved_sources.length === 0 && <p className="small muted">No verified excerpt matched the exact cancer-site and stage filters.</p>}
              {result.retrieved_sources.map((source, index) => (
                <details className="guideline-citation" key={source.metadata.doc + source.metadata.page + index}>
                  <summary>{source.metadata.doc} · {source.metadata.section} · p. {source.metadata.page} · match {Number(source.similarity).toFixed(3)}</summary>
                  <p className="small">Scope: {source.metadata.cancer_site} · {source.metadata.stage}</p>
                  <blockquote>{source.content}</blockquote>
                  {source.metadata.source_url?.startsWith('https://www.ncgindia.org/')
                    && <a href={source.metadata.source_url} target="_blank" rel="noreferrer">Open official NCG source</a>}
                </details>
              ))}
            </div>
            <div className="care-notice warning">
              <b>Regimen output: not generated</b>
              <p>{result.recommended_regimens.reason}</p>
            </div>
          </section>
        )}
        <details className="panel">
          <summary className="small muted">Validation results</summary>
          <div className="panel-head">
            <h3>Retrieval and safety-check validation</h3>
            <button className="btn" type="button" onClick={runEvaluation} disabled={benchmarkBusy}>{benchmarkBusy ? 'Running…' : 'Run validation'}</button>
          </div>
          {benchmarkError && <p className="care-error" role="alert">{benchmarkError}</p>}
          {evaluation && (
            <div className="stack" aria-live="polite">
              <div className="grid2">
                <div><b>{evaluation.cases_evaluated}</b><p className="small muted">Validation cases</p></div>
                <div><b>{evaluation.retrieval_recall_at_1_percent}%</b><p className="small muted">Retrieval Recall@1</p></div>
                <div><b>{evaluation.guardrail_test_accuracy_percent}%</b><p className="small muted">Safety-check accuracy</p></div>
                <div><b>Not measured</b><p className="small muted">Regimen accuracy and hallucination rate; no regimen generator is enabled.</p></div>
              </div>
              <ul>{evaluation.case_results.map((item) => <li key={item.case_id}>{item.case_id}: retrieval {item.retrieval_hit ? 'hit' : 'miss'} · safety check {item.guardrail_expectation_met ? 'pass' : 'fail'}</li>)}</ul>
            </div>
          )}
        </details>
      </div>
    </details>
  )
}
