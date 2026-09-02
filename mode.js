state.collectionMode = 'single';

const modeEls = {
  single: document.getElementById('singleModeButton'),
  multiple: document.getElementById('multipleModeButton'),
  hint: document.getElementById('modeHint'),
  emptyText: document.getElementById('emptyStateText'),
};

const multipleCount = document.createElement('span');
multipleCount.id = 'multipleModeCount';
multipleCount.className = 'mode-count hidden';
multipleCount.textContent = '0';
modeEls.multiple.querySelector('strong').appendChild(multipleCount);

const originalToggleEmployee = toggleEmployee;
const originalOpenReviewSheet = openReviewSheet;
els.giveSelectedButton.removeEventListener('click', originalOpenReviewSheet);
els.selectionSummary.removeEventListener('click', originalOpenReviewSheet);

function updateModeUI() {
  const multiple = state.collectionMode === 'multiple';

  modeEls.single.classList.toggle('active', !multiple);
  modeEls.multiple.classList.toggle('active', multiple);
  modeEls.single.setAttribute('aria-pressed', String(!multiple));
  modeEls.multiple.setAttribute('aria-pressed', String(multiple));

  modeEls.hint.textContent = multiple
    ? 'Add each employee. Review anytime to remove someone before giving the orders.'
    : 'Find one employee and tap GIVE.';

  modeEls.emptyText.textContent = multiple
    ? 'Search the first employee to add to this multiple collection.'
    : 'Search by name, ID, brand, team, L1 or L2 manager.';

  els.searchInput.placeholder = multiple
    ? 'Search employee to add'
    : 'Name, ID, team or manager';

  updateMultipleCount();
  renderSelectionTray();
  renderResults();
}

function setCollectionMode(mode) {
  if (!['single', 'multiple'].includes(mode) || state.collectionMode === mode) return;
  state.collectionMode = mode;
  resetSearch();
  updateModeUI();
  setTimeout(() => els.searchInput.focus(), 50);
}

function updateMultipleCount() {
  const count = state.selected.size;
  multipleCount.textContent = String(count);
  multipleCount.classList.toggle('hidden', count === 0);
}

modeEls.single.addEventListener('click', () => setCollectionMode('single'));
modeEls.multiple.addEventListener('click', () => setCollectionMode('multiple'));

renderResults = function renderResultsByMode() {
  const shouldShowEmpty = !state.results.length && !state.query && !hasAnyFilter();
  els.emptyState.classList.toggle('hidden', !shouldShowEmpty);
  const multiple = state.collectionMode === 'multiple';

  els.results.innerHTML = state.results.map(employee => {
    const selected = state.selected.has(employee.code);
    const collected = Boolean(employee.collected);
    const busy = state.busyCodes.has(employee.code);
    const managerLines = [
      employee.manager ? `L1: ${escapeHtml(employee.manager)}` : '',
      employee.l2Manager ? `L2: ${escapeHtml(employee.l2Manager)}` : '',
    ].filter(Boolean).join('<br>');

    let actionHtml = '';
    if (collected) {
      actionHtml = '<button class="given-button" type="button" disabled>GIVEN</button>';
    } else if (multiple) {
      actionHtml = `<button class="batch-only ${selected ? 'selected' : ''}" type="button" data-select="${escapeHtml(employee.code)}" ${busy ? 'disabled' : ''}>${busy ? 'SAVING' : selected ? 'REMOVE' : 'ADD'}</button>`;
    } else {
      actionHtml = `<button class="quick-give" type="button" data-quick-give="${escapeHtml(employee.code)}" ${busy ? 'disabled' : ''}>${busy ? 'SAVING' : 'GIVE'}</button>`;
    }

    return `
      <article class="employee-card ${multiple && selected ? 'multiple-selected' : ''} ${collected ? 'collected' : ''}" data-code="${escapeHtml(employee.code)}">
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
        <div class="card-actions">${actionHtml}</div>
      </article>`;
  }).join('');

  els.results.querySelectorAll('[data-quick-give]').forEach(button => {
    button.addEventListener('click', () => quickGive(button.dataset.quickGive));
  });

  els.results.querySelectorAll('[data-select]').forEach(button => {
    button.addEventListener('click', () => toggleEmployee(button.dataset.select));
  });
};

