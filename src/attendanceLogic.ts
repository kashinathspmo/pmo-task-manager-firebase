// ===========================================================================
// Daily Attendance Report - calculation engine
// Rules reverse-engineered from "Daily Attendance - 2026-09-10.xlsx" and
// verified to reproduce every bucket count in that file exactly.
// ===========================================================================

export const TARGET_PCT = 0.9;
export const DEFAULT_SHIFT_MIN = 570; // 09:30 General Shift

/** Emp codes removed before reporting (VPs / Sr. Managers).
 *  NOTE: 1229 is present in your 10-Sep report, 1230 (AVP) is excluded.
 *  Verified: 385 raw rows - 16 matches = 369 reported rows. */
export const DEFAULT_EXCLUDED = [
  '148','278','640','314','246','180','737','171','698','555',
  '333','341','233','397','131','1100','1182','1203','1230'
];

/** Shift ID -> start minute. From the "Shift" sheet legend. */
export const SHIFT_TIMES: Record<string, number> = {
  S1: 480, S2: 570, S3: 660, S4: 780, S5: 630,
  A: 480, A1: 480, B: 780, G: 570, G1: 570
};
export const SHIFT_NAMES: Record<number, string> = {
  480: 'First Shift', 570: 'General Shift', 660: 'Second Shift',
  780: 'Third Shift', 630: 'Fourth Shift'
};

/** Department Name -> Base Department. From the mapping sheet. */
export const DEPT_MAP: Record<string, string> = {
  'Development-ENG': 'Engineering', 'Development - Non DPS': 'Development',
  'IT - DBA': 'IT', 'Product': 'Product', 'Implementation - IND': 'Delivery India',
  'Customer Support': 'Customer Support', 'Solutioning - IND': 'Delivery India',
  'Solutioning - DPS': 'Development', 'Development - DPS': 'Development',
  'Testing - Non DPS': 'Testing', 'Testing - DPS': 'Testing',
  'Implementation - APAC': 'Delivery APAC', 'IT - External': 'IT',
  'L&D': 'L and D', 'Accounts and Finance': 'Accounts and Finance',
  'VAPT': 'Development', 'PMO': 'PMO', 'Solutioning - APAC': 'Delivery APAC',
  'CSM - IND': 'Delivery India', 'IT - SOC': 'IT',
  'Testing-Automation': 'Engineering', 'CSM - APAC': 'Delivery APAC',
  'Delivery  Management - IND': 'Delivery India', 'IT - Internal': 'IT',
  'HR-Talent Acquisition': 'HR', 'Marketing': 'Marketing',
  'HR-Operations': 'HR', 'DevOps - ENG': 'Engineering',
  'Compliance - Audits': 'Compliance', 'Functional Audit': 'Functional Audit',
  'Sales': 'Sales', 'L3 - Technical Services': 'Customer Support',
  'Testing - Shared Services': 'Testing', 'Development - Shared Services': 'Development',
  'Development - SS': 'Development - SS', 'Testing - SS': 'Testing - SS',
  'Customer Services': 'Customer Support', 'Human Resource': 'HR',
  'Technical Services': 'Customer Support', 'IT-APM': 'IT',
  'Engineering': 'Engineering', 'Bench': 'Bench',
  'Management': 'Management', 'PMO+L&D+Admin': 'PMO',
  'Facilities and administration': 'PMO', 'HR & Compliance': 'HR'
};

export const DEPT_ORDER = [
  'Delivery India','Delivery APAC','Development','Development - SS','Testing',
  'Testing - SS','Customer Support','IT','Engineering','Product','Functional Audit',
  'Compliance','HR','L and D','PMO','Accounts and Finance','Sales','Management',
  'Marketing','Bench'
];

export const LOGIN_BUCKETS = [
  '01. On Time','02. 5 Mins Delay','03. 10 Mins Delay','04. 15 Mins Delay',
  '05. More than 15 Mins Delay','07. Absent','08. Leave','09. On Duty'
];
export const BREAK_BUCKETS = [
  '00. No Break Taken','01. Within 5 Mins','02. Within 10 Mins','03. Within 15 Mins',
  '04. Within 30 Mins','05. Within 45 Mins','06. After 45 Mins','07. At Lunch Break',
  '08. Leave','09. On Duty'
];

