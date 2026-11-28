/**
 * FLY MRI — קליטת לידים מהאתר ל-Google Sheet + תיעוד הסכמות לדיוור.
 * (מייל ההתראה על כל ליד נשלח מהאתר דרך Resend, לא מכאן.)
 *
 * הקוד הזה רץ בחשבון ה-Google שלך (Apps Script), לא ב-Vercel.
 * כל שינוי כאן — יש להדביק מחדש ב-Apps Script ולפרוס גרסה חדשה
 * (Deploy → Manage deployments → ✏️ → Version: New version → Deploy).
 * כתובת ה-/exec נשארת אותה כתובת, כך שאין צורך לשנות דבר ב-Vercel.
 *
 * גרסה 2 (2026-11-28):
 *  - ארבע עמודות חדשות בסוף לשונית הלידים: מקור ההסכמה, מועד ההסכמה, גרסת נוסח, מזהה ליד.
 *    העמודות הקיימות לא זזות ולא משתנות. כותרת חסרה נוספת אוטומטית בסוף השורה הראשונה.
 *  - לשונית "הסכמות": יומן שרק מוסיפים אליו — שורה לכל הסכמה.
 *  - לשונית "גרסאות נוסח": הנוסח המלא של כל גרסה (תיבת הטופס וחלון המגזין בנפרד).
 *  - action=consent: הסכמה מחלון המגזין — מעדכן את שורת הליד לפי מזהה הליד.
 *  - תואם לאחור: ליד בלי השדות החדשים נשמר כמו קודם.
 *
 * הגדרות (Project Settings → Script Properties):
 *   SPREADSHEET_ID — נוצר אוטומטית בהרצת setup().
 *   LEAD_SECRET   — חובה. נוצר אוטומטית בהרצת setup() (מודפס ב-Execution log).
 *                   אותו ערך בדיוק צריך להיות SHEETS_SECRET באתר (.env.local / Vercel).
 */

const SCRIPT_VERSION = 2;

// שם הגיליון שנוצר בדרייב בהרצת setup(). ה-ID שלו נשמר ב-Script Property בשם SPREADSHEET_ID.
const SPREADSHEET_NAME = 'FLY MRI — לידים מהאתר';
const CONSENT_LOG_SHEET = 'הסכמות';
const VERSIONS_SHEET = 'גרסאות נוסח';

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID missing — run setup() first');
  return SpreadsheetApp.openById(id);
}

// לשונית הלידים ננעלת לפי ה-ID שלה (נשמר ב-LEADS_SHEET_ID), כדי שהזזת לשוניות
// "הסכמות" / "גרסאות נוסח" לראש הרשימה לא תשלח לידים ללשונית הלא נכונה.
function getSheet_() {
  const ss = getSpreadsheet_();
  const props = PropertiesService.getScriptProperties();
  const pinned = props.getProperty('LEADS_SHEET_ID');
  if (pinned) {
    const found = ss.getSheets().filter(function (s) { return String(s.getSheetId()) === pinned; })[0];
    if (found) return found;
  }
  const candidates = ss.getSheets().filter(function (s) {
    return s.getName() !== CONSENT_LOG_SHEET && s.getName() !== VERSIONS_SHEET;
  });
  const sheet = candidates[0] || ss.getSheets()[0];
  props.setProperty('LEADS_SHEET_ID', String(sheet.getSheetId()));
  return sheet;
}

// עמודות לשונית הלידים. key = שם השדה שהאתר שולח; '' = עמודה ידנית (סטטוס/הערות).
// העמודות נמצאות לפי שם הכותרת — לא לפי מיקום — כך שעמודה שהוספת ידנית לא תידרס.
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
  // ── גרסה 2 — בסוף השורה ──
  ['מקור ההסכמה', 'consent_source'],
  ['מועד ההסכמה', 'consent_at_utc'],
  ['גרסת נוסח', 'consent_version'],
  ['מזהה ליד', 'lead_id'],
];

