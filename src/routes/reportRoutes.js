const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { requireAdmin } = require('../controllers/adminController');

// Public route: Submit a report
router.post('/submit', reportController.submitReport);

// Admin routes: Manage reports
router.get('/', requireAdmin, reportController.getReports);
router.patch('/:id', requireAdmin, reportController.updateReportStatus);
router.delete('/:id', requireAdmin, reportController.deleteReport);

module.exports = router;
