/* LeadFlow CRM - Role-Based Permissions */
const Permissions = (() => {
  const ROLES = ['Admin', 'Manager', 'Executive'];

  function user() {
    return Auth.getCurrentUser();
  }

  function role() {
    return user()?.role || null;
  }

  function isAdmin() { return role() === 'Admin'; }
  function isManager() { return role() === 'Manager'; }
  function isExecutive() { return role() === 'Executive'; }
  function isManagerOrAdmin() { return isAdmin() || isManager(); }

  /* ---- Lead lock rules (highest priority) ---- */
  function isLeadLocked(lead) {
    if (!lead) return true;
    return lead.status === 'Won' || lead.status === 'Lost';
  }

  function isWon(lead) { return lead && lead.status === 'Won'; }
  function isLost(lead) { return lead && lead.status === 'Lost'; }

  function canViewLead(lead) {
    const u = user();
    if (!u || !lead) return false;
    if (isAdmin() || isManager()) return true;
    // Executive: assigned to them OR created by them
    return lead.assignedTo === u.id || lead.createdBy === u.id;
  }

  function canCreateLead() {
    return !!user();
  }

  function canEditLead(lead) {
    if (!lead || !user()) return false;
    if (isLeadLocked(lead)) return false;
    if (isAdmin() || isManager()) return true;
    // Executive: only their own created or assigned active leads
    return lead.assignedTo === user().id || lead.createdBy === user().id;
  }

  function canDeleteLead(lead) {
    if (!lead || !user()) return false;
    if (isLeadLocked(lead)) return false;
    return isAdmin();
  }

  function canAssignLead(lead) {
    if (!lead || !user()) return false;
    if (isLeadLocked(lead)) return false;
    return isAdmin() || isManager();
  }

  function canChangeStatus(lead, newStatus) {
    if (!lead || !user()) return false;
    if (isLeadLocked(lead)) return false;
    if (!canEditLead(lead) && !isManagerOrAdmin()) return false;

    const allowed = getAllowedTransitions(lead.status);
    return allowed.includes(newStatus);
  }

  function getAllowedTransitions(currentStatus) {
    const map = {
      'New': ['Open'],
      'Open': ['In Progress', 'Won', 'Lost'],
      'In Progress': ['On Hold', 'Won', 'Lost'],
      'On Hold': ['In Progress', 'Won', 'Lost'],
      'Won': [],
      'Lost': []
    };
    return map[currentStatus] || [];
  }

  function validateStatusTransition(lead, newStatus) {
    if (!lead) throw new Error('Lead not found.');
    if (lead.status === 'Won') throw new Error('Won leads are permanently locked. Status cannot be changed.');
    if (lead.status === 'Lost') throw new Error('Lost leads cannot be reopened or edited. Status cannot be changed.');
    const allowed = getAllowedTransitions(lead.status);
    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid status transition: ${lead.status} → ${newStatus}. Allowed: ${allowed.join(', ') || 'none'}.`);
    }
    return true;
  }

  function canAddPayment(lead) {
    if (!lead || !user()) return false;
    // Payments can be added even on Won leads (view financials), but NOT on Lost? Spec says payments remain viewable.
    // Spec: Won locked for edits of deal amounts etc, but payments module exists for Won.
    // Allow adding payments on Won (common CRM practice for residual), block on Lost.
    if (isLost(lead)) return false;
    if (isAdmin() || isManager()) return true;
    return canViewLead(lead);
  }

  function canDeletePayment(lead) {
    if (!user()) return false;
    if (lead && isLeadLocked(lead)) return false;
    return isAdmin() || isManager();
  }

  function canUploadDocument(lead) {
    if (!lead || !user()) return false;
    if (isLost(lead)) return false;
    // Won: documents remain viewable; allow upload? Spec says cannot edit won. Block upload on locked.
    if (isWon(lead)) return false;
    if (isAdmin() || isManager()) return true;
    return canViewLead(lead);
  }

  function canDeleteDocument(lead) {
    if (!lead || !user()) return false;
    if (isLeadLocked(lead)) return false;
    return isAdmin() || isManager();
  }

  function canAddFollowup(lead) {
    if (!lead || !user()) return false;
    if (isLeadLocked(lead)) return false;
    if (isAdmin() || isManager()) return true;
    return canViewLead(lead);
  }

  function canCompleteFollowup(lead) {
    if (!lead || !user()) return false;
    if (isLost(lead)) return false;
    if (isAdmin() || isManager()) return true;
    return canViewLead(lead);
  }

  function canManageUsers() {
    return isAdmin();
  }

  function canViewAllLeads() {
    return isAdmin() || isManager();
  }

  function canViewReports() {
    return isAdmin() || isManager();
  }

  function canViewActivityLogs() {
    return isAdmin();
  }

  function canManageSettings() {
    return isAdmin();
  }

  function canBackup() {
    return isAdmin();
  }

  function canViewPayments() {
    return !!user();
  }

  function assertCan(action, lead, extra) {
    const checks = {
      view: () => canViewLead(lead),
      edit: () => canEditLead(lead),
      delete: () => canDeleteLead(lead),
      assign: () => canAssignLead(lead),
      changeStatus: () => canChangeStatus(lead, extra),
      addPayment: () => canAddPayment(lead),
      deletePayment: () => canDeletePayment(lead),
      uploadDocument: () => canUploadDocument(lead),
      deleteDocument: () => canDeleteDocument(lead),
      addFollowup: () => canAddFollowup(lead),
      completeFollowup: () => canCompleteFollowup(lead),
      manageUsers: () => canManageUsers(),
      viewReports: () => canViewReports(),
      manageSettings: () => canManageSettings(),
      backup: () => canBackup()
    };
    const fn = checks[action];
    if (!fn || !fn()) {
      throw new Error('Permission denied: you do not have access to perform this action.');
    }
  }

  function filterLeadsForUser(leads) {
    const u = user();
    if (!u) return [];
    if (isAdmin() || isManager()) return leads;
    return leads.filter(l => l.assignedTo === u.id || l.createdBy === u.id);
  }

  return {
    ROLES, isAdmin, isManager, isExecutive, isManagerOrAdmin,
    isLeadLocked, isWon, isLost,
    canViewLead, canCreateLead, canEditLead, canDeleteLead, canAssignLead,
    canChangeStatus, getAllowedTransitions, validateStatusTransition,
    canAddPayment, canDeletePayment, canUploadDocument, canDeleteDocument,
    canAddFollowup, canCompleteFollowup, canManageUsers, canViewAllLeads,
    canViewReports, canViewActivityLogs, canManageSettings, canBackup,
    canViewPayments, assertCan, filterLeadsForUser
  };
})();