// יומן ההסכמות — שורה לכל הסכמה (טופס או חלון). לא מעדכנים ולא מוחקים שורות כאן.
const LOG_COLUMNS = [
  ['נרשם (שעון ישראל)', '_received'],
  ['מזהה ליד', 'lead_id'],
  ['שם', 'name'],
  ['טלפון', 'phone'],
  ['אימייל', 'email'],
  ['מקור', 'consent_source'],
  ['מועד ההסכמה (UTC)', 'consent_at_utc'],
  ['גרסת נוסח', 'consent_version'],
  ['ערוצים', 'consent_channels'],
  ['כתובת העמוד', 'page'],
];

// הנוסח המלא של כל גרסה. חייב להיות זהה תו-לתו ל-lib/consent.ts באתר.
const VERSIONS = [
  // v0 — תיבת הסימון שהייתה באתר עד גרסה זו (נוסח ישן, לתיעוד לידים שאישרו בה).
  ['v0', 'טופס',
    'אני מאשר/ת קבלת דיוור שיווקי, עדכונים ותוכן מ-Fly MRI בדוא"ל ובהודעות SMS/וואטסאפ. אפשר להסיר את ההסכמה בכל עת.'],
  ['v1', 'טופס',
    'שלחו לי את המגזין של Fly MRI: חידושים בלונג\'יביטי וברפואה מונעת, בגובה העיניים. נשלח בדוא"ל, ב-SMS ובוואטסאפ, יחד עם עדכונים ומבצעים שלנו. אפשר כמובן להסיר בכל עת.'],
  ['v1', 'חלון', [
    'הבקשה שלך התקבלה, ניצור איתך קשר בקרוב.',
    '{שם}, רוצה להתעדכן במה שחדש ברפואה המונעת? (בלי שם: רוצה להתעדכן במה שחדש ברפואה המונעת?)',
    'המגזין של Fly MRI: חידושים בלונג\'יביטי וברפואה מונעת שממש שווה לדעת עליהם, בגובה העיניים.',
    'בגיליון הקרוב: הגיל הביולוגי שלך — למה הוא חשוב יותר מתאריך הלידה.',
    'נשלח בדוא"ל, ב-SMS ובוואטסאפ, יחד עם עדכונים ומבצעים שלנו. אפשר כמובן להסיר בכל עת.',
    '[כפתור] כן, שלחו לי',
    '[קישור] לא תודה',
  ].join('\n')],
  // v2 (2026-11-28) — נוסח "עדכונים" במקום "מגזין". הסכמות קודמות נשארות עם v1.
  ['v2', 'טופס',
    'עדכנו אותי בחידושים בתחום הלונג\'יביטי, הארכת החיים והרפואה המונעת, רק כשיש משהו שבאמת שווה לדעת. נשלח בדוא"ל, ב-SMS ובוואטסאפ, יחד עם עדכונים ומבצעים שלנו. אפשר כמובן להסיר בכל עת.'],
  ['v2', 'חלון', [
    'הבקשה שלך התקבלה, ניצור איתך קשר בקרוב.',
    '{שם}, רוצה להתעדכן בחידושים בתחום הלונג\'יביטי, הארכת החיים והרפואה המונעת? (בלי שם: רוצה להתעדכן בחידושים בתחום הלונג\'יביטי, הארכת החיים והרפואה המונעת?)',
    'אנחנו ב-Fly MRI עוקבים בשבילכם אחרי ההתפתחויות בתחום, ומעדכנים רק כשיש משהו שבאמת שווה לדעת.',
    'בעדכון הקרוב: הגיל הביולוגי שלך: למה הוא חשוב יותר מתאריך הלידה, ומה באמת מזיז אותו אחורה.',
    'נשלח בדוא"ל, ב-SMS ובוואטסאפ, יחד עם עדכונים ומבצעים שלנו. אפשר כמובן להסיר בכל עת.',
    '[כפתור] כן, עדכנו אותי',
    '[קישור] לא תודה',
  ].join('\n')],
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
  let result;
  try {
    result = p.action === 'consent' ? recordPopupConsent_(p) : addLead_(p);
  } finally {
    lock.releaseLock();
  }
  return json_(result);
}

function doGet() {
  return json_({ ok: true, service: 'fly-mri-leads', v: SCRIPT_VERSION });
}

function receivedNow_() {
  return Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd HH:mm:ss');
}

