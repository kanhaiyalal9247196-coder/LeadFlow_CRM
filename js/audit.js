/* LeadFlow CRM - Audit / Activity Log (append-only) */
const Audit = (() => {
  async function log({ userId, userName, role, action, description, leadId }) {
    try {
      const entry = {
        id: Utils.uid(),
        userId: userId || null,
        userName: userName || 'System',
        role: role || '',
        action: action || 'Unknown',
        description: description || '',
        leadId: leadId || null,
        createdAt: Utils.now()
      };
      await DB.add('activityLogs', entry);
      return entry;
    } catch (e) {
      console.error('Audit log failed:', e);
      return null;
    }
  }

  async function logCurrent(action, description, leadId = null) {
    const u = Auth.getCurrentUser();
    return log({
      userId: u?.id,
      userName: u?.name || 'System',
      role: u?.role || '',
      action,
      description,
      leadId
    });
  }

  async function getAll(limit = 500) {
    const all = await DB.getAll('activityLogs');
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return all.slice(0, limit);
  }

  async function getByLead(leadId) {
    const items = await DB.getByIndex('activityLogs', 'leadId', leadId);
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return items;
  }

  async function getByUser(userId) {
    const items = await DB.getByIndex('activityLogs', 'userId', userId);
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return items;
  }

  // No update or delete methods — append-only by design

  return { log, logCurrent, getAll, getByLead, getByUser };
})();