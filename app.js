const CONFIG = {
  API_URL: 'https://igqjmqwzmvkowrtidlgx.supabase.co/functions/v1/inventory-api',
  PUBLISHABLE_KEY: 'sb_publishable_iGGDpaTsYNjM4wnw6J9U3g_U_P1fKg5',
  MIN_QUERY_LENGTH: 2,
  MAX_RESULTS: 40,
  REQUEST_TIMEOUT_MS: 10000,
};

const state = {
  pin: '',
  query: '',
  filters: { brand: '', team: '', manager: '', l2Manager: '' },
  allEmployees: [],
  results: [],
  selected: new Map(),
  filterOptions: { brand: [], team: [], manager: [], l2Manager: [] },
  stats: { distributed: 0, total: 0 },
  busyCodes: new Set(),
};

const els = {
  accessGate: document.getElementById('accessGate'),
  accessForm: document.getElementById('accessForm'),
  pinInput: document.getElementById('pinInput'),
  gateError: document.getElementById('gateError'),
  unlockButton: document.getElementById('unlockButton'),
  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  results: document.getElementById('results'),
  emptyState: document.getElementById('emptyState'),
  statusArea: document.getElementById('statusArea'),
  selectionTray: document.getElementById('selectionTray'),
  selectedCount: document.getElementById('selectedCount'),
  giveSelectedButton: document.getElementById('giveSelectedButton'),
  selectionSummary: document.getElementById('selectionSummary'),
  activeFilters: document.getElementById('activeFilters'),
  distributedCount: document.getElementById('distributedCount'),
  totalCount: document.getElementById('totalCount'),
  statsPill: document.getElementById('statsPill'),
  sheet: document.getElementById('sheet'),
  sheetEyebrow: document.getElementById('sheetEyebrow'),
  sheetTitle: document.getElementById('sheetTitle'),
  sheetBody: document.getElementById('sheetBody'),
  closeSheet: document.getElementById('closeSheet'),
  toast: document.getElementById('toast'),
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getDeviceId() {
  const key = 'inventory_device_id';
  try {
    let value = localStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, value);
    }
    return value;
  } catch {
    return `device-${Date.now()}`;
  }
}

function getStoredPin() {
  try { return sessionStorage.getItem('inventory_event_pin') || ''; }
  catch { return ''; }
}

function setStoredPin(pin) {
  try { sessionStorage.setItem('inventory_event_pin', pin); } catch {}
}

function clearStoredPin() {
  try { sessionStorage.removeItem('inventory_event_pin'); } catch {}
}

async function apiRequest(action, body = {}, pin = state.pin) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': CONFIG.PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action, pin, ...body }),
      signal: controller.signal,
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      const error = new Error(payload.message || 'Unable to process the request.');
      error.code = payload.code || `HTTP_${response.status}`;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Connection timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function showGate(message = '') {
  document.body.classList.add('locked');
  els.accessGate.classList.remove('hidden');
  els.gateError.textContent = message;
  els.gateError.classList.toggle('hidden', !message);
  setTimeout(() => els.pinInput.focus(), 80);
}

function hideGate() {
  document.body.classList.remove('locked');
  els.accessGate.classList.add('hidden');
  els.gateError.classList.add('hidden');
  setTimeout(() => els.searchInput.focus(), 80);
}

async function unlock(pin) {
  const cleanPin = String(pin || '').replace(/\D/g, '').slice(0, 6);
  if (cleanPin.length !== 6) {
    showGate('Enter the 6-digit PIN.');
    return;
  }

  els.unlockButton.disabled = true;
  els.unlockButton.textContent = 'Opening…';
  els.gateError.classList.add('hidden');

  try {
    await loadRoster(cleanPin);
    state.pin = cleanPin;
    setStoredPin(cleanPin);
    els.pinInput.value = '';
    hideGate();
  } catch (error) {
    state.pin = '';
    clearStoredPin();
    showGate(error.code === 'INVALID_PIN' ? 'That PIN is not correct.' : error.message);
  } finally {
    els.unlockButton.disabled = false;
    els.unlockButton.textContent = 'Open distribution';
  }
}

async function loadRoster(pin = state.pin, { quiet = false } = {}) {
  if (!quiet) showStatus('info', 'Loading employee list…');
  const payload = await apiRequest('bootstrap', {}, pin);
  state.allEmployees = payload.employees || [];
  state.filterOptions = payload.filters || state.filterOptions;
  updateStats(payload.stats || {});
  if (!quiet) clearStatus();
  runSearch();
  return payload;
}

