/* LeadFlow CRM - Follow-ups Module */
const Followups = (() => {
  async function create(data) {
    if (!data.leadId) throw new Error('Lead is required.');
    const lead = await DB.get('leads', data.leadId);
    if (!lead) throw new Error('Lead not found.');

    if (Permissions.isLeadLocked(lead)) {
      throw new Error('Cannot add follow-ups to locked (Won/Lost) leads.');
    }
    if (!Permissions.canAddFollowup(lead)) {
      throw new Error('Permission denied.');
    }
    if (!data.date) throw new Error('Follow-up date is required.');

    const u = Auth.getCurrentUser();
    const today = Utils.today();
    let status = 'Pending';
    if (data.date < today) status = 'Overdue';

    const followup = {
      id: Utils.uid(),
      leadId: lead.id,
      enquiryNo: lead.enquiryNo,
      customerName: lead.customerName,
      date: data.date,
      time: data.time || '',
      notes: (data.notes || '').trim(),
      nextFollowupDate: data.nextFollowupDate || null,
      status,
      createdBy: u.id,
      createdByName: u.name,
      createdAt: Utils.now(),
      completedAt: null,
      completedBy: null,
      attachmentId: null
    };

    await DB.add('followups', followup);

    if (data.file) {
      try {
        const att = await Attachments.upload({
          file: data.file,
          leadId: lead.id,
          followupId: followup.id
        });
        followup.attachmentId = att.id;
        await DB.put('followups', followup);
      } catch (e) {
        console.warn('Follow-up attachment failed:', e);
      }
    }

    await Audit.logCurrent('Follow-up Added', `Follow-up for ${lead.enquiryNo} on ${data.date}`, lead.id);

    const notifyIds = [lead.assignedTo, lead.createdBy].filter(Boolean);
    await Notifications.notifyFollowup(lead, followup, notifyIds);

    return followup;
  }

  async function complete(id, notes) {
    const followup = await DB.get('followups', id);
    if (!followup) throw new Error('Follow-up not found.');

    const lead = await DB.get('leads', followup.leadId);
    if (!Permissions.canCompleteFollowup(lead)) {
      throw new Error('Permission denied.');
    }
    if (followup.status === 'Completed') throw new Error('Follow-up is already completed.');

    const u = Auth.getCurrentUser();
    followup.status = 'Completed';
    followup.completedAt = Utils.now();
    followup.completedBy = u.id;
    if (notes) followup.notes = (followup.notes ? followup.notes + '\n' : '') + notes;

    await DB.put('followups', followup);
    await Audit.logCurrent('Follow-up Completed', `Follow-up completed for ${followup.enquiryNo}`, followup.leadId);
    return followup;
  }

  async function getByLead(leadId) {
    const items = await DB.getByIndex('followups', 'leadId', leadId);
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    return items;
  }

  async function getAll() {
    const all = await DB.getAll('followups');
    const leads = await Leads.getAll();
    const leadIds = new Set(leads.map(l => l.id));
    const filtered = all.filter(f => leadIds.has(f.leadId));

    // Update overdue statuses
    const today = Utils.today();
    for (const f of filtered) {
      if (f.status === 'Pending' && f.date < today) {
        f.status = 'Overdue';
        await DB.put('followups', f);
      }
    }

    filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
    return filtered;
  }

  async function getGrouped() {
    const all = await getAll();
    const today = Utils.today();
    return {
      today: all.filter(f => f.status !== 'Completed' && f.date === today),
      upcoming: all.filter(f => f.status !== 'Completed' && f.date > today),
      overdue: all.filter(f => f.status === 'Overdue' || (f.status === 'Pending' && f.date < today)),
      completed: all.filter(f => f.status === 'Completed')
    };
  }

  async function remove(id) {
    const followup = await DB.get('followups', id);
    if (!followup) throw new Error('Follow-up not found.');
    const lead = await DB.get('leads', followup.leadId);
    if (lead && Permissions.isLeadLocked(lead)) {
      throw new Error('Cannot delete follow-ups from locked leads.');
    }
    if (!Permissions.isManagerOrAdmin()) throw new Error('Permission denied.');
    if (followup.attachmentId) {
      try { await DB.remove('attachments', followup.attachmentId); } catch (_) {}
    }
    await DB.remove('followups', id);
    return true;
  }

  return { create, complete, getByLead, getAll, getGrouped, remove };
})();