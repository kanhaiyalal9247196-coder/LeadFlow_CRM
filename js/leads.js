/* LeadFlow CRM - Leads Module */
const Leads = (() => {
  const SOURCES = ['Website', 'Referral', 'Cold Call', 'Walk-in', 'Social Media', 'Email Campaign', 'Advertisement', 'Partner', 'Other'];
  const ENQUIRY_TYPES = ['Product', 'Service', 'Support', 'Partnership', 'General', 'Other'];
  const LOST_REASONS = ['Price Issue', 'Competitor Selected', 'No Response', 'Budget Issue', 'Requirement Changed', 'Duplicate Lead', 'Other'];
  const STATUSES = ['New', 'Open', 'In Progress', 'On Hold', 'Won', 'Lost'];

  async function generateEnquiryNo() {
    const year = new Date().getFullYear();
    return DB.getNextCounter('enquiry', 'ENQ', year);
  }

  async function create(data) {
    Permissions.assertCan && null;
    if (!Permissions.canCreateLead()) throw new Error('Permission denied.');

    // Validation
    if (!data.customerName || !data.customerName.trim()) throw new Error('Customer name is required.');
    if (!data.mobile || !Utils.validateMobile(data.mobile)) {
      throw new Error('Valid 10-digit mobile number is required.');
    }

    const u = Auth.getCurrentUser();
    const enquiryNo = await generateEnquiryNo();

    // Prevent double submission with unique enquiry number
    const existing = await DB.getOneByIndex('leads', 'enquiryNo', enquiryNo);
    if (existing) throw new Error('Duplicate enquiry number generated. Please try again.');

    const lead = {
      id: Utils.uid(),
      enquiryNo,
      enquiryDate: data.enquiryDate || Utils.today(),
      customerName: data.customerName.trim(),
      mobile: Utils.sanitizeMobile(data.mobile),
      companyName: (data.companyName || '').trim(),
      alternateMobile: Utils.sanitizeMobile(data.alternateMobile || ''),
      email: (data.email || '').trim(),
      city: (data.city || '').trim(),
      state: (data.state || '').trim(),
      source: data.source || '',
      enquiryType: data.enquiryType || '',
      assignedTo: data.assignedTo || u.id,
      requirements: (data.requirements || '').trim(),
      offerAmount: data.offerAmount != null && data.offerAmount !== '' ? Number(data.offerAmount) : null,
      totalDealValue: data.totalDealValue != null && data.totalDealValue !== '' ? Number(data.totalDealValue) : null,
      dealCloseAmount: null,
      nextPaymentDueDate: data.nextPaymentDueDate || null,
      dueAmount: data.dueAmount != null && data.dueAmount !== '' ? Number(data.dueAmount) : null,
      status: 'New',
      locked: false,
      wonDate: null,
      wonNotes: '',
      lostDate: null,
      lostReason: '',
      lostRemarks: '',
      createdBy: u.id,
      createdAt: Utils.now(),
      updatedAt: Utils.now()
    };

    if (lead.email && !Utils.validateEmail(lead.email)) {
      throw new Error('Invalid email address.');
    }

    await DB.add('leads', lead);

    // Status history
    await addStatusHistory(lead.id, null, 'New', 'Lead created');

    await Audit.logCurrent('Created', `Lead ${enquiryNo} created — ${lead.customerName}`, lead.id);

    // Notify assignee if different
    if (lead.assignedTo && lead.assignedTo !== u.id) {
      await Notifications.notifyLeadAssignment(lead, lead.assignedTo, u.name);
    }

    return lead;
  }

  async function update(id, data) {
    const lead = await DB.get('leads', id);
    if (!lead) throw new Error('Lead not found.');

    // CRITICAL: Won/Lost permanent lock
    if (lead.status === 'Won') {
      throw new Error('Won leads are permanently locked and cannot be edited.');
    }
    if (lead.status === 'Lost') {
      throw new Error('Lost leads cannot be reopened or edited.');
    }
    if (!Permissions.canEditLead(lead)) {
      throw new Error('Permission denied: you cannot edit this lead.');
    }

    // Validate fields
    if (data.customerName !== undefined) {
      if (!data.customerName.trim()) throw new Error('Customer name is required.');
      lead.customerName = data.customerName.trim();
    }
    if (data.mobile !== undefined) {
      if (!Utils.validateMobile(data.mobile)) throw new Error('Valid 10-digit mobile number is required.');
      lead.mobile = Utils.sanitizeMobile(data.mobile);
    }
    if (data.companyName !== undefined) lead.companyName = data.companyName.trim();
    if (data.alternateMobile !== undefined) lead.alternateMobile = Utils.sanitizeMobile(data.alternateMobile);
    if (data.email !== undefined) {
      if (data.email && !Utils.validateEmail(data.email)) throw new Error('Invalid email address.');
      lead.email = data.email.trim();
    }
    if (data.city !== undefined) lead.city = data.city.trim();
    if (data.state !== undefined) lead.state = data.state.trim();
    if (data.source !== undefined) lead.source = data.source;
    if (data.enquiryType !== undefined) lead.enquiryType = data.enquiryType;
    if (data.requirements !== undefined) lead.requirements = data.requirements.trim();
    if (data.offerAmount !== undefined) {
      lead.offerAmount = data.offerAmount !== '' && data.offerAmount != null ? Number(data.offerAmount) : null;
    }
    if (data.totalDealValue !== undefined) {
      lead.totalDealValue = data.totalDealValue !== '' && data.totalDealValue != null ? Number(data.totalDealValue) : null;
    }
    if (data.nextPaymentDueDate !== undefined) lead.nextPaymentDueDate = data.nextPaymentDueDate || null;
    if (data.dueAmount !== undefined) {
      lead.dueAmount = data.dueAmount !== '' && data.dueAmount != null ? Number(data.dueAmount) : null;
    }
    if (data.enquiryDate !== undefined) lead.enquiryDate = data.enquiryDate;

    // Assignment
    if (data.assignedTo !== undefined && data.assignedTo !== lead.assignedTo) {
      if (!Permissions.canAssignLead(lead)) {
        throw new Error('Permission denied: you cannot assign leads.');
      }
      const oldAssignee = lead.assignedTo;
      lead.assignedTo = data.assignedTo;
      const u = Auth.getCurrentUser();
      await Audit.logCurrent('Assigned', `Lead ${lead.enquiryNo} reassigned`, lead.id);
      if (data.assignedTo) {
        await Notifications.notifyLeadAssignment(lead, data.assignedTo, u.name);
      }
    }

    // Never allow status change via update
    // Never allow enquiryNo change
    lead.updatedAt = Utils.now();
    await DB.put('leads', lead);
    await Audit.logCurrent('Updated', `Lead ${lead.enquiryNo} updated`, lead.id);
    return lead;
  }

  async function changeStatus(id, newStatus, extra = {}) {
    const lead = await DB.get('leads', id);
    if (!lead) throw new Error('Lead not found.');

    // Centralized validator — no bypass
    Permissions.validateStatusTransition(lead, newStatus);

    if (!Permissions.canChangeStatus(lead, newStatus) && !Permissions.isManagerOrAdmin()) {
      // Double-check edit rights
      if (!Permissions.canEditLead(lead) && !Permissions.isManagerOrAdmin()) {
        throw new Error('Permission denied: you cannot change status of this lead.');
      }
    }

    // Re-validate transition after permission (locked leads already rejected)
    if (lead.status === 'Won') throw new Error('Won leads are permanently locked.');
    if (lead.status === 'Lost') throw new Error('Lost leads cannot be reopened or edited.');

    const oldStatus = lead.status;

    if (newStatus === 'Won') {
      return markWon(lead, extra);
    }
    if (newStatus === 'Lost') {
      return markLost(lead, extra);
    }

    lead.status = newStatus;
    lead.updatedAt = Utils.now();
    await DB.put('leads', lead);

    await addStatusHistory(lead.id, oldStatus, newStatus, extra.notes || '');
    await Audit.logCurrent('Status Changed', `${lead.enquiryNo}: ${oldStatus} → ${newStatus}`, lead.id);

    const notifyIds = [lead.assignedTo, lead.createdBy].filter(Boolean);
    await Notifications.notifyStatusChange(lead, oldStatus, newStatus, notifyIds);

    return lead;
  }

  async function markWon(lead, extra) {
    // Re-check lock
    if (lead.status === 'Won') throw new Error('Lead is already Won and locked.');
    if (lead.status === 'Lost') throw new Error('Lost leads cannot be changed to Won.');

    Permissions.validateStatusTransition(lead, 'Won');

    if (!extra.wonDate) throw new Error('Won Date is required.');
    if (extra.dealCloseAmount == null || extra.dealCloseAmount === '' || Number(extra.dealCloseAmount) <= 0) {
      throw new Error('Deal Close Amount / Project Value is required and must be greater than zero.');
    }

    const oldStatus = lead.status;
    lead.status = 'Won';
    lead.locked = true;
    lead.wonDate = extra.wonDate;
    lead.dealCloseAmount = Number(extra.dealCloseAmount);
    lead.wonNotes = (extra.wonNotes || '').trim();
    lead.updatedAt = Utils.now();

    await DB.put('leads', lead);
    await addStatusHistory(lead.id, oldStatus, 'Won', `Deal closed at ${Utils.formatCurrency(lead.dealCloseAmount)}. ${lead.wonNotes}`);
    await Audit.logCurrent('Status Changed', `${lead.enquiryNo} marked WON — Deal Close: ${Utils.formatCurrency(lead.dealCloseAmount)}`, lead.id);

    const notifyIds = [lead.assignedTo, lead.createdBy].filter(Boolean);
    await Notifications.notifyStatusChange(lead, oldStatus, 'Won', notifyIds);

    return lead;
  }

  async function markLost(lead, extra) {
    if (lead.status === 'Lost') throw new Error('Lead is already Lost and closed.');
    if (lead.status === 'Won') throw new Error('Won leads are permanently locked and cannot be marked Lost.');

    Permissions.validateStatusTransition(lead, 'Lost');

    if (!extra.lostDate) throw new Error('Lost Date is required.');
    if (!extra.lostReason) throw new Error('Lost Reason is required.');
    if (!LOST_REASONS.includes(extra.lostReason)) throw new Error('Invalid lost reason.');

    const oldStatus = lead.status;
    lead.status = 'Lost';
    lead.locked = true;
    lead.lostDate = extra.lostDate;
    lead.lostReason = extra.lostReason;
    lead.lostRemarks = (extra.lostRemarks || '').trim();
    lead.updatedAt = Utils.now();

    await DB.put('leads', lead);
    await addStatusHistory(lead.id, oldStatus, 'Lost', `Reason: ${lead.lostReason}. ${lead.lostRemarks}`);
    await Audit.logCurrent('Status Changed', `${lead.enquiryNo} marked LOST — ${lead.lostReason}`, lead.id);

    const notifyIds = [lead.assignedTo, lead.createdBy].filter(Boolean);
    await Notifications.notifyStatusChange(lead, oldStatus, 'Lost', notifyIds);

    return lead;
  }

  async function remove(id) {
    const lead = await DB.get('leads', id);
    if (!lead) throw new Error('Lead not found.');

    if (lead.status === 'Won') throw new Error('Won leads are permanently locked and cannot be deleted.');
    if (lead.status === 'Lost') throw new Error('Lost leads cannot be deleted.');
    if (!Permissions.canDeleteLead(lead)) throw new Error('Permission denied: only Admin can delete leads.');

    const enq = lead.enquiryNo;
    await DB.deleteLeadCascade(id);
    await Audit.logCurrent('Updated', `Lead ${enq} deleted with related records`, null);
    return true;
  }

  async function getById(id) {
    const lead = await DB.get('leads', id);
    if (!lead) return null;
    if (!Permissions.canViewLead(lead)) throw new Error('Permission denied: you cannot view this lead.');
    return lead;
  }

  async function getAll() {
    const all = await DB.getAll('leads');
    return Permissions.filterLeadsForUser(all);
  }

  async function getFinancials(leadId) {
    const lead = await DB.get('leads', leadId);
    if (!lead) throw new Error('Lead not found.');
    const payments = await DB.getByIndex('payments', 'leadId', leadId);
    const totalReceived = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const trackingValue = Utils.getPaymentTrackingValue(lead);
    const pendingAmount = Math.max(0, trackingValue - totalReceived);
    const paymentStatus = Utils.calcPaymentStatus(lead, totalReceived);

    return {
      offerAmount: lead.offerAmount,
      dealCloseAmount: lead.dealCloseAmount,
      totalDealValue: lead.totalDealValue,
      trackingValue,
      totalReceived,
      pendingAmount,
      paymentStatus,
      nextPaymentDueDate: lead.nextPaymentDueDate,
      dueAmount: lead.dueAmount,
      paymentCount: payments.length
    };
  }

  async function addStatusHistory(leadId, fromStatus, toStatus, notes) {
    const u = Auth.getCurrentUser();
    await DB.add('statusHistory', {
      id: Utils.uid(),
      leadId,
      fromStatus: fromStatus || null,
      toStatus,
      notes: notes || '',
      changedBy: u?.id,
      changedByName: u?.name || 'System',
      changedAt: Utils.now()
    });
  }

  async function getStatusHistory(leadId) {
    const items = await DB.getByIndex('statusHistory', 'leadId', leadId);
    items.sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
    return items;
  }

  async function search(query) {
    if (!query || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    const leads = await getAll();
    return leads.filter(l => {
      return (
        (l.enquiryNo || '').toLowerCase().includes(q) ||
        (l.customerName || '').toLowerCase().includes(q) ||
        (l.mobile || '').includes(q) ||
        (l.alternateMobile || '').includes(q) ||
        (l.companyName || '').toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q) ||
        (l.requirements || '').toLowerCase().includes(q) ||
        (l.city || '').toLowerCase().includes(q)
      );
    });
  }

  async function globalSearch(query) {
    const results = [];
    const q = (query || '').trim().toLowerCase();
    if (q.length < 2) return results;

    const leads = await search(q);
    leads.forEach(l => {
      results.push({
        type: 'lead',
        id: l.id,
        title: `${l.enquiryNo} — ${l.customerName}`,
        meta: `${l.mobile || ''} ${l.companyName || ''} · ${l.status}`,
        leadId: l.id
      });
    });

    // Payment references
    if (Permissions.canViewPayments()) {
      const payments = await DB.getAll('payments');
      const leadIds = new Set((await getAll()).map(l => l.id));
      for (const p of payments) {
        if (!leadIds.has(p.leadId)) continue;
        const match =
          (p.receiptNo || '').toLowerCase().includes(q) ||
          (p.referenceNumber || '').toLowerCase().includes(q) ||
          (p.customerName || '').toLowerCase().includes(q);
        if (match) {
          results.push({
            type: 'payment',
            id: p.id,
            title: `${p.receiptNo} — ${Utils.formatCurrency(p.amount)}`,
            meta: `${p.customerName || ''} · ${Utils.formatDate(p.paymentDate)}`,
            leadId: p.leadId
          });
        }
      }
    }

    return results.slice(0, 20);
  }

  return {
    SOURCES, ENQUIRY_TYPES, LOST_REASONS, STATUSES,
    create, update, changeStatus, markWon, markLost, remove,
    getById, getAll, getFinancials, getStatusHistory, search, globalSearch
  };
})();