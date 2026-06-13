const API_URL = 'http://localhost:3002/api/drafts';
const LOGS_URL = 'http://localhost:3002/api/logs';
const LEDGERS_URL = 'http://localhost:3002/api/ledgers';

let activeTab = 'drafts';
let draftsInterval = null;
let ledgersList = [];
let selectedDraftIds = new Set();

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Tabs
  const navDrafts = document.getElementById('navDrafts');
  const navLogs = document.getElementById('navLogs');
  const draftsSection = document.getElementById('draftsSection');
  const logsSection = document.getElementById('logsSection');

  navDrafts.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('drafts');
  });

  navLogs.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('logs');
  });

  // Logs filters and buttons
  document.getElementById('btnRefreshLogs').addEventListener('click', fetchLogs);
  document.getElementById('filterToolName').addEventListener('input', debounce(fetchLogs, 500));
  document.getElementById('filterRequestId').addEventListener('input', debounce(fetchLogs, 500));
  document.getElementById('filterStatus').addEventListener('change', fetchLogs);

  // Bulk actions setup
  document.getElementById('selectAllCheckbox').addEventListener('change', toggleSelectAll);
  document.getElementById('btnBulkApprove').addEventListener('click', handleBulkApprove);
  document.getElementById('btnBulkCancel').addEventListener('click', handleBulkCancel);

  // Modal setup
  const modal = document.getElementById('detailsModal');
  const closeSpan = document.querySelector('.close-modal');
  closeSpan.onclick = () => modal.classList.add('hidden');
  window.onclick = (event) => {
    if (event.target === modal) {
      modal.classList.add('hidden');
    }
  };

  // Load ledgers list and initial tab
  fetchLedgers().then(() => {
    switchTab('drafts');
  });
});

async function fetchLedgers() {
  try {
    const response = await fetch(LEDGERS_URL);
    ledgersList = await response.json();
    const datalist = document.getElementById('ledgersDatalist');
    if (datalist) {
      datalist.innerHTML = '';
      ledgersList.forEach(ledger => {
        const option = document.createElement('option');
        option.value = ledger;
        datalist.appendChild(option);
      });
      console.log(`Loaded ${ledgersList.length} ledgers from Tally.`);
    }
  } catch (err) {
    console.error('Failed to fetch ledgers from Tally:', err);
  }
}

function switchTab(tab) {
  activeTab = tab;
  
  const navDrafts = document.getElementById('navDrafts');
  const navLogs = document.getElementById('navLogs');
  const draftsSection = document.getElementById('draftsSection');
  const logsSection = document.getElementById('logsSection');

  if (tab === 'drafts') {
    navDrafts.classList.add('active');
    navLogs.classList.remove('active');
    draftsSection.classList.remove('hidden');
    logsSection.classList.add('hidden');
    
    selectedDraftIds.clear();
    updateBulkActionsBar();
    const selectAllCb = document.getElementById('selectAllCheckbox');
    if (selectAllCb) selectAllCb.checked = false;
    
    fetchDrafts();
    // Poll drafts every 10 seconds
    if (!draftsInterval) {
      draftsInterval = setInterval(fetchDrafts, 10000);
    }
  } else {
    navDrafts.classList.remove('active');
    navLogs.classList.add('active');
    draftsSection.classList.add('hidden');
    logsSection.classList.remove('hidden');
    
    // Clear drafts polling when not on drafts tab
    if (draftsInterval) {
      clearInterval(draftsInterval);
      draftsInterval = null;
    }
    fetchLogs();
  }
}