function bindEvents() {
  els.accessForm.addEventListener('submit', event => {
    event.preventDefault();
    unlock(els.pinInput.value);
  });

  els.pinInput.addEventListener('input', () => {
    els.pinInput.value = els.pinInput.value.replace(/\D/g, '').slice(0, 6);
    els.gateError.classList.add('hidden');
  });

  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value.trim();
    els.clearSearch.classList.toggle('hidden', !state.query);
    runSearch();
  });

  els.searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    }
  });

  els.clearSearch.addEventListener('click', () => {
    resetSearch();
    els.searchInput.focus();
  });

  document.querySelectorAll('.filter-chip').forEach(button => {
    button.addEventListener('click', () => openFilterSheet(button.dataset.filter));
  });

  els.closeSheet.addEventListener('click', closeSheet);
  els.sheet.addEventListener('click', event => {
    if (event.target === els.sheet) closeSheet();
  });

  els.giveSelectedButton.addEventListener('click', openReviewSheet);
  els.selectionSummary.addEventListener('click', openReviewSheet);
  els.statsPill.addEventListener('click', openStatsSheet);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSheet();
  });
}

function resetSearch() {
  els.searchInput.value = '';
  state.query = '';
  els.clearSearch.classList.add('hidden');
  runSearch();
}

function hasAnyFilter() {
  return Object.values(state.filters).some(Boolean);
}

function employeeSearchScore(employee, query) {
  if (!query) return 1;
  const fields = {
    code: normalize(employee.code),
    name: normalize(employee.name),
    brand: normalize(employee.brand),
    team: normalize(employee.team),
    manager: normalize(employee.manager),
    l2: normalize(employee.l2Manager),
  };

  if (fields.code === query) return 100;
  if (fields.name === query) return 95;
  if (fields.code.startsWith(query)) return 90;
  if (fields.name.startsWith(query)) return 85;
  if (fields.name.includes(query)) return 75;
  if (fields.manager.startsWith(query) || fields.l2.startsWith(query)) return 65;
  if (fields.team.startsWith(query) || fields.brand.startsWith(query)) return 55;
  if (Object.values(fields).some(value => value.includes(query))) return 45;
  return 0;
}

function runSearch() {
  if (!state.allEmployees.length) return;

  const query = normalize(state.query);
  if (query.length < CONFIG.MIN_QUERY_LENGTH && !hasAnyFilter()) {
    state.results = [];
    renderResults();
    clearStatus();
    return;
  }

  state.results = state.allEmployees
    .map(employee => ({ employee, score: employeeSearchScore(employee, query) }))
    .filter(({ employee, score }) => {
      if (query && score === 0) return false;
      if (state.filters.brand && employee.brand !== state.filters.brand) return false;
      if (state.filters.team && employee.team !== state.filters.team) return false;
      if (state.filters.manager && employee.manager !== state.filters.manager) return false;
      if (state.filters.l2Manager && employee.l2Manager !== state.filters.l2Manager) return false;
      return true;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.employee.collected !== b.employee.collected) return a.employee.collected ? 1 : -1;
      return a.employee.name.localeCompare(b.employee.name);
    })
    .slice(0, CONFIG.MAX_RESULTS)
    .map(item => item.employee);

  renderResults();
  if (!state.results.length && (query || hasAnyFilter())) {
    showStatus('error', 'No matching employee found.');
  } else {
    clearStatus();
  }
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function collectedText(employee) {
  const time = formatTime(employee.collectedAt);
  const proxy = employee.collectedByCode && employee.collectedByCode !== employee.code;
  if (proxy && employee.collectedByName) return `Collected by ${employee.collectedByName}${time ? ` · ${time}` : ''}`;
  return `Already collected${time ? ` · ${time}` : ''}`;
}

function renderResults() {
  const shouldShowEmpty = !state.results.length && !state.query && !hasAnyFilter();
  els.emptyState.classList.toggle('hidden', !shouldShowEmpty);

  els.results.innerHTML = state.results.map(employee => {
    const selected = state.selected.has(employee.code);
    const collected = Boolean(employee.collected);
    const busy = state.busyCodes.has(employee.code);
    const managerLines = [
      employee.manager ? `L1: ${escapeHtml(employee.manager)}` : '',
      employee.l2Manager ? `L2: ${escapeHtml(employee.l2Manager)}` : '',
    ].filter(Boolean).join('<br>');

    return `
      <article class="employee-card ${selected ? 'selected' : ''} ${collected ? 'collected' : ''}" data-code="${escapeHtml(employee.code)}">
        <div>
          <div class="employee-name">${escapeHtml(employee.name)}</div>
          <div class="employee-code">${escapeHtml(employee.code)}</div>
          <div class="employee-meta">
            ${escapeHtml([employee.brand, employee.team].filter(Boolean).join(' · '))}
            ${managerLines ? `<br>${managerLines}` : ''}
          </div>
          <div class="state-line ${collected ? 'collected' : 'available'}">
            ${collected ? escapeHtml(collectedText(employee)) : '● Available'}
          </div>
        </div>
        <div class="card-actions">
          ${collected
            ? '<button class="given-button" type="button" disabled>GIVEN</button>'
            : `
              <button class="quick-give" type="button" data-quick-give="${escapeHtml(employee.code)}" ${busy ? 'disabled' : ''}>${busy ? 'SAVING' : 'GIVE'}</button>
              <button class="batch-add ${selected ? 'selected' : ''}" type="button" data-select="${escapeHtml(employee.code)}" ${busy ? 'disabled' : ''}>${selected ? '✓ SELECTED' : '+ GROUP'}</button>
            `}
        </div>
      </article>`;
  }).join('');

  els.results.querySelectorAll('[data-quick-give]').forEach(button => {
    button.addEventListener('click', () => quickGive(button.dataset.quickGive));
  });

  els.results.querySelectorAll('[data-select]').forEach(button => {
    button.addEventListener('click', () => toggleEmployee(button.dataset.select));
  });
}

