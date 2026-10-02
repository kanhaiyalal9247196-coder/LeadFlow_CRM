/* LeadFlow CRM - Utilities */
const Utils = (() => {
  const APP_VERSION = '1.0.0';
  const SCHEMA_VERSION = '1.0.0';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatCurrency(amount) {
    const num = Number(amount) || 0;
    const abs = Math.abs(num);
    const formatted = abs.toLocaleString('en-IN', {
      maximumFractionDigits: 2,
      minimumFractionDigits: num % 1 === 0 ? 0 : 2
    });
    return (num < 0 ? '-₹' : '₹') + formatted;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function formatTime(timeStr) {
    if (!timeStr) return '—';
    return timeStr;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function now() {
    return new Date().toISOString();
  }

  function uid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 11);
  }

  function generateSalt(length = 32) {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashPassword(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(salt + password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(base64) {
    const parts = base64.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
    const bstr = atob(parts[1]);
    const n = bstr.length;
    const u8 = new Uint8Array(n);
    for (let i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function downloadText(text, filename, mime = 'application/json') {
    const blob = new Blob([text], { type: mime });
    downloadBlob(blob, filename);
  }

  function csvEscape(val) {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function arrayToCsv(rows, headers) {
    const lines = [];
    if (headers) lines.push(headers.map(csvEscape).join(','));
    rows.forEach(row => {
      lines.push(row.map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  function parseCsv(text) {
    const lines = [];
    let current = '';
    let inQuotes = false;
    const rows = [];
    let row = [];

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(current);
          current = '';
        } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
          row.push(current);
          current = '';
          if (row.length > 1 || row[0] !== '') rows.push(row);
          row = [];
          if (ch === '\r') i++;
        } else if (ch !== '\r') {
          current += ch;
        }
      }
    }
    if (current || row.length) {
      row.push(current);
      rows.push(row);
    }
    return rows;
  }

  function getInitials(name) {
    if (!name) return '?';
    return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function statusBadgeClass(status) {
    const map = {
      'New': 'badge-new',
      'Open': 'badge-open',
      'In Progress': 'badge-in-progress',
      'On Hold': 'badge-on-hold',
      'Won': 'badge-won',
      'Lost': 'badge-lost',
      'Pending': 'badge-pending',
      'Partially Paid': 'badge-partially-paid',
      'Paid': 'badge-paid',
      'Due': 'badge-due',
      'Overdue': 'badge-overdue',
      'Not Applicable': 'badge-not-applicable',
      'Completed': 'badge-completed',
      'Active': 'badge-active',
      'Inactive': 'badge-inactive',
      'Admin': 'badge-admin',
      'Manager': 'badge-manager',
      'Executive': 'badge-executive'
    };
    return map[status] || 'badge-not-applicable';
  }

  function badge(status, text) {
    const t = text || status;
    return `<span class="badge ${statusBadgeClass(status)}">${escapeHtml(t)}</span>`;
  }

  function validateEmail(email) {
    if (!email) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validateMobile(mobile) {
    if (!mobile) return false;
    return /^[6-9]\d{9}$/.test(String(mobile).replace(/\s+/g, ''));
  }

  function sanitizeMobile(mobile) {
    return String(mobile || '').replace(/\D/g, '').slice(0, 15);
  }

  function relativeTime(dateStr) {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    return formatDate(dateStr);
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'zip'];
  const ALLOWED_MIMES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'application/zip',
    'application/x-zip-compressed'
  ];

  function isAllowedFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) return { ok: false, error: 'File type not allowed. Allowed: ' + ALLOWED_EXTENSIONS.join(', ').toUpperCase() };
    return { ok: true, ext };
  }

  function getPaymentTrackingValue(lead) {
    if (lead.totalDealValue != null && lead.totalDealValue !== '' && Number(lead.totalDealValue) > 0) {
      return Number(lead.totalDealValue);
    }
    if (lead.dealCloseAmount != null && lead.dealCloseAmount !== '' && Number(lead.dealCloseAmount) > 0) {
      return Number(lead.dealCloseAmount);
    }
    return 0;
  }

  function normalizeWhatsappNumber(mobile) {
    let digits = String(mobile || '').replace(/\D/g, '');
    if (!digits) return '';
    // Indian 10-digit mobile starting 6-9 → add country code 91
    if (digits.length === 10 && /^[6-9]/.test(digits)) digits = '91' + digits;
    // Strip a leading 00 international prefix
    if (digits.startsWith('00')) digits = digits.slice(2);
    return digits;
  }

  function whatsappLink(mobile, message) {
    const digits = normalizeWhatsappNumber(mobile);
    if (!digits) return '';
    return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message);
  }

  function openWhatsapp(mobile, message) {
    const link = whatsappLink(mobile, message);
    if (!link) return false;
    window.open(link, '_blank', 'noopener');
    return true;
  }

  async function paymentReminderMessage(lead, fin) {
    const company = await DB.getSetting('companyName', 'LeadFlow CRM');
    const name = (lead.customerName || 'Customer').split(' ')[0];
    const lines = [
      `Dear ${name},`,
      ``,
      `This is a gentle payment reminder from ${company} regarding your enquiry ${lead.enquiryNo}.`,
      `Pending Amount: ${formatCurrency(fin.pendingAmount)}`,
      lead.nextPaymentDueDate ? `Due Date: ${formatDate(lead.nextPaymentDueDate)}` : '',
      fin.totalReceived > 0 ? `Already Received: ${formatCurrency(fin.totalReceived)}` : '',
      ``,
      `Kindly arrange the payment at your earliest convenience.`,
      `For any queries please contact us.`,
      ``,
      `Thank you,`,
      `${company}`
    ].filter(l => l !== null && l !== undefined);
    return lines.join('\n');
  }

  function followupReminderMessage(lead, followup) {
    const lines = [
      `Dear ${(lead.customerName || 'Customer').split(' ')[0]},`,
      ``,
      `This is a reminder from our team regarding your enquiry ${lead.enquiryNo}.`,
      `Scheduled follow-up: ${formatDate(followup.date)}${followup.time ? ' at ' + followup.time : ''}`,
      followup.notes ? `Details: ${followup.notes}` : '',
      ``,
      `Please let us know a convenient time. Thank you!`
    ].filter(l => l !== null && l !== undefined && l !== '');
    return lines.join('\n');
  }

  function calcPaymentStatus(lead, totalReceived) {
    const tracking = getPaymentTrackingValue(lead);
    const received = Number(totalReceived) || 0;
    const pending = Math.max(0, tracking - received);
    const todayStr = today();

    if (tracking <= 0 && received <= 0) return 'Not Applicable';
    if (pending <= 0 && received > 0) return 'Paid';
    if (received > 0 && pending > 0) {
      if (lead.nextPaymentDueDate) {
        if (lead.nextPaymentDueDate < todayStr) return 'Overdue';
        if (lead.nextPaymentDueDate === todayStr) return 'Due';
      }
      return 'Partially Paid';
    }
    if (pending > 0 && received === 0) {
      if (lead.nextPaymentDueDate) {
        if (lead.nextPaymentDueDate < todayStr) return 'Overdue';
        if (lead.nextPaymentDueDate === todayStr) return 'Due';
      }
      return 'Pending';
    }
    return 'Not Applicable';
  }

  return {
    APP_VERSION, SCHEMA_VERSION,
    escapeHtml, formatCurrency, formatDate, formatDateTime, formatTime,
    today, now, uid, generateSalt, hashPassword, debounce,
    formatFileSize, blobToBase64, base64ToBlob, downloadBlob, downloadText,
    arrayToCsv, parseCsv, getInitials, statusBadgeClass, badge,
    validateEmail, validateMobile, sanitizeMobile, relativeTime, deepClone,
    ALLOWED_EXTENSIONS, ALLOWED_MIMES, isAllowedFile,
    getPaymentTrackingValue, calcPaymentStatus,
    normalizeWhatsappNumber, whatsappLink, openWhatsapp,
    paymentReminderMessage, followupReminderMessage
  };
})();