async function fetchDrafts() {
  const tbody = document.getElementById('draftsBody');
  if (!tbody) return;
  
  try {
    const response = await fetch(API_URL);
    const drafts = await response.json();
    
    updateStats(drafts);
    
    if (drafts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="12" class="empty-state">No pending drafts to review. Speak to the Telegram Bot!</td></tr>';
      return;
    }
    
    // Preserve focus if user is currently editing
    const activeEl = document.activeElement;
    let focusedDraftId = null;
    let focusedField = null;
    
    if (activeEl && activeEl.dataset && activeEl.dataset.id) {
      focusedDraftId = activeEl.dataset.id;
      focusedField = activeEl.dataset.field;
    }
    
    tbody.innerHTML = '';
    
    drafts.forEach(draft => {
      const tr = document.createElement('tr');
      tr.id = `draft-${draft.id}`;
      
      const isChecked = selectedDraftIds.has(draft.id);
      
      // Date formatting for input value (YYYYMMDD to YYYY-MM-DD)
      let inputDateVal = '';
      if (draft.date && draft.date.length === 8) {
        inputDateVal = `${draft.date.substring(0,4)}-${draft.date.substring(4,6)}-${draft.date.substring(6,8)}`;
      }
      
      const logText = draft.tally_response 
        ? `<div style="max-height:80px; overflow-y:auto; font-size:0.75rem; color:var(--danger)">${draft.tally_response.replace(/</g, '&lt;')}</div>` 
        : '-';
        
      tr.innerHTML = `
        <td class="checkbox-cell">
          <input type="checkbox" class="draft-select-checkbox" data-id="${draft.id}" ${isChecked ? 'checked' : ''}>
        </td>
        <td class="td-date">
          <input type="date" value="${inputDateVal}" data-id="${draft.id}" data-field="date" class="table-input">
        </td>
        <td>
          <select data-id="${draft.id}" data-field="voucher_type" class="table-input">
            <option value="Receipt" ${draft.voucher_type === 'Receipt' ? 'selected' : ''}>Receipt</option>
            <option value="Receipt Book" ${draft.voucher_type === 'Receipt Book' ? 'selected' : ''}>Receipt Book</option>
            <option value="Payment" ${draft.voucher_type === 'Payment' ? 'selected' : ''}>Payment</option>
            <option value="Sales" ${draft.voucher_type === 'Sales' ? 'selected' : ''}>Sales</option>
          </select>
        </td>
        <td>
          <input type="text" value="${draft.voucher_number || ''}" data-id="${draft.id}" data-field="voucher_number" class="table-input" placeholder="No...">
        </td>
        <td>
          <input type="text" value="${draft.credit_ledger}" list="ledgersDatalist" data-id="${draft.id}" data-field="credit_ledger" class="table-input" placeholder="Search customer...">
        </td>
        <td>
          <input type="text" value="${draft.debit_ledger}" list="ledgersDatalist" data-id="${draft.id}" data-field="debit_ledger" class="table-input" placeholder="Search cash/bank...">
        </td>
        <td>
          <input type="number" step="0.01" value="${draft.amount}" data-id="${draft.id}" data-field="amount" class="table-input amount-input">
        </td>
        <td>
          <input type="number" step="0.01" value="${draft.discount_amount || 0}" data-id="${draft.id}" data-field="discount_amount" class="table-input amount-input">
        </td>
        <td>
          <input type="text" value="${draft.discount_ledger || ''}" list="ledgersDatalist" data-id="${draft.id}" data-field="discount_ledger" class="table-input" placeholder="Search discount...">
        </td>
        <td>
          <input type="text" value="${draft.narration || ''}" data-id="${draft.id}" data-field="narration" class="table-input" placeholder="Narration...">
        </td>
        <td>${logText}</td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-approve" style="padding: 6px 12px;" onclick="approveDraft(${draft.id})">Post</button>
            <button class="btn btn-cancel" style="padding: 6px 12px;" onclick="cancelDraft(${draft.id})">Discard</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    
    // Restore focus if element still exists
    if (focusedDraftId && focusedField) {
      const input = tbody.querySelector(`[data-id="${focusedDraftId}"][data-field="${focusedField}"]`);
      if (input) {
        input.focus();
        if (input.type === 'text') {
          const val = input.value;
          input.value = '';
          input.value = val;
        }
      }
    }
    
    // Bind listeners to all editable inputs for auto-saving
    tbody.querySelectorAll('.table-input').forEach(input => {
      input.addEventListener('change', handleInlineEdit);
    });

    tbody.querySelectorAll('.draft-select-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', handleSelectRow);
    });
    
  } catch (err) {
    console.error('Failed to fetch drafts', err);
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">Failed to connect to Bot API. Ensure the bot is running.</td></tr>';
  }
}

async function handleInlineEdit(e) {
  const input = e.target;
  const id = input.dataset.id;
  const field = input.dataset.field;
  
  // Find current values in row to send complete draft state
  const row = document.getElementById(`draft-${id}`);
  if (!row) return;
  
  const voucher_type = row.querySelector('[data-field="voucher_type"]').value;
  
  // Convert YYYY-MM-DD date input back to YYYYMMDD
  const rawDateVal = row.querySelector('[data-field="date"]').value;
  const date = rawDateVal ? rawDateVal.replace(/-/g, '') : '';
  
  const credit_ledger = row.querySelector('[data-field="credit_ledger"]').value;
  const debit_ledger = row.querySelector('[data-field="debit_ledger"]').value;
  const amount = parseFloat(row.querySelector('[data-field="amount"]').value) || 0;
  const discount_amount = parseFloat(row.querySelector('[data-field="discount_amount"]').value) || 0;
  const discount_ledger = row.querySelector('[data-field="discount_ledger"]').value;
  const narration = row.querySelector('[data-field="narration"]').value;
  const voucher_number = row.querySelector('[data-field="voucher_number"]').value;
  
  const payload = {
    voucher_type,
    date,
    credit_ledger,
    debit_ledger,
    amount,
    narration,
    discount_ledger,
    discount_amount,
    voucher_number
  };
  
  try {
    const response = await fetch(`http://localhost:3002/api/drafts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      // Flash the cell green as visual feedback for successful auto-save
      const cell = input.parentElement;
      cell.classList.add('saved-flash');
      setTimeout(() => cell.classList.remove('saved-flash'), 800);
      
      // Update statistics in real-time
      const pendingResponse = await fetch(API_URL);
      const drafts = await pendingResponse.json();
      updateStats(drafts);
    } else {
      showToast('Auto-save failed.', 'error');
    }
  } catch (err) {
    showToast('Network error on save.', 'error');
  }
}

function updateStats(drafts) {
  const pendingCount = drafts.length;
  const totalVal = drafts.reduce((sum, d) => sum + d.amount + (d.discount_amount || 0), 0);
  
  const countEl = document.getElementById('statPendingCount');
  const amountEl = document.getElementById('statTotalAmount');
  const statusEl = document.getElementById('statTallyStatus');
  
  if (countEl) countEl.innerText = pendingCount;
  if (amountEl) amountEl.innerText = `₹ ${totalVal.toLocaleString('en-IN')}`;
}

function handleSelectRow(e) {
  const checkbox = e.target;
  const id = parseInt(checkbox.dataset.id);
  
  if (checkbox.checked) {
    selectedDraftIds.add(id);
  } else {
    selectedDraftIds.delete(id);
  }
  
  updateBulkActionsBar();
}

function toggleSelectAll(e) {
  const selectAll = e.target;
  const checkboxes = document.querySelectorAll('.draft-select-checkbox');
  
  checkboxes.forEach(cb => {
    cb.checked = selectAll.checked;
    const id = parseInt(cb.dataset.id);
    if (selectAll.checked) {
      selectedDraftIds.add(id);
    } else {
      selectedDraftIds.delete(id);
    }
  });
  
  updateBulkActionsBar();
}

function updateBulkActionsBar() {
  const bar = document.getElementById('bulkActionsBar');
  const countText = document.getElementById('bulkCountText');
  if (!bar || !countText) return;

  const size = selectedDraftIds.size;
  if (size > 0) {
    countText.innerText = `${size} draft${size > 1 ? 's' : ''} selected`;
    bar.classList.remove('hidden');
    bar.style.opacity = '1';
    bar.style.transform = 'translateY(0)';
  } else {
    bar.style.opacity = '0';
    bar.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      if (selectedDraftIds.size === 0) bar.classList.add('hidden');
    }, 300);
  }
}