async function quickGive(code) {
  const employee = state.allEmployees.find(item => item.code === code);
  if (!employee || employee.collected || state.busyCodes.has(code)) return;
  await submitGive([code], code, { quick: true });
}

function toggleEmployee(code) {
  const employee = state.allEmployees.find(item => item.code === code);
  if (!employee || employee.collected || state.busyCodes.has(code)) return;

  if (state.selected.has(code)) state.selected.delete(code);
  else state.selected.set(code, employee);

  renderResults();
  renderSelectionTray();
}

function renderSelectionTray() {
  const count = state.selected.size;
  els.selectionTray.classList.toggle('hidden', count === 0);
  els.selectedCount.textContent = count;
  els.giveSelectedButton.textContent = count === 1 ? 'Review 1' : `Review ${count}`;
}

function renderActiveFilters() {
  const active = Object.entries(state.filters).filter(([, value]) => value);
  els.activeFilters.classList.toggle('hidden', active.length === 0);
  els.activeFilters.innerHTML = active.map(([key, value]) =>
    `<button class="active-filter" type="button" data-clear-filter="${key}">${escapeHtml(value)} ×</button>`
  ).join('');

  document.querySelectorAll('.filter-chip').forEach(button => {
    button.classList.toggle('active', Boolean(state.filters[button.dataset.filter]));
  });

  els.activeFilters.querySelectorAll('[data-clear-filter]').forEach(button => {
    button.addEventListener('click', () => {
      state.filters[button.dataset.clearFilter] = '';
      renderActiveFilters();
      runSearch();
    });
  });
}

function openFilterSheet(type) {
  const labels = { brand: 'Brand', team: 'Team', manager: 'L1 Manager', l2Manager: 'L2 Manager' };
  const options = state.filterOptions[type] || [];
  openSheet('FILTER', labels[type], options.length
    ? options.map(option => `
        <button class="sheet-option" type="button" data-filter-value="${escapeHtml(option)}">
          <span>${escapeHtml(option)}</span><span>›</span>
        </button>`).join('')
    : '<div class="status-banner info">No options available.</div>');

  els.sheetBody.querySelectorAll('[data-filter-value]').forEach(button => {
    button.addEventListener('click', () => {
      state.filters[type] = button.dataset.filterValue;
      renderActiveFilters();
      closeSheet();
      runSearch();
    });
  });
}

function openReviewSheet() {
  const employees = [...state.selected.values()].filter(employee => !employee.collected);
  if (!employees.length) return;

  const collectorOptions = employees.map((employee, index) =>
    `<option value="${escapeHtml(employee.code)}" ${index === 0 ? 'selected' : ''}>${escapeHtml(employee.name)} (${escapeHtml(employee.code)})</option>`
  ).join('');

  openSheet('GROUP COLLECTION', employees.length === 1 ? 'Give 1 order' : `Give ${employees.length} orders`, `
    <div class="selection-list">
      ${employees.map(employee => `
        <div class="selection-item">
          <strong>${escapeHtml(employee.name)}</strong>
          <span>${escapeHtml(employee.code)} · ${escapeHtml(employee.brand || '')}${employee.team ? ` · ${escapeHtml(employee.team)}` : ''}</span>
        </div>`).join('')}
    </div>
    <div class="collector-block">
      <strong>Who is collecting?</strong>
      <p>The selected collector is saved against every order in this group.</p>
      <select id="collectorSelect" class="collector-select">${collectorOptions}</select>
    </div>
    <button id="confirmGiveButton" class="confirm-button" type="button">${employees.length === 1 ? 'Confirm order given' : `Confirm ${employees.length} orders given`}</button>
  `);

  document.getElementById('confirmGiveButton').addEventListener('click', async () => {
    const collectorCode = document.getElementById('collectorSelect')?.value || employees[0].code;
    await submitGive(employees.map(employee => employee.code), collectorCode, { quick: false });
  });
}

