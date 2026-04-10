const Report = require('../db/models/reportModel');
const emailService = require('../services/emailService');

/**
 * Public/User: Submit a new bug or support report.
 * Works for both registered users and guests.
 */
async function submitReport(req, res, next) {
  try {
    const { type, title, description, email, userId } = req.body;

    if (!type || !title || !description || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Type, title, description, and email are required.' 
      });
    }

    const report = new Report({
      userId: userId || null,
      email,
      type,
      title,
      description,
    });

    await report.save();

    // Send email notification ONLY for General Support as per user request
    if (type === 'support') {
      await emailService.sendAdminNotification(report);
    }

    res.json({ 
      success: true, 
      message: 'Report submitted successfully. Thank you for your feedback!' 
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Admin only: Get all reports, sorted by newest first.
 */
async function getReports(req, res, next) {
  try {
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json({ success: true, reports });
  } catch (error) {
    next(error);
  }
}

/**
 * Admin only: Update report status (e.g., mark as resolved).
 */
async function updateReportStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const report = await Report.findByIdAndUpdate(
      id, 
      { status }, 
      { new: true }
    );

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found.' });
    }

    res.json({ success: true, report });
  } catch (error) {
    next(error);
  }
}

/**
 * Admin only: Delete a report.
 */
async function deleteReport(req, res, next) {
  try {
    const { id } = req.params;
    await Report.findByIdAndDelete(id);
    res.json({ success: true, message: 'Report deleted.' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  submitReport,
  getReports,
  updateReportStatus,
  deleteReport
};