async function handleBulkApprove() {
  if (selectedDraftIds.size === 0) return;
  
  const ids = Array.from(selectedDraftIds);
  const btn = document.getElementById('btnBulkApprove');
  const originalText = btn.innerText;
  
  btn.innerText = 'Posting...';
  btn.disabled = true;
  
  try {
    const response = await fetch('http://localhost:3002/api/drafts/bulk-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const result = await response.json();
    
    if (response.ok) {
      const successes = result.results.filter(r => r.success).length;
      const failures = result.results.filter(r => !r.success).length;
      
      if (failures === 0) {
        showToast(`Successfully posted all ${successes} vouchers to Tally!`, 'success');
      } else {
        showToast(`Posted ${successes} vouchers. ${failures} failed.`, 'error');
      }
      
      // Animate out completed rows
      result.results.forEach(res => {
        if (res.success) {
          const row = document.getElementById(`draft-${res.id}`);
          if (row) {
            row.classList.add('row-fade-out');
            setTimeout(() => row.remove(), 400);
          }
          selectedDraftIds.delete(res.id);
        }
      });
      
      // Refresh list to show logs for failures
      setTimeout(fetchDrafts, 500);
    } else {
      showToast(result.error || 'Failed to post bulk items.', 'error');
    }
  } catch (err) {
    showToast('Network error on bulk approve.', 'error');
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
    updateBulkActionsBar();
  }
}

async function handleBulkCancel() {
  if (selectedDraftIds.size === 0) return;
  if (!confirm(`Discard all ${selectedDraftIds.size} selected drafts?`)) return;
  
  const ids = Array.from(selectedDraftIds);
  const btn = document.getElementById('btnBulkCancel');
  const originalText = btn.innerText;
  
  btn.innerText = 'Discarding...';
  btn.disabled = true;
  
  try {
    const response = await fetch('http://localhost:3002/api/drafts/bulk-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    
    if (response.ok) {
      showToast(`Discarded ${ids.length} drafts.`, 'success');
      ids.forEach(id => {
        const row = document.getElementById(`draft-${id}`);
        if (row) {
          row.classList.add('row-fade-out');
          setTimeout(() => row.remove(), 400);
        }
      });
      selectedDraftIds.clear();
      const selectAllCb = document.getElementById('selectAllCheckbox');
      if (selectAllCb) selectAllCb.checked = false;
      setTimeout(fetchDrafts, 500);
    } else {
      showToast('Failed to discard drafts.', 'error');
    }
  } catch (err) {
    showToast('Network error on bulk cancel.', 'error');
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
    updateBulkActionsBar();
  }
}

async function fetchLogs() {
  const tbody = document.getElementById('logsBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading logs...</td></tr>';
  
  const toolName = document.getElementById('filterToolName').value.trim();
  const requestId = document.getElementById('filterRequestId').value.trim();
  const status = document.getElementById('filterStatus').value;
  
  try {
    const url = new URL(LOGS_URL);
    if (toolName) url.searchParams.append('toolName', toolName);
    if (requestId) url.searchParams.append('requestId', requestId);
    if (status) url.searchParams.append('status', status);
    
    const response = await fetch(url);
    const logs = await response.json();
    
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No matching tool execution logs found.</td></tr>';
      return;
    }
    
    tbody.innerHTML = '';
    
    logs.forEach(log => {
      const tr = document.createElement('tr');
      
      const date = new Date(log.created_at + 'Z'); // SQLite timestamp in UTC
      const localTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + 
                        ' ' + date.toLocaleDateString();
      
      const statusClass = log.status === 'success' ? 'badge-success' : 'badge-error';
      const statusText = log.status ? log.status.toUpperCase() : 'UNKNOWN';
      const duration = log.duration_ms ? `${log.duration_ms} ms` : '-';
      
      tr.innerHTML = `
        <td>${localTime}</td>
        <td><strong>${log.tool_name}</strong><br><small style="color:var(--text-muted)">Req: ${log.request_id}</small></td>
        <td><span class="badge ${statusClass}">${statusText}</span></td>
        <td style="font-family:monospace">${duration}</td>
        <td>
          <button class="btn btn-cancel" onclick="viewLogDetails(${JSON.stringify(log.id)})">View Details</button>
        </td>
      `;
      // Store full log data on row element for reference
      tr.dataset.log = JSON.stringify(log);
      tr.id = `log-row-${log.id}`;
      tbody.appendChild(tr);
    });
    
  } catch (err) {
    console.error('Failed to fetch logs', err);
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Failed to fetch tool logs.</td></tr>';
  }
}

window.viewLogDetails = function(logId) {
  const row = document.getElementById(`log-row-${logId}`);
  if (!row) return;
  
  const log = JSON.parse(row.dataset.log);
  const modal = document.getElementById('detailsModal');
  if (!modal) return;
  
  document.getElementById('modalTitle').innerText = `Tool Details: ${log.tool_name}`;
  
  let formattedArgs = '';
  try {
    const parsedArgs = JSON.parse(log.tool_args);
    formattedArgs = JSON.stringify(parsedArgs, null, 2);
  } catch (e) {
    formattedArgs = log.tool_args || 'None';
  }
  
  let formattedResult = '';
  try {
    const parsedResult = JSON.parse(log.tool_result);
    formattedResult = JSON.stringify(parsedResult, null, 2);
  } catch (e) {
    formattedResult = log.tool_result || log.error_message || 'None';
  }
  
  document.getElementById('modalArgs').innerText = formattedArgs;
  document.getElementById('modalResult').innerText = formattedResult;
  
  modal.classList.remove('hidden');
};

window.approveDraft = async function(id) {
  const btn = document.querySelector(`#draft-${id} .btn-approve`);
  const originalText = btn.innerText;
  btn.innerText = 'Post...';
  btn.disabled = true;
  
  try {
    const response = await fetch(`${API_URL}/${id}/approve`, { method: 'POST' });
    const result = await response.json();
    
    if (response.ok) {
      showToast('Voucher successfully posted to Tally!', 'success');
      const row = document.getElementById(`draft-${id}`);
      if (row) {
        row.classList.add('row-fade-out');
        setTimeout(() => {
          row.remove();
          selectedDraftIds.delete(id);
          updateBulkActionsBar();
          fetchDrafts();
        }, 400);
      }
    } else {
      showToast(result.error || 'Failed to post to Tally', 'error');
      btn.innerText = originalText;
      btn.disabled = false;
      fetchDrafts();
    }
  } catch (err) {
    showToast('Network error while posting.', 'error');
    btn.innerText = originalText;
    btn.disabled = false;
  }
};

window.cancelDraft = async function(id) {
  if (!confirm('Are you sure you want to discard this draft?')) return;
  
  try {
    const response = await fetch(`${API_URL}/${id}/cancel`, { method: 'POST' });
    if (response.ok) {
      showToast('Draft discarded.', 'success');
      const row = document.getElementById(`draft-${id}`);
      if (row) {
        row.classList.add('row-fade-out');
        setTimeout(() => {
          row.remove();
          selectedDraftIds.delete(id);
          updateBulkActionsBar();
          fetchDrafts();
        }, 400);
      }
    } else {
      showToast('Failed to cancel draft.', 'error');
    }
  } catch (err) {
    showToast('Network error while cancelling.', 'error');
  }
};

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = message;
  toast.className = `toast ${type} show`;
  
  setTimeout(() => {
    toast.className = 'toast hidden';
  }, 3000);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
