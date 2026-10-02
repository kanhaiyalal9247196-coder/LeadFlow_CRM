/* LeadFlow CRM - In-App Notifications */
const Notifications = (() => {
  async function create({ userId, title, message, type, leadId, eventKey }) {
    if (!userId) return null;

    // Prevent duplicates via eventKey
    if (eventKey) {
      const existing = await DB.getByIndex('notifications', 'eventKey', eventKey);
      const dup = existing.find(n => n.userId === userId && n.eventKey === eventKey);
      if (dup) return dup;
    }

    const notif = {
      id: Utils.uid(),
      userId,
      title: title || 'Notification',
      message: message || '',
      type: type || 'info',
      leadId: leadId || null,
      eventKey: eventKey || Utils.uid(),
      read: false,
      createdAt: Utils.now()
    };

    await DB.add('notifications', notif);

    // Browser notification — only for the currently signed-in user
    try {
      const me = Auth.getCurrentUser();
      const enabled = await DB.getSetting('browserNotifications', true);
      if (me && me.id === userId && enabled &&
          typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(notif.title, { body: notif.message, icon: undefined });
      }
    } catch (_) {}

    return notif;
  }

  async function notifyUsers(userIds, data) {
    const unique = [...new Set(userIds.filter(Boolean))];
    const results = [];
    for (const uid of unique) {
      results.push(await create({ ...data, userId: uid }));
    }
    return results;
  }

  async function notifyLeadAssignment(lead, assignedUserId, assignerName) {
    return create({
      userId: assignedUserId,
      title: 'New Lead Assigned',
      message: `${lead.enquiryNo} — ${lead.customerName} assigned to you by ${assignerName}`,
      type: 'assignment',
      leadId: lead.id,
      eventKey: `assign_${lead.id}_${assignedUserId}_${Date.now()}`
    });
  }

  async function notifyStatusChange(lead, oldStatus, newStatus, userIds) {
    return notifyUsers(userIds, {
      title: 'Lead Status Changed',
      message: `${lead.enquiryNo} — ${lead.customerName}: ${oldStatus} → ${newStatus}`,
      type: 'status',
      leadId: lead.id,
      eventKey: `status_${lead.id}_${newStatus}_${Date.now()}`
    });
  }

  async function notifyPayment(lead, amount, userIds) {
    return notifyUsers(userIds, {
      title: 'Payment Received',
      message: `${lead.enquiryNo} — ${Utils.formatCurrency(amount)} received from ${lead.customerName}`,
      type: 'payment',
      leadId: lead.id,
      eventKey: `payment_${lead.id}_${amount}_${Date.now()}`
    });
  }

  async function notifyFollowup(lead, followup, userIds) {
    return notifyUsers(userIds, {
      title: 'Follow-up Scheduled',
      message: `${lead.enquiryNo} — Follow-up on ${Utils.formatDate(followup.date)}`,
      type: 'followup',
      leadId: lead.id,
      eventKey: `followup_${followup.id}`
    });
  }

  async function getForUser(userId, limit = 50) {
    const items = await DB.getByIndex('notifications', 'userId', userId);
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return items.slice(0, limit);
  }

  async function getUnreadCount(userId) {
    const items = await DB.getByIndex('notifications', 'userId', userId);
    return items.filter(n => !n.read).length;
  }

  async function markRead(id) {
    const n = await DB.get('notifications', id);
    if (n) {
      n.read = true;
      await DB.put('notifications', n);
    }
  }

  async function markAllRead(userId) {
    const items = await DB.getByIndex('notifications', 'userId', userId);
    for (const n of items) {
      if (!n.read) {
        n.read = true;
        await DB.put('notifications', n);
      }
    }
  }

  async function requestBrowserPermission() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  function daysBetween(fromDate, toDate) {
    const a = new Date(fromDate + 'T00:00:00');
    const b = new Date(toDate + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  function emptyReminders() {
    return {
      followupOverdue: [], followupToday: [], followupUpcoming: [],
      paymentOverdue: [], paymentDueToday: [], paymentDueSoon: []
    };
  }

  // Compute all current reminders (also flips stale follow-ups to Overdue).
  // Does NOT create notifications — call checkDueReminders() to persist/notify.
  async function getReminders() {
    const u = Auth.getCurrentUser();
    const result = emptyReminders();
    if (!u) return result;

    const today = Utils.today();
    const fuReminderHours = Number(await DB.getSetting('followupReminderHours', 24)) || 24;
    const payReminderDays = Number(await DB.getSetting('paymentReminderDays', 3)) || 3;
    const fuWindowDays = Math.max(1, Math.ceil(fuReminderHours / 24));

    const leads = await Leads.getAll();
    const leadMap = Object.fromEntries(leads.map(l => [l.id, l]));
    const followups = await Followups.getAll();

    for (const f of followups) {
      if (f.status === 'Completed') continue;
      const lead = leadMap[f.leadId];
      if (!lead) continue;

      if (f.status === 'Overdue' || f.date < today) {
        if (f.status !== 'Overdue') { f.status = 'Overdue'; await DB.put('followups', f); }
        result.followupOverdue.push({ followup: f, lead });
      } else if (f.date === today) {
        result.followupToday.push({ followup: f, lead });
      } else {
        const d = daysBetween(today, f.date);
        if (d <= fuWindowDays) result.followupUpcoming.push({ followup: f, lead, daysLeft: d });
      }
    }

    for (const lead of leads) {
      if (lead.status === 'Lost') continue;
      const fin = await Leads.getFinancials(lead.id);
      if (fin.pendingAmount <= 0 || !lead.nextPaymentDueDate) continue;

      const item = { lead, fin };
      if (lead.nextPaymentDueDate < today) {
        result.paymentOverdue.push({ ...item, daysOverdue: Math.abs(daysBetween(lead.nextPaymentDueDate, today)) });
      } else if (lead.nextPaymentDueDate === today) {
        result.paymentDueToday.push(item);
      } else {
        const d = daysBetween(today, lead.nextPaymentDueDate);
        if (d <= payReminderDays) result.paymentDueSoon.push({ ...item, daysLeft: d });
      }
    }

    return result;
  }

  async function checkDueReminders() {
    const u = Auth.getCurrentUser();
    if (!u) return emptyReminders();

    const today = Utils.today();
    const r = await getReminders();

    const push = async (items, cfg) => {
      for (const it of items) {
        const lead = it.lead;
        const userIds = [...new Set([lead.assignedTo, lead.createdBy].filter(Boolean))];
        await notifyUsers(userIds, await cfg(it, lead, today));
      }
    };

    await push(r.followupOverdue, async (it, lead) => ({
      title: '🔴 Follow-up Overdue',
      message: `${lead.enquiryNo} — ${lead.customerName}: follow-up was due ${Utils.formatDate(it.followup.date)}${it.followup.time ? ' at ' + it.followup.time : ''}`,
      type: 'followup_overdue', leadId: lead.id,
      eventKey: `fu_overdue_${it.followup.id}_${today}`
    }));

    await push(r.followupToday, async (it, lead) => ({
      title: '📅 Follow-up Due Today',
      message: `${lead.enquiryNo} — ${lead.customerName}: follow-up today${it.followup.time ? ' at ' + it.followup.time : ''}`,
      type: 'followup_due', leadId: lead.id,
      eventKey: `fu_due_${it.followup.id}_${today}`
    }));

    await push(r.followupUpcoming, async (it, lead) => ({
      title: '🔜 Upcoming Follow-up',
      message: `${lead.enquiryNo} — ${lead.customerName}: follow-up on ${Utils.formatDate(it.followup.date)} (in ${it.daysLeft}d)`,
      type: 'followup_upcoming', leadId: lead.id,
      eventKey: `fu_up_${it.followup.id}_${it.followup.date}`
    }));

    await push(r.paymentOverdue, async (it, lead) => ({
      title: '🔴 Payment Overdue',
      message: `${lead.enquiryNo} — ${lead.customerName}: ${Utils.formatCurrency(it.fin.pendingAmount)} overdue since ${Utils.formatDate(lead.nextPaymentDueDate)}`,
      type: 'payment_overdue', leadId: lead.id,
      eventKey: `pay_overdue_${lead.id}_${today}`
    }));

    await push(r.paymentDueToday, async (it, lead) => ({
      title: '💰 Payment Due Today',
      message: `${lead.enquiryNo} — ${lead.customerName}: ${Utils.formatCurrency(it.fin.pendingAmount)} due today`,
      type: 'payment_due', leadId: lead.id,
      eventKey: `pay_due_${lead.id}_${today}`
    }));

    await push(r.paymentDueSoon, async (it, lead) => ({
      title: '⏰ Payment Due Soon',
      message: `${lead.enquiryNo} — ${lead.customerName}: ${Utils.formatCurrency(it.fin.pendingAmount)} due on ${Utils.formatDate(lead.nextPaymentDueDate)} (in ${it.daysLeft}d)`,
      type: 'payment_soon', leadId: lead.id,
      eventKey: `pay_soon_${lead.id}_${lead.nextPaymentDueDate}`
    }));

    return r;
  }

  return {
    create, notifyUsers, notifyLeadAssignment, notifyStatusChange,
    notifyPayment, notifyFollowup, getForUser, getUnreadCount,
    markRead, markAllRead, requestBrowserPermission,
    checkDueReminders, getReminders
  };
})();