// --------------------------------------------------------------------------
// parsing
// --------------------------------------------------------------------------

export const normCode = (v: any) => String(v ?? '').trim().replace(/^0+(?=\d)/, '');

export function toMin(s: string): number | null {
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = +m[1]; const mi = +m[2]; const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + mi;
}

export const fmt = (m: number | null | undefined) => {
  if (m === null || m === undefined || isNaN(m)) return '';
  const h = Math.floor(m / 60), mi = m % 60, ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(mi).padStart(2, '0')} ${ap}`;
};

export type Status = 'Punched' | 'Absent' | 'Leave' | 'OnDuty' | 'PresentNoPunch';

export function readPunch(cell: any): { status: Status; times: number[] } {
  const t = String(cell ?? '').trim();
  if (!t) return { status: 'Absent', times: [] };
  if (/^A$/i.test(t)) return { status: 'Absent', times: [] };
  if (/^P$/i.test(t)) return { status: 'PresentNoPunch', times: [] };
  if (/^OD$/i.test(t)) return { status: 'OnDuty', times: [] };
  if (/^(WH|W|L)$/i.test(t) || /^L\s*\(/i.test(t)) return { status: 'Leave', times: [] };

  const times: number[] = [];
  for (const seg of t.split('|').map(s => s.trim()).filter(Boolean)) {
    for (const part of seg.split('-').map(s => s.trim())) {
      const v = toMin(part);
      if (v !== null) times.push(v);
    }
  }
  if (!times.length) return { status: 'Leave', times: [] };
  return { status: 'Punched', times };
}

// --------------------------------------------------------------------------
// buckets
// --------------------------------------------------------------------------

/** Delay = first login minus shift start, in minutes. */
export function loginBucket(delay: number): string {
  if (delay <= 0) return '01. On Time';
  if (delay < 5) return '02. 5 Mins Delay';
  if (delay < 10) return '03. 10 Mins Delay';
  if (delay <= 15) return '04. 15 Mins Delay';
  return '05. More than 15 Mins Delay';
}

/** IMPORTANT: this is minutes from FIRST LOGIN to FIRST LOGOUT - i.e. how long
 *  they worked before their first break - NOT the length of the break itself.
 *  Verified against all 369 rows of the 10-Sep report. */
export function breakBucket(minsToFirstLogout: number | null): string {
  if (minsToFirstLogout === null) return '00. No Break Taken';
  if (minsToFirstLogout <= 5) return '01. Within 5 Mins';
  if (minsToFirstLogout <= 10) return '02. Within 10 Mins';
  if (minsToFirstLogout <= 15) return '03. Within 15 Mins';
  if (minsToFirstLogout <= 30) return '04. Within 30 Mins';
  if (minsToFirstLogout <= 45) return '05. Within 45 Mins';
  if (minsToFirstLogout < 240) return '06. After 45 Mins';
  return '07. At Lunch Break';
}

// --------------------------------------------------------------------------
// records
// --------------------------------------------------------------------------

export interface Rec {
  premise: string; baseDept: string; dept: string; code: string; name: string;
  punchRaw: string; shiftName: string; shiftStart: number;
  firstIn: number | null; firstOut: number | null; secondIn: number | null;
  minsToBreak: number | null; breakLen: number | null;
  loginBucket: string; breakBucket: string; issue: string;
}

export interface BuildOpts {
  map: { code: string; name: string; dept: string; punch: string; premise?: string };
  shiftMap: Record<string, string>;   // emp code -> shift id
  excluded: string[];
  defaultShift: number;
}

export function buildRecords(rows: any[], o: BuildOpts): { kept: Rec[]; removed: Rec[] } {
  const ex = new Set(o.excluded.map(normCode));
  const kept: Rec[] = [], removed: Rec[] = [];

  for (const r of rows) {
    const code = normCode(r[o.map.code]);
    const dept = String(r[o.map.dept] ?? '').trim();
    const p = readPunch(r[o.map.punch]);

    const sid = (o.shiftMap[code] || '').toUpperCase();
    const shiftStart = SHIFT_TIMES[sid] ?? o.defaultShift;

    const firstIn = p.times[0] ?? null;
    const firstOut = p.times[1] ?? null;
    const secondIn = p.times[2] ?? null;
    const minsToBreak = firstIn !== null && firstOut !== null ? firstOut - firstIn : null;

    let lb: string, bb: string;
    if (p.status === 'Absent') { lb = '07. Absent'; bb = '00. No Break Taken'; }
    else if (p.status === 'Leave') { lb = '08. Leave'; bb = '08. Leave'; }
    else if (p.status === 'OnDuty') { lb = '09. On Duty'; bb = '09. On Duty'; }
    else if (p.status === 'PresentNoPunch') { lb = '01. On Time'; bb = '00. No Break Taken'; }
    else { lb = loginBucket(firstIn! - shiftStart); bb = breakBucket(minsToBreak); }

    let issue = '';
    if (!code) issue = 'Employee code missing';
    else if (!DEPT_MAP[dept]) issue = `Unmapped department "${dept}"`;
    else if (p.status === 'Punched' && firstIn === null) issue = 'Punch could not be read';

    const rec: Rec = {
      premise: String(r[o.map.premise ?? ''] ?? '').trim(),
      baseDept: DEPT_MAP[dept] || dept || 'Unmapped',
      dept, code, name: String(r[o.map.name] ?? '').trim(),
      punchRaw: String(r[o.map.punch] ?? '').trim(),
      shiftName: SHIFT_NAMES[shiftStart] || 'General Shift', shiftStart,
      firstIn, firstOut, secondIn, minsToBreak,
      breakLen: firstOut !== null && secondIn !== null ? secondIn - firstOut : null,
      loginBucket: lb, breakBucket: bb, issue
    };
    (ex.has(code) ? removed : kept).push(rec);
  }
  return { kept, removed };
}

// --------------------------------------------------------------------------
// summaries
// --------------------------------------------------------------------------

export interface Summary {
  total: number; reported: number; onTime: number; within15: number;
  achieved: number; deviation: number;
  login: { bucket: string; count: number; pct: number }[];
  brk: { bucket: string; count: number; pct: number }[];
  deptLogin: any[]; deptBreak: any[]; issues: Rec[];
}

export function summarise(recs: Rec[]): Summary {
  const total = recs.length;
  const n = (b: string) => recs.filter(r => r.loginBucket === b).length;
  const absent = n('07. Absent'), leave = n('08. Leave');
  const reported = total - absent - leave;
  const onTime = n('01. On Time');
  const within15 = n('02. 5 Mins Delay') + n('03. 10 Mins Delay') + n('04. 15 Mins Delay');
  const achieved = reported ? (onTime + within15) / reported : 0;

  const login = LOGIN_BUCKETS.map(b => {
    const c = recs.filter(r => r.loginBucket === b).length;
    return { bucket: b, count: c, pct: total ? c / total : 0 };
  }).filter(x => x.count > 0);

  const brk = BREAK_BUCKETS.map(b => {
    const c = recs.filter(r => r.breakBucket === b).length;
    return { bucket: b, count: c, pct: total ? c / total : 0 };
  }).filter(x => x.count > 0);

  const seen = Array.from(new Set(recs.map(r => r.baseDept)));
  const depts = [...DEPT_ORDER.filter(d => seen.includes(d)),
                 ...seen.filter(d => !DEPT_ORDER.includes(d)).sort()];

  const deptLogin = depts.map(d => {
    const g = recs.filter(r => r.baseDept === d);
    const c = (b: string) => g.filter(r => r.loginBucket === b).length;
    const s = g.length;
    const m5 = c('02. 5 Mins Delay'), m10 = c('03. 10 Mins Delay'), m15 = c('04. 15 Mins Delay');
    const dev1 = m5 + m10 + m15, above = c('05. More than 15 Mins Delay');
    const ab = c('07. Absent'), lv = c('08. Leave');
    return {
      dept: d, strength: s, onTime: c('01. On Time'),
      achieved: s ? c('01. On Time') / s : 0,
      m5, m10, m15, dev1, dev1Pct: s ? dev1 / s : 0,
      above, dev2Pct: s ? above / s : 0,
      absent: ab, leave: lv, dev3Pct: s ? (ab + lv) / s : 0,
      onDuty: c('09. On Duty')
    };
  });

  const deptBreak = depts.map(d => {
    const g = recs.filter(r => r.baseDept === d);
    const c = (b: string) => g.filter(r => r.breakBucket === b).length;
    const s = g.length;
    const noBreak = c('00. No Break Taken'), lunch = c('07. At Lunch Break');
    const b5 = c('01. Within 5 Mins'), b10 = c('02. Within 10 Mins');
    const b15 = c('03. Within 15 Mins'), b30 = c('04. Within 30 Mins'), b45 = c('05. Within 45 Mins');
    const after = c('06. After 45 Mins');
    return {
      dept: d, strength: s, noBreak, lunch,
      pctNoLunch: s ? (noBreak + lunch) / s : 0,
      b5, b10, b15, b30, b45, pctShort: s ? (b5 + b10 + b15 + b30 + b45) / s : 0,
      after, pctAfter: s ? after / s : 0
    };
  });

  return {
    total, reported, onTime, within15, achieved,
    deviation: TARGET_PCT - achieved,
    login, brk, deptLogin, deptBreak,
    issues: recs.filter(r => r.issue)
  };
}

// --------------------------------------------------------------------------
// email
// --------------------------------------------------------------------------

export const displayDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(iso + 'T12:00:00+05:30'));

const pc = (v: number) => (v * 100).toFixed(0) + '%';
const pc1 = (v: number) => (v * 100).toFixed(1) + '%';

const TH = 'style="border:1px solid #8ea9c4;background:#0b2748;color:#fff;padding:5px 9px;font:bold 10pt Calibri;text-align:center"';
const TD = 'style="border:1px solid #8ea9c4;padding:5px 9px;font:10pt Calibri"';
const TDC = 'style="border:1px solid #8ea9c4;padding:5px 9px;font:10pt Calibri;text-align:center"';

function table(head: string[], body: (string | number)[][]) {
  return `<table style="border-collapse:collapse;margin:8px 0 18px 0">