async function submitGive(codes, collectorCode, { quick }) {
  const uniqueCodes = [...new Set(codes)].filter(Boolean);
  if (!uniqueCodes.length) return;

  uniqueCodes.forEach(code => state.busyCodes.add(code));
  renderResults();

  const confirmButton = document.getElementById('confirmGiveButton');
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = 'Saving…';
  }

  try {
    const payload = await apiRequest('give', {
      codes: uniqueCodes,
      collectorCode,
      deviceId: getDeviceId(),
    });

    const given = payload.given || [];
    const already = payload.already || [];
    const invalid = payload.invalid || [];
    const detailsByCode = new Map((payload.givenDetails || []).map(item => [item.code, item]));

    for (const employee of state.allEmployees) {
      if (!given.includes(employee.code)) continue;
      const detail = detailsByCode.get(employee.code) || {};
      employee.collected = true;
      employee.collectedAt = detail.collectedAt || new Date().toISOString();
      employee.collectedByCode = detail.collectedByCode || collectorCode;
      employee.collectedByName = detail.collectedByName || state.allEmployees.find(item => item.code === collectorCode)?.name || '';
      state.selected.delete(employee.code);
    }

    updateStats(payload.stats || {});
    renderSelectionTray();

    if (already.length) {
      try { await loadRoster(state.pin, { quiet: true }); } catch {}
    }

    if (!quick) closeSheet();

    if (given.length && !already.length && !invalid.length) {
      showToast(given.length === 1 ? 'Order given ✓' : `${given.length} orders given ✓`);
    } else {
      const parts = [];
      if (given.length) parts.push(`${given.length} given`);
      if (already.length) parts.push(`${already.length} already collected`);
      if (invalid.length) parts.push(`${invalid.length} not found`);
      showToast(parts.join(' · ') || 'No changes made');
    }

    if (quick) {
      resetSearch();
      setTimeout(() => els.searchInput.focus(), 60);
    } else {
      state.selected.clear();
      renderSelectionTray();
      runSearch();
      setTimeout(() => els.searchInput.focus(), 60);
    }
  } catch (error) {
    if (error.code === 'INVALID_PIN') {
      lockSession('Session expired. Enter the event PIN again.');
    } else {
      showStatus('error', 'Could not confirm the handover. Search the employee again before retrying.');
    }
  } finally {
    uniqueCodes.forEach(code => state.busyCodes.delete(code));
    renderResults();
  }
}

function openStatsSheet() {
  const remaining = Math.max(0, state.stats.total - state.stats.distributed);
  const pct = state.stats.total ? Math.round((state.stats.distributed / state.stats.total) * 100) : 0;
  openSheet('TODAY', 'Distribution status', `
    <div class="selection-list">
      <div class="selection-item"><strong>${state.stats.distributed}</strong><span>Orders distributed</span></div>
      <div class="selection-item"><strong>${remaining}</strong><span>Still available</span></div>
      <div class="selection-item"><strong>${pct}%</strong><span>Completed</span></div>
    </div>
    <button id="lockSessionButton" class="lock-button" type="button">Lock this device</button>
  `);
  document.getElementById('lockSessionButton').addEventListener('click', () => lockSession());
}

function updateStats(payload) {
  state.stats.distributed = Number(payload.distributed ?? state.stats.distributed ?? 0);
  state.stats.total = Number(payload.total ?? state.stats.total ?? 0);
  els.distributedCount.textContent = state.stats.distributed;
  els.totalCount.textContent = state.stats.total;
}

function lockSession(message = '') {
  state.pin = '';
  state.allEmployees = [];
  state.results = [];
  state.selected.clear();
  clearStoredPin();
  closeSheet();
  renderSelectionTray();
  els.results.innerHTML = '';
  showGate(message);
}

function openSheet(eyebrow, title, bodyHtml) {
  els.sheetEyebrow.textContent = eyebrow;
  els.sheetTitle.textContent = title;
  els.sheetBody.innerHTML = bodyHtml;
  els.sheet.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  els.sheet.classList.add('hidden');
  if (!document.body.classList.contains('locked')) document.body.style.overflow = '';
}

function showStatus(type, message) {
  els.statusArea.innerHTML = `<div class="status-banner ${type}">${escapeHtml(message)}</div>`;
}

function clearStatus() {
  els.statusArea.innerHTML = '';
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2300);
}

async function bootstrap() {
  bindEvents();
  renderSelectionTray();
  renderActiveFilters();
  document.body.classList.add('locked');

  const storedPin = getStoredPin();
  if (!storedPin) {
    showGate();
    return;
  }

  try {
    await loadRoster(storedPin);
    state.pin = storedPin;
    hideGate();
  } catch {
    clearStoredPin();
    showGate('Enter the event PIN to continue.');
  }
}

bootstrap();
