/* LeadFlow CRM - Reports & Dashboard Data */
const Reports = (() => {
  async function getDashboardKPIs() {
    const leads = await Leads.getAll();
    const payments = await Payments.getAll();
    const followups = await Followups.getAll();
    const today = Utils.today();

    const byStatus = {};
    Leads.STATUSES.forEach(s => { byStatus[s] = 0; });
    leads.forEach(l => { byStatus[l.status] = (byStatus[l.status] || 0) + 1; });

    let totalDealValue = 0;
    let totalReceived = 0;
    let totalPending = 0;
    let overduePayments = 0;

    for (const lead of leads) {
      const fin = await Leads.getFinancials(lead.id);
      totalDealValue += fin.trackingValue;
      totalReceived += fin.totalReceived;
      totalPending += fin.pendingAmount;
      if (fin.paymentStatus === 'Overdue') overduePayments++;
    }

    const won = byStatus['Won'] || 0;
    const lost = byStatus['Lost'] || 0;
    const closed = won + lost;
    const conversionRate = closed > 0 ? Math.round((won / closed) * 1000) / 10 : 0;

    const upcomingFollowups = followups.filter(f => f.status !== 'Completed' && f.date >= today).length;
    const overdueFollowups = followups.filter(f => f.status === 'Overdue' || (f.status === 'Pending' && f.date < today)).length;

    return {
      totalLeads: leads.length,
      new: byStatus['New'] || 0,
      open: byStatus['Open'] || 0,
      inProgress: byStatus['In Progress'] || 0,
      onHold: byStatus['On Hold'] || 0,
      won,
      lost,
      conversionRate,
      totalDealValue,
      totalReceived,
      totalPending,
      overduePayments,
      upcomingFollowups,
      overdueFollowups,
      byStatus
    };
  }

  async function getLeadTrend(months = 6) {
    const leads = await Leads.getAll();
    const result = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      const count = leads.filter(l => (l.enquiryDate || '').startsWith(key)).length;
      const won = leads.filter(l => l.status === 'Won' && (l.wonDate || '').startsWith(key)).length;
      result.push({ key, label, count, won });
    }
    return result;
  }

  async function getPaymentCollection(months = 6) {
    const payments = await Payments.getAll();
    const result = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      const total = payments
        .filter(p => (p.paymentDate || '').startsWith(key))
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
      result.push({ key, label, total });
    }
    return result;
  }

  async function getExecutivePerformance() {
    if (!Permissions.canViewReports() && !Permissions.isAdmin()) {
      // Executive sees only self
    }
    const leads = await Leads.getAll();
    const users = await DB.getAll('users');
    const execs = users.filter(u => u.role === 'Executive' || u.role === 'Manager' || u.role === 'Admin');

    return execs.map(u => {
      const assigned = leads.filter(l => l.assignedTo === u.id);
      const won = assigned.filter(l => l.status === 'Won');
      const lost = assigned.filter(l => l.status === 'Lost');
      const dealValue = won.reduce((s, l) => s + (Number(l.dealCloseAmount) || Number(l.totalDealValue) || 0), 0);
      return {
        userId: u.id,
        name: u.name,
        role: u.role,
        totalLeads: assigned.length,
        won: won.length,
        lost: lost.length,
        active: assigned.filter(l => !Permissions.isLeadLocked(l)).length,
        dealValue
      };
    }).filter(e => e.totalLeads > 0 || e.role === 'Executive');
  }

  async function getReport(type, filters = {}) {
    const leads = await Leads.getAll();
    const { dateFrom, dateTo } = filters;

    function inRange(dateStr) {
      if (!dateStr) return true;
      if (dateFrom && dateStr < dateFrom) return false;
      if (dateTo && dateStr > dateTo) return false;
      return true;
    }

    switch (type) {
      case 'leads':
        return leads.filter(l => inRange(l.enquiryDate));
      case 'won':
        return leads.filter(l => l.status === 'Won' && inRange(l.wonDate || l.enquiryDate));
      case 'lost':
        return leads.filter(l => l.status === 'Lost' && inRange(l.lostDate || l.enquiryDate));
      case 'payments':
        return (await Payments.getAll()).filter(p => inRange(p.paymentDate));
      case 'pending_payments': {
        const result = [];
        for (const l of leads) {
          const fin = await Leads.getFinancials(l.id);
          if (fin.pendingAmount > 0) {
            result.push({ ...l, ...fin });
          }
        }
        return result;
      }
      case 'followups':
        return (await Followups.getAll()).filter(f => inRange(f.date));
      case 'executive':
        return getExecutivePerformance();
      case 'daily': {
        const today = Utils.today();
        return {
          leads: leads.filter(l => l.enquiryDate === today),
          payments: (await Payments.getAll()).filter(p => p.paymentDate === today),
          followups: (await Followups.getAll()).filter(f => f.date === today)
        };
      }
      case 'weekly': {
        const now = new Date();
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const from = weekAgo.toISOString().slice(0, 10);
        const to = Utils.today();
        return getReport('leads', { dateFrom: from, dateTo: to });
      }
      case 'monthly': {
        const now = new Date();
        const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const to = Utils.today();
        return getReport('leads', { dateFrom: from, dateTo: to });
      }
      default:
        return [];
    }
  }

  return {
    getDashboardKPIs, getLeadTrend, getPaymentCollection,
    getExecutivePerformance, getReport
  };
})();