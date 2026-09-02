const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxB_aj2mWDx5p5W5fn9kWaKeK5fsQm9QRrR-mgfbD1io3TNS133o2XMAkR_pS_MQH4/exec',
  SEARCH_DELAY_MS: 180,
  MIN_QUERY_LENGTH: 2,
  MAX_RESULTS: 30,
};

const state = {
  query: '',
  filters: { brand: '', team: '', manager: '' },
  results: [],
  selected: new Map(),
  filterOptions: { brand: [], team: [], manager: [] },
  stats: { distributed: 0, total: 0 },
  searchTimer: null,
  busy: false,
};

const els = {
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

function isConfigured() {
  return /^https:\/\/script\.google\.com\/macros\/s\//.test(CONFIG.API_URL);
}

function jsonp(params) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      reject(new Error('Backend not connected yet. Deploy Code.gs and paste the /exec URL into app.js.'));
      return;
    }

    const callbackName = `__inventoryCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timeout = setTimeout(() => cleanup(new Error('Request timed out. Check the connection and try again.')), 12000);

    function cleanup(error, payload) {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
      if (error) reject(error); else resolve(payload);
    }

    window[callbackName] = payload => cleanup(null, payload);

    const url = new URL(CONFIG.API_URL);
    Object.entries({ ...params, callback: callbackName, _t: Date.now() }).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });

    script.onerror = () => cleanup(new Error('Could not reach the distribution backend.'));
    script.src = url.toString();
    document.body.appendChild(script);
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function debounceSearch() {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(runSearch, CONFIG.SEARCH_DELAY_MS);
}

function hasAnyFilter() {
  return Object.values(state.filters).some(Boolean);
}

async function bootstrap() {
  bindEvents();
  renderSelectionTray();

  if (!isConfigured()) {
    showStatus('info', 'Frontend is ready. Connect the Apps Script backend to load the employee list.');
    return;
  }

  try {
    const [meta, stats] = await Promise.all([
      jsonp({ action: 'meta' }),
      jsonp({ action: 'stats' }),
    ]);

    if (meta.ok) state.filterOptions = meta.filters || state.filterOptions;
    if (stats.ok) updateStats(stats);
  } catch (error) {
    showStatus('error', error.message);
  }
}

function bindEvents() {
  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value.trim();
    els.clearSearch.classList.toggle('hidden', !state.query);
    debounceSearch();
  });

  els.searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(state.searchTimer);
      runSearch();
    }
  });

  els.clearSearch.addEventListener('click', () => {
    els.searchInput.value = '';
    state.query = '';
    els.clearSearch.classList.add('hidden');
    els.searchInput.focus();
    runSearch();
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

async function runSearch() {
  if (!isConfigured()) return;

  if (state.query.length < CONFIG.MIN_QUERY_LENGTH && !hasAnyFilter()) {
    state.results = [];
    renderResults();
    clearStatus();
    return;
  }

  const requestId = `${state.query}|${JSON.stringify(state.filters)}`;
  state.lastSearchId = requestId;
  showStatus('info', 'Searching…');

  try {
    const payload = await jsonp({
      action: 'search',
      q: state.query,
      brand: state.filters.brand,
      team: state.filters.team,
      manager: state.filters.manager,
      limit: CONFIG.MAX_RESULTS,
    });

    if (state.lastSearchId !== requestId) return;
    if (!payload.ok) throw new Error(payload.message || 'Search failed.');

    state.results = payload.results || [];
    renderResults();

    if (!state.results.length) showStatus('error', 'No matching employee found. Try a name, ID, team or manager.');
    else clearStatus();
  } catch (error) {
    showStatus('error', error.message);
  }
}

function renderResults() {
  const shouldShowEmpty = !state.results.length && !state.query && !hasAnyFilter();
  els.emptyState.classList.toggle('hidden', !shouldShowEmpty);

  els.results.innerHTML = state.results.map(employee => {
    const selected = state.selected.has(employee.code);
    const collected = Boolean(employee.collected);
    const collectedText = employee.collectedAt
      ? `Already collected · ${escapeHtml(employee.collectedAt)}`
      : 'Already collected';

    return `
      <article class="employee-card ${selected ? 'selected' : ''} ${collected ? 'collected' : ''}" data-code="${escapeHtml(employee.code)}">
        <div>
          <div class="employee-name">${escapeHtml(employee.name)}</div>
          <div class="employee-code">${escapeHtml(employee.code)}</div>
          <div class="employee-meta">
            ${escapeHtml([employee.brand, employee.team].filter(Boolean).join(' · '))}
            ${employee.manager ? `<br>Manager: ${escapeHtml(employee.manager)}` : ''}
          </div>
          <div class="state-line ${collected ? 'collected' : 'available'}">
            ${collected ? collectedText : '● Available'}
          </div>
        </div>
        ${collected
          ? '<button class="card-action" type="button" disabled>Given</button>'
          : `<button class="card-action ${selected ? 'remove' : 'add'}" type="button" data-select="${escapeHtml(employee.code)}" aria-label="${selected ? 'Remove' : 'Add'} ${escapeHtml(employee.name)}">${selected ? '✓' : '+'}</button>`}
      </article>`;
  }).join('');

  els.results.querySelectorAll('[data-select]').forEach(button => {
    button.addEventListener('click', () => toggleEmployee(button.dataset.select));
  });
}

function toggleEmployee(code) {
  const employee = state.results.find(item => item.code === code) || state.selected.get(code);
  if (!employee || employee.collected) return;

  if (state.selected.has(code)) state.selected.delete(code);
  else state.selected.set(code, employee);

  renderResults();
  renderSelectionTray();
}

function renderSelectionTray() {
  const count = state.selected.size;
  els.selectionTray.classList.toggle('hidden', count === 0);
  els.selectedCount.textContent = count;
  els.giveSelectedButton.textContent = count === 1 ? 'Give order' : `Give ${count} orders`;
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
  const labels = { brand: 'Brand', team: 'Team', manager: 'Manager' };
  const options = state.filterOptions[type] || [];
  openSheet('FILTER', labels[type], options.length
    ? options.map(option => `
        <button class="sheet-option" type="button" data-filter-value="${escapeHtml(option)}">
          <span>${escapeHtml(option)}</span><span>›</span>
        </button>`).join('')
    : '<div class="status-banner info">No filter values loaded yet.</div>');

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
  const employees = [...state.selected.values()];
  if (!employees.length) return;

  const collectorOptions = employees.map((employee, index) =>
    `<option value="${escapeHtml(employee.code)}" ${index === 0 ? 'selected' : ''}>${escapeHtml(employee.name)} (${escapeHtml(employee.code)})</option>`
  ).join('');

  openSheet('REVIEW', employees.length === 1 ? 'Give 1 order' : `Give ${employees.length} orders`, `
    <div class="selection-list">
      ${employees.map(employee => `
        <div class="selection-item">
          <strong>${escapeHtml(employee.name)}</strong>
          <span>${escapeHtml(employee.code)} · ${escapeHtml(employee.brand || '')}${employee.team ? ` · ${escapeHtml(employee.team)}` : ''}</span>
        </div>`).join('')}
    </div>
    ${employees.length > 1 ? `
      <div class="collector-block">
        <strong>Who is collecting?</strong>
        <p>This is saved only for the audit trail if someone collects for colleagues.</p>
        <select id="collectorSelect" class="collector-select">${collectorOptions}</select>
      </div>` : ''}
    <button id="confirmGiveButton" class="confirm-button" type="button">${employees.length === 1 ? 'Confirm order given' : `Confirm ${employees.length} orders given`}</button>
  `);

  document.getElementById('confirmGiveButton').addEventListener('click', confirmGiveSelected);
}

async function confirmGiveSelected() {
  if (state.busy || !state.selected.size) return;
  state.busy = true;

  const button = document.getElementById('confirmGiveButton');
  if (button) {
    button.disabled = true;
    button.textContent = 'Saving…';
  }

  const employees = [...state.selected.values()];
  const collectorSelect = document.getElementById('collectorSelect');
  const collectorCode = collectorSelect?.value || employees[0].code;

  try {
    const payload = await jsonp({
      action: 'give',
      codes: employees.map(item => item.code).join(','),
      collectorCode,
    });

    if (!payload.ok) throw new Error(payload.message || 'Could not save the order.');

    const given = payload.given || [];
    const already = payload.already || [];

    state.selected.clear();
    renderSelectionTray();
    closeSheet();
    els.searchInput.value = '';
    state.query = '';
    els.clearSearch.classList.add('hidden');
    state.results = [];
    renderResults();

    if (payload.stats) updateStats(payload.stats);

    if (already.length) {
      showToast(`${given.length} given · ${already.length} already collected`);
    } else {
      showToast(given.length === 1 ? 'Order marked as given ✓' : `${given.length} orders marked as given ✓`);
    }

    setTimeout(() => els.searchInput.focus(), 80);
  } catch (error) {
    showStatus('error', error.message);
  } finally {
    state.busy = false;
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
    </div>`);
}

function updateStats(payload) {
  state.stats.distributed = Number(payload.distributed || payload.stats?.distributed || 0);
  state.stats.total = Number(payload.total || payload.stats?.total || 0);
  els.distributedCount.textContent = state.stats.distributed;
  els.totalCount.textContent = state.stats.total;
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
  document.body.style.overflow = '';
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
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

bootstrap();
