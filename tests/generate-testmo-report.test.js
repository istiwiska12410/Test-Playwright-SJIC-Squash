const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJunitResults, buildReportData, renderReport, parseRecipients, getEmailConfig } = require('../scripts/generate-testmo-report');

test('parses JUnit XML and renders a Jenkins/Testmo-friendly report', () => {
  const xml = `
  <testsuites tests="3" failures="1" skipped="1" time="12.34">
    <testsuite name="Water Treatment" tests="3" failures="1" skipped="1" time="12.34">
      <testcase classname="auth" name="Login successfully" time="1.2" />
      <testcase classname="category" name="Create Category" time="3.5">
        <failure message="Expected element not found">not found</failure>
      </testcase>
      <testcase classname="category" name="Delete Category" time="2.8">
        <skipped message="Skipped in CI" />
      </testcase>
    </testsuite>
  </testsuites>`;

  const parsed = parseJunitResults(xml);
  assert.equal(parsed.totalTests, 3);
  assert.equal(parsed.passed, 1);
  assert.equal(parsed.failed, 1);
  assert.equal(parsed.skipped, 1);

  const reportData = buildReportData({
    projectName: process.env.TESTMO_PROJECT_NAME || 'Water Treatment',
    buildNumber: process.env.BUILD_NUMBER || process.env.BUILD_ID || '45',
    environment: process.env.TESTMO_ENVIRONMENT || 'UAT',
    executionDate: process.env.TESTMO_EXECUTION_DATE || '02-Jul-2026 09:30',
    duration: process.env.TESTMO_DURATION || '00:12:41',
    testResults: parsed.testResults,
    testmoUrl: process.env.TESTMO_URL || process.env.TESTMO_RUN_URL || 'https://yourcompany.testmo.net/automation/runs/2541',
  });

  assert.equal(reportData.summary.totalTestCases, 3);
  assert.equal(reportData.summary.failed, 1);
  assert.equal(reportData.summary.passed, 1);

  const rendered = renderReport(reportData);
  assert.match(rendered, /Subject/);
  assert.match(rendered, /Water Treatment Automation Report/);
  assert.match(rendered, /Create Category/);
  assert.match(rendered, /Testmo Report/);
});

test('parses recipient lists and builds email config from environment variables', () => {
  const recipients = parseRecipients('qa@company.com, dev@company.com; lead@company.com');
  assert.deepEqual(recipients, ['qa@company.com', 'dev@company.com', 'lead@company.com']);

  const emailConfig = getEmailConfig({
    REPORT_EMAIL_FROM: 'jenkins@company.com',
    REPORT_EMAIL_TO: 'qa@company.com, dev@company.com',
    REPORT_EMAIL_CC: 'lead@company.com',
    REPORT_EMAIL_SUBJECT: 'Custom subject',
  });

  assert.equal(emailConfig.from, 'jenkins@company.com');
  assert.deepEqual(emailConfig.to, ['qa@company.com', 'dev@company.com']);
  assert.deepEqual(emailConfig.cc, ['lead@company.com']);
  assert.equal(emailConfig.subject, 'Custom subject');
});
