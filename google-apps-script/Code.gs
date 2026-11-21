/**
 * FLY MRI — קליטת לידים מהאתר ל-Google Sheet + מייל התראה על כל ליד.
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
 *   NOTIFY_EMAILS — אופציונלי. נמענים נוספים למייל, מופרדים בפסיק.
 *                   ברירת מחדל: בעל החשבון שפורס את הסקריפט.
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

  // המייל נשלח אחרי שהליד כבר נשמר — כשל במייל לא מאבד ליד.
  try {
    sendNotification_(p, sheet.getParent().getUrl());
  } catch (err) {
    console.error('mail failed: ' + err);
    return json_({ ok: true, mail: false });
  }
  return json_({ ok: true, mail: true });
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

function sendNotification_(p, sheetUrl) {
  const owner = Session.getEffectiveUser().getEmail();
  const extra = (PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS') || '')
    .split(',').map(function (x) { return x.trim(); }).filter(String);
  const to = [owner].concat(extra).filter(String).join(',');
  if (!to) return;

  const name = p.name || '(ללא שם)';
  const phone = p.phone || '';
  const intlPhone = phone.replace(/\D/g, '').replace(/^0/, '972');
  const source = [p.utm_source, p.utm_medium, p.utm_campaign].filter(String).join(' / ') || 'כניסה ישירה / לא ידוע';

  const rows = [
    ['שם', esc_(name)],
    ['טלפון', '<a href="tel:' + esc_(phone) + '">' + esc_(phone) + '</a>' +
      (intlPhone ? ' &nbsp;·&nbsp; <a href="https://wa.me/' + intlPhone + '">וואטסאפ</a>' : '')],
    ['אימייל', p.email ? '<a href="mailto:' + esc_(p.email) + '">' + esc_(p.email) + '</a>' : '—'],
    ['מקור', esc_(source)],
    ['הסכמה לדיוור', esc_(p.marketing_consent || '—')],
    ['עמוד', esc_(p.page || '—')],
  ].map(function (r) {
    return '<tr><td style="padding:6px 12px;color:#666;white-space:nowrap">' + r[0] +
      '</td><td style="padding:6px 12px;font-weight:600">' + r[1] + '</td></tr>';
  }).join('');

  const html =
    '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px">' +
    '<h2 style="margin:0 0 12px">ליד חדש מהאתר 🎯</h2>' +
    '<table style="border-collapse:collapse">' + rows + '</table>' +
    '<p style="margin-top:16px"><a href="' + sheetUrl + '">פתיחת גיליון הלידים</a></p>' +
    '</div>';

  MailApp.sendEmail({
    to: to,
    subject: 'ליד חדש מהאתר: ' + name + (phone ? ' · ' + phone : ''),
    htmlBody: html,
    replyTo: p.email || undefined,
    name: 'FLY MRI — לידים',
  });
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
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

  MailApp.getRemainingDailyQuota(); // כדי שאישור ההרשאות יכלול גם שליחת מייל
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
