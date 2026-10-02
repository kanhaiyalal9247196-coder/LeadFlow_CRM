/* LeadFlow CRM - Attachments / Documents */
const Attachments = (() => {
  async function upload({ file, leadId, paymentId, followupId }) {
    if (!file) throw new Error('No file provided.');
    if (!leadId) throw new Error('Lead ID is required.');

    const lead = await DB.get('leads', leadId);
    if (!lead) throw new Error('Lead not found.');

    if (Permissions.isLeadLocked(lead) && !paymentId && !followupId) {
      throw new Error('Cannot upload documents to locked (Won/Lost) leads.');
    }
    if (!paymentId && !followupId && !Permissions.canUploadDocument(lead)) {
      throw new Error('Permission denied.');
    }

    const check = Utils.isAllowedFile(file);
    if (!check.ok) throw new Error(check.error);

    const maxMB = await DB.getSetting('maxUploadSize', 5);
    const maxBytes = maxMB * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`File size exceeds maximum of ${maxMB} MB.`);
    }

    const u = Auth.getCurrentUser();
    const blob = file instanceof Blob ? file : new Blob([file], { type: file.type });

    const attachment = {
      id: Utils.uid(),
      leadId,
      paymentId: paymentId || null,
      followupId: followupId || null,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      extension: check.ext,
      uploadedBy: u.id,
      uploadedByName: u.name,
      uploadedAt: Utils.now(),
      blob
    };

    await DB.add('attachments', attachment);

    if (!paymentId && !followupId) {
      await Audit.logCurrent('Attachment Uploaded', `${file.name} uploaded to ${lead.enquiryNo}`, leadId);
    }

    return attachment;
  }

  async function remove(id) {
    const att = await DB.get('attachments', id);
    if (!att) throw new Error('Attachment not found.');

    const lead = await DB.get('leads', att.leadId);
    if (lead && Permissions.isLeadLocked(lead)) {
      throw new Error('Cannot delete documents from locked (Won/Lost) leads.');
    }
    if (!Permissions.canDeleteDocument(lead)) {
      throw new Error('Permission denied.');
    }

    await DB.remove('attachments', id);
    await Audit.logCurrent('Attachment Deleted', `${att.fileName} deleted`, att.leadId);
    return true;
  }

  async function getByLead(leadId) {
    const items = await DB.getByIndex('attachments', 'leadId', leadId);
    // Exclude payment/followup-specific unless general docs
    return items
      .filter(a => !a.paymentId && !a.followupId)
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  }

  async function getById(id) {
    return DB.get('attachments', id);
  }

  async function download(id) {
    const att = await DB.get('attachments', id);
    if (!att || !att.blob) throw new Error('File not found.');
    Utils.downloadBlob(att.blob, att.fileName);
  }

  function isImage(att) {
    return ['jpg', 'jpeg', 'png'].includes((att.extension || '').toLowerCase()) ||
      (att.mimeType || '').startsWith('image/');
  }

  function isPdf(att) {
    return (att.extension || '').toLowerCase() === 'pdf' || att.mimeType === 'application/pdf';
  }

  function getObjectUrl(att) {
    if (!att.blob) return null;
    return URL.createObjectURL(att.blob);
  }

  return { upload, remove, getByLead, getById, download, isImage, isPdf, getObjectUrl };
})();