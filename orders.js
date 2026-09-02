let ordersCache = [];

const ordersGivenButton = document.createElement('button');
ordersGivenButton.id = 'ordersGivenButton';
ordersGivenButton.className = 'orders-given-button';
ordersGivenButton.type = 'button';
ordersGivenButton.innerHTML = `
  <span class="orders-given-icon">✓</span>
  <span class="orders-given-copy">
    <strong>Orders given</strong>
    <small>View or undo a completed handover</small>
  </span>
  <span id="ordersGivenCount" class="orders-given-count">${state.stats.distributed || 0}</span>
  <span class="orders-given-chevron">›</span>
`;

document.getElementById('modeHint').insertAdjacentElement('afterend', ordersGivenButton);

const ordersGivenCount = document.getElementById('ordersGivenCount');
const distributedObserver = new MutationObserver(() => {
  ordersGivenCount.textContent = String(state.stats.distributed || 0);
});
distributedObserver.observe(els.distributedCount, { childList: true, characterData: true, subtree: true });

function orderSearchText(order) {
  return normalize([
    order.code,
    order.name,
    order.brand,
    order.team,
    order.collectedByCode,
    order.collectedByName,
  ].filter(Boolean).join(' '));
}

function renderOrdersView(orders = ordersCache, query = '') {
  ordersCache = orders;
  const needle = normalize(query);
  const filtered = needle
    ? orders.filter(order => orderSearchText(order).includes(needle))
    : orders;

  els.sheetEyebrow.textContent = 'ORDERS GIVEN';
  els.sheetTitle.textContent = `${orders.length} ${orders.length === 1 ? 'order' : 'orders'} given`;
  els.sheetBody.innerHTML = `
    <div class="orders-toolbar">
      <label class="orders-search" for="ordersSearchInput">
        <span>⌕</span>
        <input id="ordersSearchInput" autocomplete="off" spellcheck="false" placeholder="Search name, ID or collector" value="${escapeHtml(query)}" />
      </label>
    </div>
    <div id="ordersGivenList" class="orders-given-list">
      ${filtered.length ? filtered.map(order => {
        const time = formatTime(order.collectedAt);
        const proxy = order.collectedByCode && order.collectedByCode !== order.code;
        return `
          <article class="given-order-row">
            <div class="given-order-main">
              <strong>${escapeHtml(order.name)}</strong>
              <span>${escapeHtml(order.code)}${order.brand ? ` · ${escapeHtml(order.brand)}` : ''}${order.team ? ` · ${escapeHtml(order.team)}` : ''}</span>
              <small>${proxy ? `Collected by ${escapeHtml(order.collectedByName || order.collectedByCode)}` : 'Collected'}${time ? ` · ${escapeHtml(time)}` : ''}</small>
            </div>
            <button class="undo-order-button" type="button" data-undo-code="${escapeHtml(order.code)}">Undo</button>
          </article>`;
      }).join('') : `
        <div class="orders-empty">
          <strong>${orders.length ? 'No matching order' : 'No orders given yet'}</strong>
          <span>${orders.length ? 'Try another name, ID or collector.' : 'Completed handovers will appear here.'}</span>
        </div>`}
    </div>
  `;

  const input = document.getElementById('ordersSearchInput');
  input?.addEventListener('input', () => renderOrdersView(ordersCache, input.value));

  els.sheetBody.querySelectorAll('[data-undo-code]').forEach(button => {
    button.addEventListener('click', () => {
      const order = ordersCache.find(item => item.code === button.dataset.undoCode);
      if (order) openUndoConfirmation(order);
    });
  });

  if (query) {
    requestAnimationFrame(() => {
      const refreshed = document.getElementById('ordersSearchInput');
      refreshed?.focus();
      refreshed?.setSelectionRange(refreshed.value.length, refreshed.value.length);
    });
  }
}

async function openOrdersGiven() {
  openSheet('ORDERS GIVEN', 'Orders given', '<div class="status-banner info">Loading orders…</div>');

  try {
    const payload = await apiRequest('orders');
    ordersCache = payload.orders || [];
    updateStats(payload.stats || {});
    renderOrdersView(ordersCache);
  } catch (error) {
    if (error.code === 'INVALID_PIN') {
      lockSession('Session expired. Enter the event PIN again.');
      return;
    }
    els.sheetBody.innerHTML = '<div class="status-banner error">Could not load orders right now.</div>';
  }
}

function openUndoConfirmation(order) {
  els.sheetEyebrow.textContent = 'UNDO ORDER';
  els.sheetTitle.textContent = order.name;
  els.sheetBody.innerHTML = `
    <div class="undo-confirm-card">
      <div class="undo-confirm-icon">↶</div>
      <strong>Make this order available again?</strong>
      <p>${escapeHtml(order.name)} (${escapeHtml(order.code)}) will return to Available and can be collected again.</p>
      <div class="undo-confirm-meta">
        <span>Originally collected by</span>
        <strong>${escapeHtml(order.collectedByName || order.collectedByCode || order.name)}</strong>
      </div>
    </div>
    <div class="undo-confirm-actions">
      <button id="undoBackButton" class="undo-back-button" type="button">Back</button>
      <button id="confirmUndoOrderButton" class="confirm-undo-button" type="button">Undo order</button>
    </div>
  `;

  document.getElementById('undoBackButton').addEventListener('click', () => renderOrdersView(ordersCache));
  document.getElementById('confirmUndoOrderButton').addEventListener('click', () => undoOrder(order));
}

async function undoOrder(order) {
  const button = document.getElementById('confirmUndoOrderButton');
  if (!button) return;
  button.disabled = true;
  button.textContent = 'Undoing…';

  try {
    const payload = await apiRequest('undo', {
      employeeCode: order.code,
      deviceId: getDeviceId(),
    });

    if (!payload.undone) {
      showToast('Order was already removed');
    } else {
      const employee = state.allEmployees.find(item => item.code === order.code);
      if (employee) {
        employee.collected = false;
        employee.collectedAt = null;
        employee.collectedByCode = null;
        employee.collectedByName = null;
      }
      updateStats(payload.stats || {});
      runSearch();
      showToast(`${order.name} is available again`);
    }

    const refreshed = await apiRequest('orders');
    ordersCache = refreshed.orders || [];
    updateStats(refreshed.stats || {});
    renderOrdersView(ordersCache);
  } catch (error) {
    if (error.code === 'INVALID_PIN') {
      lockSession('Session expired. Enter the event PIN again.');
      return;
    }
    button.disabled = false;
    button.textContent = 'Undo order';
    showToast('Could not undo the order');
  }
}

ordersGivenButton.addEventListener('click', openOrdersGiven);