<tr>${head.map(h => `<th ${TH}>${h}</th>`).join('')}</tr>
${body.map(r => `<tr>${r.map((c, i) => `<td ${i === 0 ? TD : TDC}>${c}</td>`).join('')}</tr>`).join('')}
</table>`;
}

export function buildEmail(s: Summary, iso: string, sender: string): string {
  const d = displayDate(iso);

  const abstract = table(['Description', 'Value'], [
    ['No. of Reported Resources', s.reported],
    ['Reported On Time', s.onTime],
    ['Reported within 15 minutes after Shift start time', s.within15],
    ['Total', s.onTime + s.within15],
    ['Achieved %', pc1(s.achieved)],
    ['Target %', pc(TARGET_PCT)],
    ['Deviation %', pc1(s.deviation)]
  ]);

  const login = table(['Bucket', 'Count of Emp ID', '%'],
    [...s.login.map(r => [r.bucket, r.count, pc1(r.pct)]),
     ['<b>Grand Total</b>', `<b>${s.total}</b>`, '<b>100.0%</b>']]);

  const brk = table(['First Break Bucket', 'Count of Emp', '%'],
    [...s.brk.map(r => [r.bucket, r.count, pc1(r.pct)]),
     ['<b>Grand Total</b>', `<b>${s.total}</b>`, '<b>100.0%</b>']]);

  const dl = table(
    ['Department', 'Team strength', 'On Time', 'Achieved', '5 Mins', '10 mins', '15 mins',
     'Deviation 1', 'Deviation1 %', 'Above 15 Mins', 'Deviation 2 %', 'Absent', 'Leave',
     'Deviation 3 %', 'On Duty'],
    [...s.deptLogin.map(r => [r.dept, r.strength, r.onTime, pc1(r.achieved), r.m5, r.m10,
      r.m15, r.dev1, pc1(r.dev1Pct), r.above, pc1(r.dev2Pct), r.absent, r.leave,
      pc1(r.dev3Pct), r.onDuty]),
     ['<b>Total</b>', `<b>${s.total}</b>`, `<b>${s.onTime}</b>`, '',
      `<b>${s.deptLogin.reduce((a, r) => a + r.m5, 0)}</b>`,
      `<b>${s.deptLogin.reduce((a, r) => a + r.m10, 0)}</b>`,
      `<b>${s.deptLogin.reduce((a, r) => a + r.m15, 0)}</b>`,
      `<b>${s.within15}</b>`, '',
      `<b>${s.deptLogin.reduce((a, r) => a + r.above, 0)}</b>`, '',
      `<b>${s.deptLogin.reduce((a, r) => a + r.absent, 0)}</b>`,
      `<b>${s.deptLogin.reduce((a, r) => a + r.leave, 0)}</b>`, '',
      `<b>${s.deptLogin.reduce((a, r) => a + r.onDuty, 0)}</b>`]]);

  const db = table(
    ['Department', 'Team strength', 'No Break', 'Lunch Break', '%', '5 Mins', '10 Mins',
     '15 Mins', '30 Mins', '45 Mins', '%', 'After 45 Mins', '%'],
    [...s.deptBreak.map(r => [r.dept, r.strength, r.noBreak, r.lunch, pc1(r.pctNoLunch),
      r.b5, r.b10, r.b15, r.b30, r.b45, pc1(r.pctShort), r.after, pc1(r.pctAfter)]),
     ['<b>Total</b>', `<b>${s.total}</b>`,
      `<b>${s.deptBreak.reduce((a, r) => a + r.noBreak, 0)}</b>`,
      `<b>${s.deptBreak.reduce((a, r) => a + r.lunch, 0)}</b>`, '',
      `<b>${s.deptBreak.reduce((a, r) => a + r.b5, 0)}</b>`,
      `<b>${s.deptBreak.reduce((a, r) => a + r.b10, 0)}</b>`,
      `<b>${s.deptBreak.reduce((a, r) => a + r.b15, 0)}</b>`,
      `<b>${s.deptBreak.reduce((a, r) => a + r.b30, 0)}</b>`,
      `<b>${s.deptBreak.reduce((a, r) => a + r.b45, 0)}</b>`, '',
      `<b>${s.deptBreak.reduce((a, r) => a + r.after, 0)}</b>`, '']]);

  return `<div style="font:11pt Calibri;color:#1f2a37">
<p>Dear All,</p>
<p>Please find the attendance summary for <b>${d}</b>.</p>
<p>As part of strengthening our work discipline and punctuality standards, we have set a
target of achieving 90% attendance within 15 minutes of the shift start time.<br>
The detailed summary is provided below for your reference and review.</p>
<p>Kindly ensure adherence to the defined timelines to help us consistently meet this target
and maintain a strong work culture.</p>
<p><b>1.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Target Summary</b></p>${abstract}
<p><b>2.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Login Summary</b></p>${login}
<p><b>3.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Break Hours Summary</b></p>${brk}
<p><b>4.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Department wise Login Summary</b></p>${dl}
<p><b>5.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Department wise Break Hours Summary</b></p>${db}
<p>Thanks &amp; Regards,<br>${sender}</p></div>`;
}

export const subject = (iso: string) => `Daily Attendance Summary - ${displayDate(iso)}`;
export const MAIL_TO = 'bangalore.ro@craftsilicon.com';
export const MAIL_CC = 'siva@craftsilicon.com; suhasini.s@craftsilicon.com; bangalore.pmo@craftsilicon.com';
