/* LeadFlow CRM - Payments Module */
const Payments = (() => {
  const METHODS = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Credit/Debit Card', 'Other'];

  async function generateReceiptNo() {
    const year = new Date().getFullYear();
    return DB.getNextCounter('receipt', 'RCPT', year);
  }

  async function create(data) {
    if (!data.leadId) throw new Error('Lead is required.');
    const lead = await DB.get('leads', data.leadId);
    if (!lead) throw new Error('Lead not found.');

    if (lead.status === 'Lost') {
      throw new Error('Cannot add payments to Lost leads.');
    }
    if (!Permissions.canAddPayment(lead)) {
      throw new Error('Permission denied: you cannot add payments to this lead.');
    }

    const amount = Number(data.amount);
    if (!amount || amount <= 0) throw new Error('Payment amount must be greater than zero.');
    if (!data.paymentDate) throw new Error('Payment date is required.');
    if (!data.paymentMethod || !METHODS.includes(data.paymentMethod)) {
      throw new Error('Valid payment method is required.');
    }

    // Calculate outstanding
    const existingPayments = await DB.getByIndex('payments', 'leadId', lead.id);
    const totalReceived = existingPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const trackingValue = Utils.getPaymentTrackingValue(lead);

    if (trackingValue <= 0) {
      throw new Error('No payment tracking value set. Set Total Deal Value or mark the lead as Won with Deal Close Amount first.');
    }

    const outstanding = Math.max(0, trackingValue - totalReceived);
    if (amount > outstanding) {
      throw new Error(`Payment cannot exceed the outstanding balance of ${Utils.formatCurrency(outstanding)}.`);
    }

    const u = Auth.getCurrentUser();
    const receiptNo = await generateReceiptNo();

    const payment = {
      id: Utils.uid(),
      receiptNo,
      leadId: lead.id,
      enquiryNo: lead.enquiryNo,
      customerName: lead.customerName,
      amount,
      paymentDate: data.paymentDate,
      paymentMethod: data.paymentMethod,
      referenceNumber: (data.referenceNumber || '').trim(),
      notes: (data.notes || '').trim(),
      receivedBy: data.receivedBy || u.name,
      receivedById: u.id,
      createdAt: Utils.now(),
      attachmentId: null
    };

    await DB.add('payments', payment);

    // Optional receipt attachment
    if (data.file) {
      try {
        const att = await Attachments.upload({
          file: data.file,
          leadId: lead.id,
          paymentId: payment.id
        });
        payment.attachmentId = att.id;
        await DB.put('payments', payment);
      } catch (e) {
        console.warn('Receipt attachment failed:', e);
      }
    }

    await Audit.logCurrent('Payment Added', `${receiptNo}: ${Utils.formatCurrency(amount)} for ${lead.enquiryNo}`, lead.id);

    const notifyIds = [lead.assignedTo, lead.createdBy].filter(Boolean);
    await Notifications.notifyPayment(lead, amount, notifyIds);

    return payment;
  }

  async function remove(id) {
    const payment = await DB.get('payments', id);
    if (!payment) throw new Error('Payment not found.');

    const lead = await DB.get('leads', payment.leadId);
    if (lead && Permissions.isLeadLocked(lead)) {
      throw new Error('Cannot delete payments from locked (Won/Lost) leads.');
    }
    if (!Permissions.canDeletePayment(lead)) {
      throw new Error('Permission denied: you cannot delete payments.');
    }

    // Delete related attachment
    if (payment.attachmentId) {
      try { await DB.remove('attachments', payment.attachmentId); } catch (_) {}
    }

    await DB.remove('payments', id);
    await Audit.logCurrent('Payment Deleted', `${payment.receiptNo}: ${Utils.formatCurrency(payment.amount)} deleted`, payment.leadId);
    return true;
  }

  async function getById(id) {
    return DB.get('payments', id);
  }

  async function getByLead(leadId) {
    const items = await DB.getByIndex('payments', 'leadId', leadId);
    items.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
    return items;
  }

  async function getAll() {
    const all = await DB.getAll('payments');
    const leads = await Leads.getAll();
    const leadIds = new Set(leads.map(l => l.id));
    return all.filter(p => leadIds.has(p.leadId)).sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
  }

  function buildReceiptHtml(payment, lead, company) {
    const companyName = company?.name || 'LeadFlow CRM';
    return `
      <div class="receipt-preview receipt-print">
        <div class="receipt-header">
          <h2>${Utils.escapeHtml(companyName)}</h2>
          <p style="margin:0.25rem 0;color:#666;font-size:0.85rem;">Payment Receipt</p>
          ${company?.address ? `<p style="margin:0;color:#888;font-size:0.8rem;">${Utils.escapeHtml(company.address)}</p>` : ''}
          ${company?.phone ? `<p style="margin:0;color:#888;font-size:0.8rem;">${Utils.escapeHtml(company.phone)}</p>` : ''}
        </div>
        <div class="receipt-row"><span>Receipt No</span><strong>${Utils.escapeHtml(payment.receiptNo)}</strong></div>
        <div class="receipt-row"><span>Date</span><strong>${Utils.escapeHtml(Utils.formatDate(payment.paymentDate))}</strong></div>
        <div class="receipt-row"><span>Customer</span><strong>${Utils.escapeHtml(payment.customerName)}</strong></div>
        <div class="receipt-row"><span>Enquiry No</span><strong>${Utils.escapeHtml(payment.enquiryNo || lead?.enquiryNo || '')}</strong></div>
        <div class="receipt-amount">${Utils.escapeHtml(Utils.formatCurrency(payment.amount))}</div>
        <div class="receipt-row"><span>Payment Method</span><strong>${Utils.escapeHtml(payment.paymentMethod)}</strong></div>
        ${payment.referenceNumber ? `<div class="receipt-row"><span>Reference</span><strong>${Utils.escapeHtml(payment.referenceNumber)}</strong></div>` : ''}
        <div class="receipt-row"><span>Received By</span><strong>${Utils.escapeHtml(payment.receivedBy)}</strong></div>
        ${payment.notes ? `<div class="receipt-row"><span>Notes</span><strong>${Utils.escapeHtml(payment.notes)}</strong></div>` : ''}
        <div style="text-align:center;margin-top:2rem;font-size:0.75rem;color:#999;">
          Generated by LeadFlow CRM · ${Utils.escapeHtml(Utils.formatDateTime(payment.createdAt))}
        </div>
      </div>
    `;
  }

  async function getCompanyInfo() {
    return {
      name: await DB.getSetting('companyName', 'LeadFlow CRM'),
      address: await DB.getSetting('companyAddress', ''),
      phone: await DB.getSetting('companyPhone', ''),
      email: await DB.getSetting('companyEmail', '')
    };
  }

  return {
    METHODS, create, remove, getById, getByLead, getAll, buildReceiptHtml, getCompanyInfo
  };
})();