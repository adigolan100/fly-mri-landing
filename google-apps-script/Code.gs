/**
 * FLY MRI — קליטת לידים מהאתר ל-Google Sheet.
 * (מייל ההתראה על כל ליד נשלח מהאתר דרך Resend, לא מכאן.)
 *
 * הקוד הזה רץ בחשבון ה-Google שלך (Apps Script), לא ב-Vercel.
 * כל שינוי כאן — יש להדביק מחדש ב-Apps Script ולפרוס גרסה חדשה
 * (Deploy → Manage deployments → ✏️ → Version: New version → Deploy).
 *
 * התקנה: הדבק את הקובץ ב-Apps Script והרץ setup() פעם אחת.
 *
 * הגדרות (Project Settings → Script Properties):
 *   SPREADSHEET_ID — נוצר אוטומטית בהרצת setup().
 *   LEAD_SECRET   — חובה. נוצר אוטומטית בהרצת setup() (מודפס ב-Execution log).
 *                   אותו ערך בדיוק צריך להיות SHEETS_SECRET באתר (.env.local / Vercel).
 */

// שם הגיליון שנוצר בדרייב בהרצת setup(). ה-ID שלו נשמר ב-Script Property בשם SPREADSHEET_ID.
const SPREADSHEET_NAME = 'FLY MRI — לידים מהאתר';

function getSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID missing — run setup() first');
  return SpreadsheetApp.openById(id).getSheets()[0];
}

// סדר העמודות בגיליון. key = שם השדה שהאתר שולח; '' = עמודה ידנית (סטטוס/הערות).
const COLUMNS = [
  ['תאריך ושעה', '_received'],
  ['שם', 'name'],
  ['טלפון', 'phone'],
  ['אימייל', 'email'],
  ['סטטוס', ''],
  ['הערות', ''],
  ['הסכמה לדיוור', 'marketing_consent'],
  ['utm_source', 'utm_source'],
  ['utm_medium', 'utm_medium'],
  ['utm_campaign', 'utm_campaign'],
  ['utm_term', 'utm_term'],
  ['utm_content', 'utm_content'],
  ['last_utm_source', 'last_utm_source'],
  ['last_utm_medium', 'last_utm_medium'],
  ['last_utm_campaign', 'last_utm_campaign'],
  ['עמוד', 'page'],
  ['עמוד נחיתה', 'landing_page'],
  ['referrer', 'referrer'],
  ['gclid', 'gclid'],
  ['gbraid', 'gbraid'],
  ['wbraid', 'wbraid'],
  ['fbclid', 'fbclid'],
  ['msclkid', 'msclkid'],
  ['ttclid', 'ttclid'],
  ['זמן הסכמה', 'consent_at'],
  ['IP', 'ip'],
  ['user_agent', 'user_agent'],
];

function doPost(e) {
  const p = (e && e.parameter) || {};
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('LEAD_SECRET');

  if (!secret || p.token !== secret) {
    return json_({ ok: false, error: 'unauthorized' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let sheet;
  try {
    sheet = getSheet_();
    ensureHeader_(sheet);

    const tz = 'Asia/Jerusalem';
    const received = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
    const row = COLUMNS.map(function (c) {
      if (c[1] === '_received') return received;
      if (!c[1]) return '';
      return safeCell_(p[c[1]]);
    });
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }

  // מייל ההתראה נשלח מהאתר עצמו (Resend) — ראו app/api/lead/route.ts.
  return json_({ ok: true });
}

function doGet() {
  return json_({ ok: true, service: 'fly-mri-leads' });
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(COLUMNS.map(function (c) { return c[0]; }));
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
  sheet.setRightToLeft(true);
}

// מונע הזרקת נוסחאות (ערך שמתחיל ב- = + - @ ייכתב כטקסט).
// טלפון שמתחיל ב-0 נשמר כטקסט כדי שהאפס לא ייעלם.
function safeCell_(v) {
  const s = String(v == null ? '' : v).slice(0, 1000);
  if (/^[=+\-@]/.test(s) || /^0\d/.test(s)) return "'" + s;
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * הרצה חד-פעמית (בטוח להריץ שוב):
 *  - יוצר את גיליון הלידים בדרייב אם עוד לא קיים
 *  - יוצר LEAD_SECRET אקראי אם עוד לא קיים
 *  - מדפיס את שניהם ל-Execution log
 */
function setup() {
  const props = PropertiesService.getScriptProperties();

  let id = props.getProperty('SPREADSHEET_ID');
  if (!id) {
    const ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    ss.setSpreadsheetTimeZone('Asia/Jerusalem');
    id = ss.getId();
    props.setProperty('SPREADSHEET_ID', id);
  }
  const sheet = getSheet_();
  ensureHeader_(sheet);

  let secret = props.getProperty('LEAD_SECRET');
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('LEAD_SECRET', secret);
  }

  console.log('SHEET_URL=' + sheet.getParent().getUrl());
  console.log('LEAD_SECRET=' + secret);
}

/** בדיקה ידנית מתוך עורך Apps Script: בחר testLead ← Run. */
function testLead() {
  const secret = PropertiesService.getScriptProperties().getProperty('LEAD_SECRET');
  const res = doPost({ parameter: {
    token: secret, name: 'ליד בדיקה', phone: '0501234567', email: 'test@example.com',
    marketing_consent: 'לא', page: 'manual-test', utm_source: 'test',
  } });
  console.log(res.getContent());
}
