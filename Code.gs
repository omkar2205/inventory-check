const CONFIG = {
  SPREADSHEET_ID: '1Ra9p4d3FyPAqPFab8nJOI_YSEPiZ8fubU2lpAcCfn3w',
  EMPLOYEE_SHEET: 'Sheet1',
  LOG_SHEET: 'Distribution Log',
  MAX_SEARCH_RESULTS: 40,
};

const LOG_HEADERS = [
  'Timestamp',
  'Employee Code',
  'Employee Name',
  'Brand',
  'Team',
  'L1 Manager',
  'Collected By Code',
  'Collected By Name',
  'Transaction ID',
];

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || '').toLowerCase();
    let result;

    if (action === 'search') result = searchEmployees_(params);
    else if (action === 'give') result = giveOrders_(params);
    else if (action === 'stats') result = getStats_();
    else if (action === 'meta') result = getMeta_();
    else result = { ok: false, message: 'Unknown action.' };

    return jsonp_(result, params.callback);
  } catch (error) {
    return jsonp_({ ok: false, message: error.message || String(error) }, e && e.parameter && e.parameter.callback);
  }
}

function searchEmployees_(params) {
  const query = normalize_(params.q);
  const brand = normalize_(params.brand);
  const team = normalize_(params.team);
  const manager = normalize_(params.manager);
  const requestedLimit = Number(params.limit || 30);
  const limit = Math.max(1, Math.min(CONFIG.MAX_SEARCH_RESULTS, requestedLimit));

  if (query.length < 2 && !brand && !team && !manager) {
    return { ok: true, results: [] };
  }

  const employees = getEmployees_();
  const collectedMap = getCollectedMap_();
  const queryParts = query.split(/\s+/).filter(Boolean);

  const results = employees
    .filter(emp => {
      if (brand && normalize_(emp.brand) !== brand) return false;
      if (team && normalize_(emp.team) !== team) return false;
      if (manager && normalize_(emp.manager) !== manager) return false;

      if (!queryParts.length) return true;
      const haystack = normalize_([
        emp.code,
        emp.name,
        emp.brand,
        emp.team,
        emp.manager,
      ].join(' '));
      return queryParts.every(part => haystack.includes(part));
    })
    .sort((a, b) => rankEmployee_(a, query) - rankEmployee_(b, query) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(emp => {
      const collection = collectedMap[normalize_(emp.code)];
      return {
        code: emp.code,
        name: emp.name,
        brand: emp.brand,
        team: emp.team,
        manager: emp.manager,
        collected: Boolean(collection),
        collectedAt: collection ? formatTime_(collection.timestamp) : '',
        collectedBy: collection ? collection.collectedByName : '',
      };
    });

  return { ok: true, results };
}

function giveOrders_(params) {
  const codes = String(params.codes || '')
    .split(',')
    .map(code => code.trim())
    .filter(Boolean);

  if (!codes.length) return { ok: false, message: 'No employees selected.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const employees = getEmployees_();
    const employeeMap = {};
    employees.forEach(emp => employeeMap[normalize_(emp.code)] = emp);

    const collector = employeeMap[normalize_(params.collectorCode)] || employeeMap[normalize_(codes[0])] || null;
    const collectedMap = getCollectedMap_();
    const logSheet = getLogSheet_();
    const now = new Date();
    const transactionId = Utilities.getUuid();
    const rows = [];
    const given = [];
    const already = [];
    const missing = [];

    codes.forEach(code => {
      const key = normalize_(code);
      const employee = employeeMap[key];

      if (!employee) {
        missing.push(code);
        return;
      }

      if (collectedMap[key]) {
        already.push({
          code: employee.code,
          name: employee.name,
          collectedAt: formatTime_(collectedMap[key].timestamp),
        });
        return;
      }

      rows.push([
        now,
        employee.code,
        employee.name,
        employee.brand,
        employee.team,
        employee.manager,
        collector ? collector.code : '',
        collector ? collector.name : '',
        transactionId,
      ]);

      given.push({ code: employee.code, name: employee.name });
      collectedMap[key] = { timestamp: now, collectedByName: collector ? collector.name : '' };
    });

    if (rows.length) {
      logSheet.getRange(logSheet.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows);
      SpreadsheetApp.flush();
    }

    const stats = getStats_();
    return {
      ok: true,
      given,
      already,
      missing,
      transactionId,
      stats: { distributed: stats.distributed, total: stats.total },
    };
  } finally {
    lock.releaseLock();
  }
}

function getStats_() {
  const employees = getEmployees_();
  const employeeCodes = new Set(employees.map(emp => normalize_(emp.code)).filter(Boolean));
  const collected = getCollectedMap_();
  const distributed = Object.keys(collected).filter(code => employeeCodes.has(code)).length;

  return {
    ok: true,
    distributed,
    total: employeeCodes.size,
  };
}

function getMeta_() {
  const employees = getEmployees_();
  return {
    ok: true,
    filters: {
      brand: uniqueSorted_(employees.map(emp => emp.brand)),
      team: uniqueSorted_(employees.map(emp => emp.team)),
      manager: uniqueSorted_(employees.map(emp => emp.manager)),
    },
  };
}

function getEmployees_() {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.EMPLOYEE_SHEET);
  if (!sheet) throw new Error(`Employee sheet "${CONFIG.EMPLOYEE_SHEET}" was not found.`);

  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(value => String(value).trim());
  const col = {
    code: findHeader_(headers, ['Employee Code', 'Employee ID', 'Employee Id']),
    name: findHeader_(headers, ['Employee Name', 'Name']),
    brand: findHeader_(headers, ['Brand']),
    team: findHeader_(headers, ['Sub-Sub Service Line', 'Team', 'Service Line']),
    manager: findHeader_(headers, ['L1 Manager', 'Manager']),
  };

  if (col.code < 0 || col.name < 0) {
    throw new Error('Employee Code and Employee Name columns are required in Sheet1.');
  }

  return values.slice(1)
    .map((row, index) => ({
      rowNumber: index + 2,
      code: clean_(row[col.code]),
      name: clean_(row[col.name]),
      brand: col.brand >= 0 ? clean_(row[col.brand]) : '',
      team: col.team >= 0 ? clean_(row[col.team]) : '',
      manager: col.manager >= 0 ? clean_(row[col.manager]) : '',
    }))
    .filter(emp => emp.code && emp.name);
}

