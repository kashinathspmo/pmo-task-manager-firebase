import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { doc, getDoc, setDoc, serverTimestamp, collection, addDoc } from 'firebase/firestore';
import { db } from './firebase';
import {
  DEFAULT_EXCLUDED, DEFAULT_SHIFT_MIN, TARGET_PCT, DEPT_MAP,
  buildRecords, summarise, buildEmail, subject, MAIL_TO, MAIL_CC,
  displayDate, normCode, fmt, Rec, Summary
} from './attendanceLogic';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const pc1 = (v: number) => (v * 100).toFixed(1) + '%';

function guess(h: string[], words: string[]) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  return h.find(x => words.some(w => norm(x) === w))
      || h.find(x => words.some(w => norm(x).includes(w))) || '';
}

/** The HR export has the punch column headed with the day number ("10"). */
function guessPunch(headers: string[], rows: any[]) {
  const byName = guess(headers, ['punchdetails', 'punch', 'swipe', 'logtime']);
  if (byName) return byName;
  for (const h of headers) {
    const vals = rows.slice(0, 40).map(r => String(r[h] ?? ''));
    if (vals.some(v => /\d{1,2}:\d{2}\s*(AM|PM)/i.test(v) && v.includes('-'))) return h;
  }
  return headers.find(h => /^\d{1,2}$/.test(h.trim())) || '';
}

function readFile(f: File): Promise<{ headers: string[]; rows: any[] }> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('The file could not be read.'));
    fr.onload = e => {
      try {
        const wb = XLSX.read(e.target!.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: '', raw: false });
        if (!rows.length) return rej(new Error('That sheet has no data rows.'));
        res({ headers: Object.keys(rows[0]), rows });
      } catch { rej(new Error('Unsupported file. Please upload .csv, .xlsx or .xls.')); }
    };
    fr.readAsArrayBuffer(f);
  });
}

