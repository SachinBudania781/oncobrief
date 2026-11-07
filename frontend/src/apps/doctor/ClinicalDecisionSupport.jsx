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

function siteFromRecord(value) {
  const text = String(value || '').toLowerCase()
  if (text.includes('breast')) return 'breast'
  if (text.includes('sclc') || text.includes('small cell')) return 'lung_sclc'
  if (text.includes('lung') || text.includes('nsclc') || text.includes('non-small cell')) return 'lung_nsclc'
  if (text.includes('colorectal') || text.includes('colon') || text.includes('rect')) return 'colorectal'
  if (text.includes('head') && text.includes('neck')) return 'head_neck'
  if (text.includes('prostate')) return 'prostate'
  return ''
}

const optionalNumber = (value) => value === '' ? null : Number(value)

export default function ClinicalDecisionSupport({ patient }) {
  const [site, setSite] = useState(siteFromRecord(patient?.cancer_type))
  const [stage, setStage] = useState(patient?.stage || '')
  const [biomarkers, setBiomarkers] = useState('')
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
    setResult(null)
  }, [patient?.id, patient?.cancer_type, patient?.stage, patient?.current_regimen])

  async function review(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const data = await api.clinicalDecisionBrief({
        cancer_site: site,
        stage: stage.trim(),
        biomarkers: biomarkers.split(',').map((value) => value.trim()).filter(Boolean),
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
      setBenchmarkError(e.message || 'Evaluation could not be completed.')
    } finally {
      setBenchmarkBusy(false)
    }
  }

  return (
    <details className="panel clinical-decision-support">
      <summary className="panel-head" style={{ cursor: 'pointer' }}>
        <h2>Structured evidence and safety review</h2>
        <span className="muted small">Metadata-filtered sources · deterministic guardrails</span>
      </summary>
      <div className="stack" style={{ padding: '0 16px 16px' }}>
        <p className="small muted">
          The review searches verified source excerpts for the selected site and stage and screens clinician-entered labs against configured rules. It does not generate a regimen or dose.
        </p>
        <form className="grid2" onSubmit={review}>
          <label className="field">Primary cancer site
            <select className="select" value={site} onChange={(e) => setSite(e.target.value)} required>
              <option value="">Select an explicit site</option>
              {SITES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">Clinical/pathological stage
            <input className="input" value={stage} onChange={(e) => setStage(e.target.value)} placeholder="e.g. IIA or IV" required />
          </label>
          <label className="field">Biomarkers (comma-separated, reported results only)
            <input className="input" value={biomarkers} onChange={(e) => setBiomarkers(e.target.value)} placeholder="e.g. ER+, HER2-, EGFR_ex19del" />
          </label>
          <label className="field">Treatment intent
            <select className="select" value={intent} onChange={(e) => setIntent(e.target.value)}>
              <option value="">Not recorded</option>
              <option value="curative">Curative</option>
              <option value="neoadjuvant">Neoadjuvant</option>
              <option value="adjuvant">Adjuvant</option>
              <option value="palliative_metastatic">Palliative / metastatic</option>
            </select>
          </label>
          <label className="field">Clinical notes / query
            <textarea className="input" rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} required maxLength={4000} />
          </label>
          <label className="field">Clinician-proposed regimen (screening only)
            <input className="input" value={regimen} onChange={(e) => setRegimen(e.target.value)} placeholder="Leave blank if none proposed" />
          </label>
          <div className="field">
            <b>Baseline measurements (leave blank if unavailable)</b>
            <div className="grid2">
              {[
                ['lvef', 'LVEF (%)'],
                ['crcl', 'CrCl (mL/min)'],
                ['anc', 'ANC (/uL)'],
                ['platelets', 'Platelets (/uL)'],
                ['bilirubin', 'Bilirubin (mg/dL)'],
              ].map(([key, label]) => (
                <label className="field small" key={key}>{label}
                  <input className="input" type="number" min="0" step="any" value={labs[key]} onChange={(e) => setLabs({ ...labs, [key]: e.target.value })} />
                </label>
              ))}
              <label className="field small">DPD/DPYD status
                <select className="select" value={labs.dpd_status} onChange={(e) => setLabs({ ...labs, dpd_status: e.target.value })}>
                  <option value="">Not recorded</option>
                  <option value="normal">Normal</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="deficient">Deficient</option>
                </select>
              </label>
            </div>
          </div>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Reviewing…' : 'Retrieve evidence and screen safety'}</button>
        </form>
        {error && <p className="care-error" role="alert">{error}</p>}
        {result && (
          <section className="stack" aria-live="polite">
            <div className="row wrap">
              <b>{result.protocol_title || 'No matching verified protocol excerpt'}</b>
              <span className={'chip ' + (result.retrieval_confidence === 'HIGH' ? 'ok' : 'warning')}>{result.retrieval_confidence} retrieval confidence</span>
              {result.category_tier && <span className="chip">{result.category_tier}</span>}
            </div>
            {result.safety_alerts.length === 0
              ? <p className="care-notice">No configured alert was triggered. This is not a safety clearance.</p>
              : result.safety_alerts.map((alert, index) => (
                <div className={'care-notice ' + alert.severity.toLowerCase()} key={alert.code + index}>
                  <b>{alert.severity} · {alert.parameter}</b>
                  <p>{alert.observation}</p>
                  <p>{alert.guideline_action}</p>
                </div>
              ))}
            {result.mandatory_pre_checks.length > 0 && <div>
              <b>Baseline checks to verify against the approved protocol</b>
              <ul>{result.mandatory_pre_checks.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>}
            <p className="care-notice">{result.notice}</p>
            {result.regimen_details.length === 0 && <p className="small muted">No regimen or dose was generated. Confirm any treatment decision against the current full guideline and institutional protocol.</p>}
            <div className="stack">
              <b>Verified guideline provenance</b>
              {result.retrieved_sources.length === 0 && <p className="small muted">No verified excerpt matched the exact cancer-site and stage filters.</p>}
              {result.retrieved_sources.map((source, index) => (
                <details className="guideline-citation" key={source.metadata.doc + source.metadata.page + index}>
                  <summary>{source.metadata.doc} · {source.metadata.section} · p. {source.metadata.page} · similarity {source.similarity}</summary>
                  <p className="small">Scope: {source.metadata.cancer_site} · {source.metadata.stage}</p>
                  <blockquote>{source.content}</blockquote>
                  {source.metadata.source_url && source.metadata.source_url.startsWith('https://www.ncgindia.org/')
                    && <a href={source.metadata.source_url} target="_blank" rel="noreferrer">Open official NCG source</a>}
                </details>
              ))}
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
              <ul>{evaluation.case_results.map((item) => <li key={item.case_id}>{item.case_id}: retrieval {item.retrieval_hit ? 'hit' : 'miss'} · guardrail {item.guardrail_expectation_met ? 'pass' : 'fail'}</li>)}</ul>
            </div>
          )}
        </details>
      </div>
    </details>
  )
}