/** ליד חדש: שורה בלשונית הלידים (+ שורה ביומן אם סימן את התיבה בטופס). */
function addLead_(p) {
  // ליד מהאתר הישן (לפני גרסה 2) שסימן את התיבה הישנה: מתועד כ-v0 / טופס.
  if (!p.consent_source && p.marketing_consent === 'כן') {
    p = Object.assign({}, p, {
      consent_source: 'טופס',
      consent_at_utc: p.consent_at ? String(p.consent_at).replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '',
      consent_version: 'v0',
      consent_channels: 'email, sms, whatsapp',
    });
  }
  const sheet = getSheet_();
  const cols = columnIndex_(sheet, COLUMNS);
  const received = receivedNow_();
  const row = new Array(cols._width).fill('');
  COLUMNS.forEach(function (c) {
    if (!c[1]) return;
    row[cols[c[1]] - 1] = c[1] === '_received' ? received
      : c[1] === 'consent_at_utc' ? textCell_(p[c[1]]) : safeCell_(p[c[1]]);
  });
  sheet.appendRow(row);

  // הליד כבר שמור. כשל ביומן לא יכשיל את הליד (אחרת הלקוח יראה שגיאה וישלח שוב);
  // האתר מקבל log:false ורושם שגיאה, וההסכמה עדיין מתועדת בשורת הליד עצמה.
  if (p.consent_source) {
    try {
      appendConsentLog_(p, { name: p.name, phone: p.phone, email: p.email }, received);
    } catch (err) {
      console.error('consent log failed for ' + p.lead_id + ': ' + err);
      return { ok: true, v: SCRIPT_VERSION, log: false };
    }
  }
  return { ok: true, v: SCRIPT_VERSION };
}

/** "כן, שלחו לי" בחלון המגזין: מעדכן את שורת הליד ומוסיף שורה ליומן. */
function recordPopupConsent_(p) {
  const leadId = String(p.lead_id || '');
  if (!/^[0-9a-f-]{36}$/.test(leadId)) return { ok: false, error: 'bad_lead_id' };

  const sheet = getSheet_();
  const cols = columnIndex_(sheet, COLUMNS);
  const last = sheet.getLastRow();
  if (last < 2) return { ok: false, error: 'lead_not_found' };

  const ids = sheet.getRange(2, cols.lead_id, last - 1, 1).getValues();
  let rowNum = 0;
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === leadId) { rowNum = i + 2; break; }
  }
  if (!rowNum) return { ok: false, error: 'lead_not_found' };

  const values = sheet.getRange(rowNum, 1, 1, cols._width).getDisplayValues()[0];
  const cell = function (key) { return values[cols[key] - 1]; };
  const lead = { name: cell('name'), phone: cell('phone'), email: cell('email') };

  // קודם היומן ואחר כך שורת הליד — וכל שלב מדלג אם כבר בוצע. כך ניסיון חוזר אחרי
  // כשל באמצע משלים את החסר, ולא נוצרות שורות כפולות ביומן.
  const rowDone = !!cell('consent_source');
  const logDone = consentLogged_(leadId);
  if (rowDone && logDone) return { ok: true, v: SCRIPT_VERSION, already: true, lead: lead };

  if (!logDone) {
    // אם השורה כבר עודכנה (ניסיון קודם נכשל אחרי העדכון) — היומן משקף את מה שבשורה.
    const src = rowDone
      ? Object.assign({}, p, {
          consent_source: cell('consent_source'),
          consent_at_utc: cell('consent_at_utc'),
          consent_version: cell('consent_version'),
        })
      : p;
    appendConsentLog_(src, lead, receivedNow_());
  }
  if (!rowDone) {
    sheet.getRange(rowNum, cols.marketing_consent).setValue('כן');
    sheet.getRange(rowNum, cols.consent_source).setValue(safeCell_(p.consent_source));
    sheet.getRange(rowNum, cols.consent_at_utc).setValue(textCell_(p.consent_at_utc));
    sheet.getRange(rowNum, cols.consent_version).setValue(safeCell_(p.consent_version));
  }
  return { ok: true, v: SCRIPT_VERSION, lead: lead };
}