export default function Attendance({ actor, actorName, isManager }:
  { actor: string; actorName: string; isManager: boolean }) {

  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [map, setMap] = useState({ code: '', name: '', dept: '', punch: '', premise: '' });

  const [shiftMap, setShiftMap] = useState<Record<string, string>>({});
  const [exclText, setExclText] = useState(DEFAULT_EXCLUDED.join(', '));
  const [cfgOpen, setCfgOpen] = useState(false);
  const [tab, setTab] = useState<'abstract' | 'login' | 'break' | 'dept' | 'email'>('abstract');

  const [aiKey, setAiKey] = useState(localStorage.getItem('pmo_ai_key') || '');
  const [aiText, setAiText] = useState('');
  const [aiOpen, setAiOpen] = useState(false);

  const emailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getDoc(doc(db, 'config', 'attendance')).then(s => {
      if (s.exists()) {
        const d: any = s.data();
        if (Array.isArray(d.excluded) && d.excluded.length) setExclText(d.excluded.join(', '));
      }
    }).catch(() => {});
  }, []);

  const excluded = useMemo(
    () => exclText.split(/[\s,;]+/).map(normCode).filter(Boolean), [exclText]);

  const built = useMemo(() => {
    if (!rows.length || !map.code || !map.punch || !map.dept) return null;
    return buildRecords(rows, { map, shiftMap, excluded, defaultShift: DEFAULT_SHIFT_MIN });
  }, [rows, map, shiftMap, excluded]);

  const sum: Summary | null = useMemo(
    () => built ? summarise(built.kept) : null, [built]);

  async function onRaw(f?: File) {
    if (!f) return;
    setErr(''); setNote(''); setBusy('Reading HR attendance file...');
    try {
      const { headers, rows } = await readFile(f);
      setHeaders(headers); setRows(rows);
      setMap({
        code: guess(headers, ['empcode', 'employeecode', 'code', 'empid', 'employeeid']),
        name: guess(headers, ['name', 'empname', 'employeename']),
        dept: guess(headers, ['departmentname', 'department', 'dept']),
        punch: guessPunch(headers, rows),
        premise: guess(headers, ['location', 'premise', 'businessunit'])
      });
      setNote(`Loaded ${rows.length} rows. Confirm the detected columns below.`);
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function onShift(f?: File) {
    if (!f) return;
    setErr(''); setBusy('Reading IT shift details...');
    try {
      const { headers, rows } = await readFile(f);
      const cCol = guess(headers, ['empid', 'empcode', 'employeecode', 'code']);
      const sCol = headers.find(h => /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(h.trim()))
                || guess(headers, ['shiftid', 'shift']);
      if (!cCol || !sCol) throw new Error('Could not find the Emp ID and shift columns in that file.');
      const m: Record<string, string> = {};
      rows.forEach(r => {
        const c = normCode(r[cCol]); const v = String(r[sCol] ?? '').trim().toUpperCase();
        if (c && /^(S[1-5]|A1?|B|G1?)$/.test(v)) m[c] = v;
      });
      setShiftMap(m);
      setNote(`Shift timings applied for ${Object.keys(m).length} employees.`);
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function saveCfg() {
    if (!isManager) return setErr('Only the manager can change the shared exclusion list.');
    setBusy('Saving...');
    try {
      await setDoc(doc(db, 'config', 'attendance'),
        { excluded, updated_by: actor, updated_at: serverTimestamp() }, { merge: true });
      setNote('Exclusion list saved for the whole team.');
    } catch { setErr('Save failed. Check that the Firestore rules allow the config collection.'); }
    setBusy('');
  }

  function download() {
    if (!sum || !built) return;
    const wb = XLSX.utils.book_new();
    const add = (name: string, data: any[]) =>
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name);

    add('Abstract', [
      { Description: 'No. of Reported Resources', Value: sum.reported },
      { Description: 'Reported On Time', Value: sum.onTime },
      { Description: 'Reported within 15 minutes after Shift start time', Value: sum.within15 },
      { Description: 'Total', Value: sum.onTime + sum.within15 },
      { Description: 'Achieved %', Value: sum.achieved },
      { Description: 'Target %', Value: TARGET_PCT },
      { Description: 'Deviation %', Value: sum.deviation }
    ]);

    add('First Login Summary', [
      ...sum.login.map(r => ({ Bucket: r.bucket, 'Count of Emp ID': r.count, '%': r.pct })),
      { Bucket: 'Grand Total', 'Count of Emp ID': sum.total, '%': 1 }
    ]);

    add('First Break Summary', [
      ...sum.brk.map(r => ({ 'First Break Bucket': r.bucket, 'Count of Emp': r.count, '%': r.pct })),
      { 'First Break Bucket': 'Grand Total', 'Count of Emp': sum.total, '%': 1 }
    ]);

    add('Departmentwise', sum.deptLogin.map(r => ({
      Department: r.dept, 'Team strength': r.strength, 'On Time': r.onTime,
      Achieved: r.achieved, '5 Mins': r.m5, '10 mins': r.m10, '15 mins': r.m15,
      'Deviation 1': r.dev1, 'Deviation1 %': r.dev1Pct, 'Above 15 Mins': r.above,
      'Deviation 2 %': r.dev2Pct, Absent: r.absent, Leave: r.leave,
      'Deviation 3 %': r.dev3Pct, 'On Duty': r.onDuty
    })));

    add('Departmentwise Break', sum.deptBreak.map(r => ({
      Department: r.dept, 'Team strength': r.strength, 'No Break': r.noBreak,
      'Lunch Break': r.lunch, '%': r.pctNoLunch, '5 Mins': r.b5, '10 Mins': r.b10,
      '15 Mins': r.b15, '30 Mins': r.b30, '45 Mins': r.b45, '% ': r.pctShort,
      'After 45 Mins': r.after, '%  ': r.pctAfter
    })));

    add('Attendance', built.kept.map(r => ({
      Premise: r.premise, 'Base Department': r.baseDept, Department: r.dept,
      'Emp ID': r.code, 'Emp Name': r.name, 'Punch Details': r.punchRaw,
      Shift: r.shiftName, 'First LogIn Time': fmt(r.firstIn),
      'First Logout Time': fmt(r.firstOut), 'Second Login Time': fmt(r.secondIn),
      'Mins To First Break': r.minsToBreak ?? '',
      'First Break Taken (mins)': r.breakLen ?? '',
      'Shift Start Time': fmt(r.shiftStart),
      'In Time Bucket': r.loginBucket, 'First Logout Bucket': r.breakBucket,
      Remarks: r.issue
    })));

    if (built.removed.length) add('Excluded (VP-Sr Mgr)', built.removed.map(r => ({
      'Emp ID': r.code, 'Emp Name': r.name, Department: r.dept
    })));

    XLSX.writeFile(wb, `Daily Attendance - ${date}.xlsx`);
    addDoc(collection(db, 'activity'), {
      action: 'Attendance report generated', actor, report_date: date,
      reported: sum.reported, achieved: sum.achieved, at: serverTimestamp()
    }).catch(() => {});
  }

  async function copyMail() {
    if (!sum) return;
    const html = buildEmail(sum, date, actorName);
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([emailRef.current?.innerText || ''], { type: 'text/plain' })
      })]);
      setNote('Email copied with formatting. Paste into Outlook with Ctrl+V.');
    } catch { setErr('Clipboard blocked. Select the preview below and copy manually.'); }
  }

  async function runAi() {
    if (!sum) return;
    if (!aiKey.trim()) return setErr('Enter a Google AI Studio API key first.');
    setBusy('Generating commentary...'); setErr('');
    try {
      const facts = {
        date: displayDate(date), reported: sum.reported, onTime: sum.onTime,
        within15: sum.within15, achievedPct: +(sum.achieved * 100).toFixed(1), target: 90,
        login: sum.login.map(r => `${r.bucket}: ${r.count}`),
        departments: sum.deptLogin.map(r => `${r.dept}: ${(r.achieved * 100).toFixed(0)}% on time, ${r.above} above 15 mins`)
      };
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + aiKey.trim(),
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text:
            'You are a PMO analyst. Using ONLY these aggregate numbers, write 3-4 short, neutral, ' +
            'factual bullet points for a management attendance email. No employee names. No praise ' +
            'or blame of individuals. State the gap to the 90% target and name the two departments ' +
            'with the largest deviation.\n\n' + JSON.stringify(facts, null, 2) }] }] }) });
      const j = await res.json();
      const t = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!t) throw new Error(j?.error?.message || 'No response from the model.');
      setAiText(t.trim());
    } catch (e: any) { setErr('AI request failed: ' + e.message); }
    setBusy('');
  }

  const unmapped = built ? Array.from(new Set(
    built.kept.filter(r => !DEPT_MAP[r.dept]).map(r => r.dept))) : [];

  return (
    <section>
      <div className="att-head">
        <div>
          <h1>Daily Attendance Report</h1>
          <p className="muted">Upload today's HR raw data. The report, workbook and email are built automatically.</p>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      {busy && <div className="banner info">{busy}</div>}
      {err && <div className="banner err">{err}</div>}
      {note && !err && <div className="banner ok">{note}</div>}

      <div className="panel wide">
        <h2>1. Upload</h2>
        <div className="grid2">
          <label className="drop"><b>HR raw attendance data *</b>
            <span className="muted">.csv, .xlsx or .xls, any column order</span>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={e => onRaw(e.target.files?.[0])} /></label>
          <label className="drop"><b>IT shift details (optional)</b>
            <span className="muted">{Object.keys(shiftMap).length
              ? `${Object.keys(shiftMap).length} shift timings applied`
              : 'Without this, everyone is measured against 09:30'}</span>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={e => onShift(e.target.files?.[0])} /></label>
        </div>
      </div>

      {headers.length > 0 && (
        <div className="panel wide">
          <h2>2. Confirm columns</h2>
          <div className="grid4">
            {([['code', 'Emp Code'], ['name', 'Emp Name'], ['dept', 'Department'],
               ['punch', 'Punch Details'], ['premise', 'Location']] as const).map(([k, l]) => (
              <label key={k}><span className="lbl">{l}</span>
                <select value={(map as any)[k]} onChange={e => setMap({ ...map, [k]: e.target.value })}>
                  <option value="">-- none --</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select></label>))}
          </div>
          <button className="link" onClick={() => setCfgOpen(!cfgOpen)}>
            {cfgOpen ? 'Hide' : 'Show'} exclusion list ({excluded.length} codes)
          </button>
          {cfgOpen && (
            <div className="sub">
              <label><span className="lbl">Excluded Emp Codes (VPs / Sr. Managers)</span>
                <textarea rows={3} value={exclText} onChange={e => setExclText(e.target.value)} /></label>
              <div className="row">
                <button onClick={saveCfg} disabled={!isManager}>Save for the team</button>
                {!isManager && <span className="muted">Manager access required.</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {sum && built && (
        <>
          <div className="metrics">
            <Card n="Reported" v={sum.reported} />
            <Card n="On Time" v={sum.onTime} />
            <Card n="Within 15 mins" v={sum.within15} />
            <Card n="Achieved" v={pc1(sum.achieved)} tone={sum.achieved >= TARGET_PCT ? 'good' : 'warn'} />
            <Card n="Deviation" v={pc1(sum.deviation)} tone={sum.deviation <= 0 ? 'good' : 'warn'} />
            <Card n="Excluded" v={built.removed.length} />
          </div>

          {(unmapped.length > 0 || sum.issues.length > 0) && (
            <div className="banner warn">
              <b>Please check before sending</b>
              {unmapped.length > 0 && <div>Unmapped department(s): {unmapped.join(', ')} — these rows are grouped under their raw name.</div>}
              {sum.issues.length > 0 && <ul>{sum.issues.slice(0, 6).map(r =>
                <li key={r.code}>{r.code} {r.name} — {r.issue}</li>)}</ul>}
            </div>
          )}

          <div className="panel wide">
            <h2>3. Output</h2>
            <div className="row">
              <button onClick={download}>Download Excel report</button>
              <button onClick={copyMail}>Copy email body</button>
              <button className="ghost" onClick={() => setAiOpen(!aiOpen)}>{aiOpen ? 'Hide' : 'Add'} AI commentary</button>
            </div>
            <p className="muted">
              <b>Subject:</b> {subject(date)}<br />
              <b>To:</b> {MAIL_TO}<br /><b>Cc:</b> {MAIL_CC}
            </p>
            {aiOpen && (
              <div className="sub">
                <p className="muted">Sends only the aggregate counts above to Google Gemini — never names,
                  emp codes or punch times. Key is stored in this browser only. Confirm with IT before use.</p>
                <div className="grid2">
                  <label><span className="lbl">Google AI Studio API key</span>
                    <input type="password" value={aiKey} onChange={e => {
                      setAiKey(e.target.value); localStorage.setItem('pmo_ai_key', e.target.value); }} /></label>
                  <div style={{ alignSelf: 'end' }}><button onClick={runAi}>Generate</button></div>
                </div>
                {aiText && <pre className="ai">{aiText}</pre>}
              </div>
            )}
          </div>

          <div className="panel wide">
            <div className="tabs">
              {(['abstract', 'login', 'break', 'dept', 'email'] as const).map(t => (
                <button key={t} className={tab === t ? 'on' : 'ghost'} onClick={() => setTab(t)}>
                  {{ abstract: 'Abstract', login: 'First Login', break: 'First Break',
                     dept: 'Departmentwise', email: 'Email preview' }[t]}
                </button>))}
            </div>

            {tab === 'abstract' && <Tbl head={['Description', 'Value']} body={[
              ['No. of Reported Resources', sum.reported], ['Reported On Time', sum.onTime],
              ['Reported within 15 minutes after Shift start time', sum.within15],
              ['Total', sum.onTime + sum.within15], ['Achieved %', pc1(sum.achieved)],
              ['Target %', '90%'], ['Deviation %', pc1(sum.deviation)]]} />}

            {tab === 'login' && <Tbl head={['Bucket', 'Count of Emp ID', '%']}
              body={[...sum.login.map(r => [r.bucket, r.count, pc1(r.pct)]),
                     ['Grand Total', sum.total, '100.0%']]} />}

            {tab === 'break' && <Tbl head={['First Break Bucket', 'Count of Emp', '%']}
              body={[...sum.brk.map(r => [r.bucket, r.count, pc1(r.pct)]),
                     ['Grand Total', sum.total, '100.0%']]} />}

            {tab === 'dept' && <>
              <h3>Departmentwise First Login Bucket Analysis</h3>
              <Tbl head={['Department', 'Team strength', 'On Time', 'Achieved', '5 Mins', '10 mins',
                '15 mins', 'Deviation 1', 'Deviation1 %', 'Above 15 Mins', 'Deviation 2 %',
                'Absent', 'Leave', 'Deviation 3 %', 'On Duty']}
                body={sum.deptLogin.map(r => [r.dept, r.strength, r.onTime, pc1(r.achieved),
                  r.m5, r.m10, r.m15, r.dev1, pc1(r.dev1Pct), r.above, pc1(r.dev2Pct),
                  r.absent, r.leave, pc1(r.dev3Pct), r.onDuty])} />
              <h3>Departmentwise Break taken Analysis</h3>
              <Tbl head={['Department', 'Team strength', 'No Break', 'Lunch Break', '%', '5 Mins',
                '10 Mins', '15 Mins', '30 Mins', '45 Mins', '%', 'After 45 Mins', '%']}
                body={sum.deptBreak.map(r => [r.dept, r.strength, r.noBreak, r.lunch,
                  pc1(r.pctNoLunch), r.b5, r.b10, r.b15, r.b30, r.b45, pc1(r.pctShort),
                  r.after, pc1(r.pctAfter)])} />
            </>}

            {tab === 'email' && <div ref={emailRef} className="preview"
              dangerouslySetInnerHTML={{ __html: buildEmail(sum, date, actorName) }} />}
          </div>
        </>
      )}

      {!rows.length && !busy && <div className="empty">No file loaded yet. Upload the HR raw data to begin.</div>}
    </section>
  );
}

function Tbl({ head, body }: { head: string[]; body: any[][] }) {
  return <div className="scroll"><table className="grid">
    <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) =>
      <td key={j} className={j ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
  </table></div>;
}

function Card({ n, v, tone }: { n: string; v: any; tone?: string }) {
  return <div className={'card ' + (tone || '')}><small>{n}</small><b>{v}</b></div>;
}