function getCollectedMap_() {
  const sheet = getLogSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};

  const values = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS.length).getValues();
  const map = {};

  values.forEach(row => {
    const code = normalize_(row[1]);
    if (!code) return;
    map[code] = {
      timestamp: row[0] instanceof Date ? row[0] : new Date(row[0]),
      collectedByCode: clean_(row[6]),
      collectedByName: clean_(row[7]),
      transactionId: clean_(row[8]),
    };
  });

  return map;
}

function getLogSheet_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(CONFIG.LOG_SHEET);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.LOG_SHEET);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    const existing = sheet.getRange(1, 1, 1, LOG_HEADERS.length).getDisplayValues()[0];
    if (existing.join('|') !== LOG_HEADERS.join('|')) {
      throw new Error(`The "${CONFIG.LOG_SHEET}" sheet exists but its headers do not match the expected format.`);
    }
  }

  return sheet;
}

function rankEmployee_(employee, query) {
  if (!query) return 10;
  const code = normalize_(employee.code);
  const name = normalize_(employee.name);
  if (code === query) return 0;
  if (name === query) return 1;
  if (code.startsWith(query)) return 2;
  if (name.startsWith(query)) return 3;
  if (name.split(/\s+/).some(part => part.startsWith(query))) return 4;
  return 10;
}

function findHeader_(headers, candidates) {
  const normalizedHeaders = headers.map(normalize_);
  for (const candidate of candidates) {
    const index = normalizedHeaders.indexOf(normalize_(candidate));
    if (index >= 0) return index;
  }
  return -1;
}

function uniqueSorted_(values) {
  const seen = new Map();
  values.forEach(value => {
    const clean = clean_(value);
    if (!clean) return;
    const key = normalize_(clean);
    if (!seen.has(key)) seen.set(key, clean);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function formatTime_(date) {
  if (!date || isNaN(new Date(date).getTime())) return '';
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return Utilities.formatDate(new Date(date), spreadsheet.getSpreadsheetTimeZone(), 'dd MMM, h:mm a');
}

function clean_(value) {
  return String(value == null ? '' : value).trim();
}

function normalize_(value) {
  return clean_(value).toLowerCase().replace(/\s+/g, ' ');
}

function jsonp_(payload, callback) {
  const safeCallback = String(callback || '').replace(/[^a-zA-Z0-9_.$]/g, '');
  const json = JSON.stringify(payload);
  const output = safeCallback ? `${safeCallback}(${json});` : json;
  return ContentService.createTextOutput(output)
    .setMimeType(safeCallback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}