function appendConsentLog_(p, lead, received) {
  const ss = getSpreadsheet_();
  ensureVersions_(ss);
  const log = sheetByName_(ss, CONSENT_LOG_SHEET);
  const cols = columnIndex_(log, LOG_COLUMNS);
  const src = { name: lead.name, phone: lead.phone, email: lead.email };
  const row = new Array(cols._width).fill('');
  LOG_COLUMNS.forEach(function (c) {
    const key = c[1];
    const v = key === '_received' ? received : (key in src ? src[key] : p[key]);
    row[cols[key] - 1] = key === '_received' ? v : key === 'consent_at_utc' ? textCell_(v) : safeCell_(v);
  });
  log.appendRow(row);
}

function consentLogged_(leadId) {
  const log = getSpreadsheet_().getSheetByName(CONSENT_LOG_SHEET);
  if (!log || log.getLastRow() < 2) return false;
  const cols = columnIndex_(log, LOG_COLUMNS);
  const ids = log.getRange(2, cols.lead_id, log.getLastRow() - 1, 1).getValues();
  return ids.some(function (r) { return String(r[0]) === leadId; });
}

function ensureVersions_(ss) {
  const sh = sheetByName_(ss, VERSIONS_SHEET);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['גרסה', 'מיקום', 'נוסח מלא']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold');
    sh.setRightToLeft(true);
  }
  const existing = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues() : [];
  VERSIONS.forEach(function (v) {
    const found = existing.some(function (r) { return r[0] === v[0] && r[1] === v[1]; });
    if (!found) sh.appendRow([v[0], v[1], v[2]]);
  });
}

function sheetByName_(ss, name) {
  // לשונית חדשה נוספת בסוף, כדי שלא תדחוף את לשונית הלידים ממקומה.
  return ss.getSheetByName(name) || ss.insertSheet(name, ss.getSheets().length);
}

/**
 * מחזיר מיפוי key → מספר עמודה (1-based) לפי שם הכותרת בשורה 1.
 * גיליון ריק מקבל שורת כותרות; כותרת שחסרה נוספת בסוף השורה (לא משנים קיימות).
 */
function columnIndex_(sheet, columns) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(columns.map(function (c) { return c[0]; }));
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold');
    sheet.setRightToLeft(true);
  }
  const width = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  const map = {};
  let next = width + 1;
  columns.forEach(function (c) {
    if (!c[1]) return;
    let idx = header.indexOf(c[0]) + 1;
    if (!idx) {
      sheet.getRange(1, next).setValue(c[0]).setFontWeight('bold');
      header[next - 1] = c[0];
      idx = next++;
    }
    map[c[1]] = idx;
  });
  map._width = next - 1;
  return map;
}

// מועד UTC נשמר כטקסט כמו שהוא — שגוגל שיטס לא ימיר אותו לתאריך באזור זמן אחר.
function textCell_(v) {
  const s = safeCell_(v);
  return s && s.charAt(0) !== "'" ? "'" + s : s;
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
 *  - מוסיף את כותרות העמודות החדשות ואת לשוניות "הסכמות" ו"גרסאות נוסח"
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
  const ss = getSpreadsheet_();
  const sheet = getSheet_();
  columnIndex_(sheet, COLUMNS);
  columnIndex_(sheetByName_(ss, CONSENT_LOG_SHEET), LOG_COLUMNS);
  ensureVersions_(ss);

  let secret = props.getProperty('LEAD_SECRET');
  if (!secret) {
    secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('LEAD_SECRET', secret);
  }

  console.log('SHEET_URL=' + ss.getUrl());
  console.log('LEAD_SECRET=' + secret);
}

/** בדיקה ידנית מתוך עורך Apps Script: בחר testLead ← Run. מוסיף שורת "ליד בדיקה". */
function testLead() {
  const secret = PropertiesService.getScriptProperties().getProperty('LEAD_SECRET');
  const res = doPost({ parameter: {
    token: secret, name: 'ליד בדיקה', phone: '0501234567', email: 'test@example.com',
    marketing_consent: 'לא', page: 'manual-test', utm_source: 'test',
    lead_id: Utilities.getUuid(),
  } });
  console.log(res.getContent());
}