toggleEmployee = function toggleEmployeeForMultiple(code) {
  if (state.collectionMode !== 'multiple') return;
  const wasSelected = state.selected.has(code);
  originalToggleEmployee(code);
  updateMultipleCount();

  if (!wasSelected && state.selected.has(code)) {
    resetSearch();
    showToast(`${state.selected.size} ${state.selected.size === 1 ? 'order' : 'orders'} selected`);
    setTimeout(() => els.searchInput.focus(), 50);
  } else if (wasSelected && !state.selected.has(code)) {
    showToast('Removed from multiple order');
    renderSelectionTray();
    renderResults();
  }
};

renderSelectionTray = function renderMultipleSelectionTray() {
  const count = state.selected.size;
  const show = state.collectionMode === 'multiple' && count > 0;
  els.selectionTray.classList.toggle('hidden', !show);
  els.selectedCount.textContent = count;
  els.giveSelectedButton.textContent = count === 1 ? 'Review & give 1' : `Review & give ${count}`;
  updateMultipleCount();
};

function renderMultipleReviewContents(preferredCollectorCode = '') {
  const employees = [...state.selected.values()].filter(employee => !employee.collected);

  if (!employees.length) {
    closeSheet();
    renderSelectionTray();
    showToast('No orders selected');
    return;
  }

  const collectorCode = employees.some(employee => employee.code === preferredCollectorCode)
    ? preferredCollectorCode
    : employees[0].code;

  els.sheetEyebrow.textContent = 'MULTIPLE ORDERS';
  els.sheetTitle.textContent = `${employees.length} ${employees.length === 1 ? 'order' : 'orders'} selected`;

  const collectorOptions = employees.map(employee =>
    `<option value="${escapeHtml(employee.code)}" ${employee.code === collectorCode ? 'selected' : ''}>${escapeHtml(employee.name)} (${escapeHtml(employee.code)})</option>`
  ).join('');

  els.sheetBody.innerHTML = `
    <div class="selection-list review-selection-list">
      ${employees.map(employee => `
        <div class="selection-item review-selection-item">
          <div class="review-person">
            <strong>${escapeHtml(employee.name)}</strong>
            <span>${escapeHtml(employee.code)} · ${escapeHtml(employee.brand || '')}${employee.team ? ` · ${escapeHtml(employee.team)}` : ''}</span>
          </div>
          <button class="review-remove" type="button" data-remove-selected="${escapeHtml(employee.code)}">Remove</button>
        </div>`).join('')}
    </div>
    <div class="collector-block">
      <strong>Who is collecting these orders?</strong>
      <p>This person will be recorded as the collector for every employee above.</p>
      <select id="collectorSelect" class="collector-select">${collectorOptions}</select>
    </div>
    <button id="confirmGiveButton" class="confirm-button" type="button">${employees.length === 1 ? 'Give 1 order' : `Give ${employees.length} orders`}</button>
  `;

  els.sheetBody.querySelectorAll('[data-remove-selected]').forEach(button => {
    button.addEventListener('click', () => {
      const currentCollector = document.getElementById('collectorSelect')?.value || '';
      const code = button.dataset.removeSelected;
      state.selected.delete(code);
      updateMultipleCount();
      renderSelectionTray();
      renderResults();
      showToast('Removed from multiple order');
      renderMultipleReviewContents(currentCollector === code ? '' : currentCollector);
    });
  });

  document.getElementById('confirmGiveButton').addEventListener('click', async () => {
    const currentEmployees = [...state.selected.values()].filter(employee => !employee.collected);
    if (!currentEmployees.length) return;
    const selectedCollector = document.getElementById('collectorSelect')?.value || currentEmployees[0].code;
    await submitGive(currentEmployees.map(employee => employee.code), selectedCollector, { quick: false });
  });
}

openReviewSheet = function openMultipleReviewSheet() {
  if (state.collectionMode !== 'multiple' || !state.selected.size) return;
  openSheet('MULTIPLE ORDERS', 'Review orders', '');
  renderMultipleReviewContents();
};

els.giveSelectedButton.addEventListener('click', openReviewSheet);
els.selectionSummary.addEventListener('click', openReviewSheet);

updateModeUI();
