/* LeadFlow CRM - Backup & Restore */
const Backup = (() => {
  async function exportJSON() {
    if (!Permissions.canBackup()) throw new Error('Permission denied: only Admin can backup.');

    const data = await DB.exportAll();

    // Convert blobs to base64
    if (data.attachments) {
      for (const att of data.attachments) {
        if (att.blob && att.blob instanceof Blob) {
          att.blobBase64 = await Utils.blobToBase64(att.blob);
          delete att.blob;
        }
      }
    }

    const backup = {
      app: 'LeadFlow CRM',
      appVersion: Utils.APP_VERSION,
      schemaVersion: Utils.SCHEMA_VERSION,
      backupDate: Utils.now(),
      recordCounts: {},
      data
    };

    Object.keys(data).forEach(k => {
      backup.recordCounts[k] = (data[k] || []).length;
    });

    await Audit.logCurrent('Updated', `JSON backup created — ${JSON.stringify(backup.recordCounts)}`);

    const filename = `leadflow-backup-${Utils.today()}.json`;
    const json = JSON.stringify(backup, null, 2);
    Utils.downloadText(json, filename, 'application/json');
    return backup;
  }

  async function importJSON(file, mode = 'replace') {
    if (!Permissions.canBackup()) throw new Error('Permission denied: only Admin can restore.');

    const text = await file.text();
    let backup;
    try {
      backup = JSON.parse(text);
    } catch {
      throw new Error('Invalid backup file: not valid JSON.');
    }

    if (!backup.app || backup.app !== 'LeadFlow CRM') {
      throw new Error('Invalid backup file: not a LeadFlow CRM backup.');
    }
    if (!backup.data || typeof backup.data !== 'object') {
      throw new Error('Invalid backup file: missing data.');
    }
    if (!backup.schemaVersion) {
      throw new Error('Invalid backup file: missing schema version.');
    }

    // Restore blobs from base64
    if (backup.data.attachments) {
      for (const att of backup.data.attachments) {
        if (att.blobBase64) {
          att.blob = Utils.base64ToBlob(att.blobBase64);
          delete att.blobBase64;
        }
      }
    }

    // Validate required structures
    const requiredStores = ['users', 'leads', 'payments', 'settings'];
    for (const s of requiredStores) {
      if (backup.data[s] && !Array.isArray(backup.data[s])) {
        throw new Error(`Invalid data structure for: ${s}`);
      }
    }

    if (mode === 'replace' && (!backup.data.users || backup.data.users.length === 0)) {
      throw new Error('Backup contains no users. Cannot replace with empty user list.');
    }

    await DB.importAll(backup.data, mode);

    await Audit.logCurrent('Updated', `Data restored (${mode}) from backup dated ${backup.backupDate || 'unknown'}`);

    return {
      mode,
      schemaVersion: backup.schemaVersion,
      backupDate: backup.backupDate,
      recordCounts: backup.recordCounts || {}
    };
  }

  async function exportCSV(entity) {
    if (!Permissions.canBackup() && !Permissions.canViewReports()) {
      throw new Error('Permission denied.');
    }

    let headers, rows;

    switch (entity) {
      case 'leads': {
        const leads = await Leads.getAll();
        headers = ['Enquiry No', 'Date', 'Customer', 'Mobile', 'Company', 'Email', 'City', 'State', 'Source', 'Type', 'Status', 'Offer Amount', 'Deal Close Amount', 'Total Deal Value', 'Assigned To', 'Created At'];
        const users = await DB.getAll('users');
        const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
        rows = leads.map(l => [
          l.enquiryNo, l.enquiryDate, l.customerName, l.mobile, l.companyName, l.email,
          l.city, l.state, l.source, l.enquiryType, l.status,
          l.offerAmount, l.dealCloseAmount, l.totalDealValue,
          userMap[l.assignedTo] || '', l.createdAt
        ]);
        break;
      }
      case 'payments': {
        const payments = await Payments.getAll();
        headers = ['Receipt No', 'Enquiry No', 'Customer', 'Amount', 'Date', 'Method', 'Reference', 'Received By', 'Notes'];
        rows = payments.map(p => [
          p.receiptNo, p.enquiryNo, p.customerName, p.amount, p.paymentDate,
          p.paymentMethod, p.referenceNumber, p.receivedBy, p.notes
        ]);
        break;
      }
      case 'followups': {
        const fus = await Followups.getAll();
        headers = ['Enquiry No', 'Customer', 'Date', 'Time', 'Notes', 'Status', 'Created By'];
        rows = fus.map(f => [
          f.enquiryNo, f.customerName, f.date, f.time, f.notes, f.status, f.createdByName
        ]);
        break;
      }
      case 'users': {
        if (!Permissions.isAdmin()) throw new Error('Permission denied.');
        const users = await DB.getAll('users');
        headers = ['Username', 'Name', 'Email', 'Role', 'Active', 'Created At', 'Last Login'];
        rows = users.map(u => [u.username, u.name, u.email, u.role, u.active, u.createdAt, u.lastLogin]);
        break;
      }
      case 'activity': {
        if (!Permissions.canViewActivityLogs()) throw new Error('Permission denied.');
        const logs = await Audit.getAll(5000);
        headers = ['Date', 'User', 'Role', 'Action', 'Description', 'Lead ID'];
        rows = logs.map(l => [l.createdAt, l.userName, l.role, l.action, l.description, l.leadId]);
        break;
      }
      case 'status_history': {
        const all = await DB.getAll('statusHistory');
        headers = ['Lead ID', 'From', 'To', 'Notes', 'Changed By', 'Date'];
        rows = all.map(s => [s.leadId, s.fromStatus, s.toStatus, s.notes, s.changedByName, s.changedAt]);
        break;
      }
      case 'notifications': {
        const all = await DB.getAll('notifications');
        headers = ['User ID', 'Title', 'Message', 'Type', 'Read', 'Date'];
        rows = all.map(n => [n.userId, n.title, n.message, n.type, n.read, n.createdAt]);
        break;
      }
      case 'settings': {
        if (!Permissions.isAdmin()) throw new Error('Permission denied.');
        const all = await DB.getAll('settings');
        headers = ['Key', 'Value', 'Updated At'];
        rows = all.map(s => [s.key, typeof s.value === 'object' ? JSON.stringify(s.value) : s.value, s.updatedAt]);
        break;
      }
      default:
        throw new Error('Unknown entity for export.');
    }

    const csv = Utils.arrayToCsv(rows, headers);
    Utils.downloadText(csv, `leadflow-${entity}-${Utils.today()}.csv`, 'text/csv');
    return true;
  }

  async function importCSV(entity, file) {
    if (!Permissions.canBackup()) throw new Error('Permission denied.');

    const text = await file.text();
    const rows = Utils.parseCsv(text);
    if (rows.length < 2) throw new Error('CSV file is empty or has no data rows.');

    const headers = rows[0].map(h => h.trim().toLowerCase());
    const dataRows = rows.slice(1);
    let imported = 0;

    if (entity === 'leads') {
      // Basic lead import — create as New
      const nameIdx = headers.findIndex(h => h.includes('customer'));
      const mobileIdx = headers.findIndex(h => h.includes('mobile'));
      if (nameIdx < 0 || mobileIdx < 0) throw new Error('CSV must have Customer and Mobile columns.');

      for (const row of dataRows) {
        const customerName = row[nameIdx];
        const mobile = row[mobileIdx];
        if (!customerName || !mobile) continue;
        try {
          await Leads.create({
            customerName,
            mobile: Utils.sanitizeMobile(mobile),
            companyName: row[headers.indexOf('company')] || '',
            email: row[headers.findIndex(h => h.includes('email'))] || '',
            city: row[headers.indexOf('city')] || '',
            state: row[headers.indexOf('state')] || '',
            source: row[headers.indexOf('source')] || '',
            enquiryType: row[headers.findIndex(h => h.includes('type'))] || '',
            requirements: ''
          });
          imported++;
        } catch (e) {
          console.warn('Skip row:', e.message);
        }
      }
    } else {
      throw new Error('CSV import is supported for Leads only. Use JSON restore for full data.');
    }

    await Audit.logCurrent('Updated', `CSV import (${entity}): ${imported} records`);
    return { imported };
  }

  return { exportJSON, importJSON, exportCSV, importCSV };
})();