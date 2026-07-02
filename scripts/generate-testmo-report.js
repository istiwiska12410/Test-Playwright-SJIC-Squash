const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

function parseJunitResults(xml) {
  const testResults = [];
  let totalTests = 0;
  let failures = 0;
  let skipped = 0;

  const testcaseRegex = /<testcase\b([^>]*)>/g;
  let match;

  while ((match = testcaseRegex.exec(xml)) !== null) {
    const attrsText = match[1] || '';
    const tagText = match[0] || '';
    const isSelfClosing = /\/>$/.test(tagText.trim());
    const body = isSelfClosing
      ? ''
      : extractBodyBetweenTags(xml, match.index + tagText.length, '</testcase>');

    totalTests += 1;
    const attrs = parseAttributes(attrsText);
    const name = attrs.name ? attrs.name.replace(/\s+/g, ' ').trim() : 'Unnamed Test';

    let status = 'Passed';
    let remark = '-';

    if (/<failure\b/i.test(body)) {
      status = 'Failed';
      failures += 1;
      const msgMatch = body.match(/<failure[^>]*>([\s\S]*?)<\/failure>/i);
      remark = msgMatch ? msgMatch[1].replace(/<[^>]+>/g, '').trim() : 'Test failed';
    } else if (/<skipped\b/i.test(body)) {
      status = 'Skipped';
      skipped += 1;
      const msgMatch = body.match(/<skipped[^>]*>([\s\S]*?)<\/skipped>/i);
      remark = msgMatch ? msgMatch[1].replace(/<[^>]+>/g, '').trim() : 'Skipped';
    }

    testResults.push({
      name,
      status,
      remark,
      elapsed: attrs.time ? formatDuration(attrs.time) : '00:00',
    });
  }

  return {
    totalTests,
    passed: totalTests - failures - skipped,
    failed: failures,
    skipped,
    testResults,
  };
}

function parseAttributes(attrText) {
  const attrs = {};
  const regex = /([\w:-]+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(attrText)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function extractBodyBetweenTags(xml, startIndex, closingTag) {
  const endIndex = xml.indexOf(closingTag, startIndex);
  return endIndex === -1 ? '' : xml.slice(startIndex, endIndex);
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  const mins = Math.floor(value / 60).toString().padStart(2, '0');
  const secs = Math.floor(value % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function parseRecipients(value) {
  if (!value) return [];
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getEmailConfig(env = process.env) {
  return {
    from: env.REPORT_EMAIL_FROM || env.DEFAULT_FROM || 'jenkins@company.com',
    to: parseRecipients(env.REPORT_EMAIL_TO || env.EMAIL_TO),
    cc: parseRecipients(env.REPORT_EMAIL_CC || env.EMAIL_CC),
    subject: env.REPORT_EMAIL_SUBJECT || env.EMAIL_SUBJECT || 'Automation Test Report',
    bodyFile: env.REPORT_EMAIL_BODY_FILE || env.EMAIL_BODY_FILE || '',
  };
}

function buildReportData({
  projectName,
  buildNumber,
  environment,
  executionDate,
  duration,
  testResults,
  testmoUrl,
  subjectPrefix,
}) {
  const summary = {
    totalTestCases: testResults.length,
    passed: testResults.filter((t) => t.status === 'Passed').length,
    failed: testResults.filter((t) => t.status === 'Failed').length,
    skipped: testResults.filter((t) => t.status === 'Skipped').length,
  };

  const resolvedPrefix = subjectPrefix || (summary.failed > 0 ? '🔴 [FAILED]' : '🟢 [PASSED]');

  return {
    subject: `${resolvedPrefix} ${projectName} Automation Report | Build #${buildNumber}`,
    projectName,
    buildNumber,
    environment,
    executionDate,
    duration,
    summary,
    testResults,
    testmoUrl,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderReport(data) {
  const lines = [];
  lines.push('Subject');
  lines.push('');
  lines.push(`${data.subject}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Hello Team,');
  lines.push('');
  lines.push('The automation execution has been completed.');
  lines.push('');
  lines.push('### Execution Information');
  lines.push('');
  lines.push(`ItemValueProject${data.projectName}`);
  lines.push(`BuildBuild ${data.buildNumber}`);
  lines.push(`Environment${data.environment}`);
  lines.push(`Execution Date${data.executionDate}`);
  lines.push(`Duration${data.duration}`);
  lines.push(`Total Test Cases${data.summary.totalTestCases}`);
  lines.push(`Passed${data.summary.passed}`);
  lines.push(`Failed${data.summary.failed}`);
  lines.push(`Skipped${data.summary.skipped}`);
  lines.push('');
  lines.push('### Testmo Report');
  lines.push('');
  lines.push(`🔗 ${data.testmoUrl}`);
  lines.push('');
  lines.push('## Test Case Result');
  lines.push('');
  lines.push('NoTest CaseStatusRemarkElapsed');

  data.testResults.forEach((test, index) => {
    const icon = test.status === 'Failed' ? '🔴' : test.status === 'Skipped' ? '🟡' : '🟢';
    const remark = test.remark || '-';
    const elapsed = test.elapsed || '00:00';
    lines.push(`${index + 1}. ${test.name} ${icon} ${test.status} ${remark} ${elapsed}`);
  });

  lines.push('');
  lines.push('Regards,');
  lines.push('');
  lines.push('Automation Bot');

  return lines.join('\n');
}

function renderHtmlReport(data) {
  const rows = data.testResults.map((test, index) => {
    const icon = test.status === 'Failed' ? '🔴' : test.status === 'Skipped' ? '🟡' : '🟢';
    const statusColor = test.status === 'Failed' ? '#e74c3c' : test.status === 'Skipped' ? '#f1c40f' : '#2ecc71';
    return `<tr style="border-bottom:1px solid #e0e0e0">
      <td style="padding:8px;vertical-align:top">${index + 1}</td>
      <td style="padding:8px;vertical-align:top">${escapeHtml(test.name)}</td>
      <td style="padding:8px;vertical-align:top;color:${statusColor};font-weight:600">${icon} ${escapeHtml(test.status)}</td>
      <td style="padding:8px;vertical-align:top">${escapeHtml(test.remark || '-')}</td>
      <td style="padding:8px;vertical-align:top">${escapeHtml(test.elapsed || '00:00')}</td>
    </tr>`;
  }).join('');

  const testmoLink = data.testmoUrl ? `<a href="${escapeHtml(data.testmoUrl)}">${escapeHtml(data.testmoUrl)}</a>` : '-';

  return `<!doctype html>
<html>
  <body style="font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.5;">
    <h2 style="margin-bottom:0.2em;">${escapeHtml(data.subject)}</h2>
    <p>The automation execution has been completed.</p>

    <h3>Execution Information</h3>
    <table style="border-collapse:collapse;width:100%;max-width:700px;margin-bottom:16px;">
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Project</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(data.projectName)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Build</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(data.buildNumber)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Environment</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(data.environment)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Execution Date</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(data.executionDate)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Duration</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(data.duration)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Total Test Cases</td><td style="padding:8px;border:1px solid #ddd;">${data.summary.totalTestCases}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Passed</td><td style="padding:8px;border:1px solid #ddd;">${data.summary.passed}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Failed</td><td style="padding:8px;border:1px solid #ddd;">${data.summary.failed}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Skipped</td><td style="padding:8px;border:1px solid #ddd;">${data.summary.skipped}</td></tr>
    </table>

    <h3>Testmo Report</h3>
    <p>${testmoLink}</p>

    <h3>Test Case Result</h3>
    <table style="border-collapse:collapse;width:100%;max-width:900px;">
      <thead>
        <tr style="background:#f7f7f7;text-align:left;">
          <th style="padding:10px;border:1px solid #ddd;">No</th>
          <th style="padding:10px;border:1px solid #ddd;">Test Case</th>
          <th style="padding:10px;border:1px solid #ddd;">Status</th>
          <th style="padding:10px;border:1px solid #ddd;">Remark</th>
          <th style="padding:10px;border:1px solid #ddd;">Elapsed</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <p>Regards,<br/>Automation Bot</p>
  </body>
</html>`;
}

function writeReportFile(outputPath, content) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
}

async function sendEmailReport(content, data, env = process.env) {
  const emailConfig = getEmailConfig(env);
  if (!emailConfig.to.length) {
    console.warn('No email recipients configured; skipping email send.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    auth: env.SMTP_USER && env.SMTP_PASS ? {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    } : undefined,
  });

  const message = {
    from: emailConfig.from,
    to: emailConfig.to.join(','),
    cc: emailConfig.cc.join(','),
    subject: emailConfig.subject,
    text: content,
    html: renderHtmlReport(data),
  };

  await transporter.sendMail(message);
  console.log(`Email sent to ${emailConfig.to.join(', ')}`);
}

async function main() {
  const cwd = process.cwd();
  const junitCandidates = [
    process.env.JUNIT_FILE,
    path.join(cwd, 'results', 'test-results.xml'),
    path.join(cwd, 'test-results', 'junit.xml'),
    path.join(cwd, 'test-results', 'test-results.xml'),
  ].filter(Boolean);

  const junitPath = junitCandidates.find((candidate) => fs.existsSync(candidate)) || junitCandidates[0] || path.join(cwd, 'results', 'test-results.xml');
  const outputPath = process.env.TESTMO_REPORT_OUTPUT || path.join(cwd, 'test-results', 'testmo-report.txt');

  const projectName = process.env.TESTMO_PROJECT_NAME || process.env.JOB_NAME || 'Water Treatment';
  const buildNumber = process.env.BUILD_NUMBER || process.env.BUILD_ID || 'local';
  const environment = process.env.TESTMO_ENVIRONMENT || process.env.ENVIRONMENT || process.env.NODE_ENV || 'UAT';
  const executionDate = process.env.TESTMO_EXECUTION_DATE || process.env.BUILD_TIMESTAMP || new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' });
  const duration = process.env.TESTMO_DURATION || process.env.TEST_DURATION || '00:00:00';
  const testmoUrl = process.env.TESTMO_URL || process.env.TESTMO_RUN_URL || 'https://yourcompany.testmo.net/automation/runs/2541';

  if (!fs.existsSync(junitPath)) {
    console.warn(`JUnit file not found at ${junitPath}; creating empty report.`);
  }

  const xml = fs.existsSync(junitPath) ? fs.readFileSync(junitPath, 'utf8') : '<testsuites />';
  const parsed = parseJunitResults(xml);
  const subjectPrefix = process.env.REPORT_SUBJECT_PREFIX || (parsed.failed > 0 ? '🔴 [FAILED]' : '🟢 [PASSED]');
  const data = buildReportData({
    projectName,
    buildNumber,
    environment,
    executionDate,
    duration,
    testResults: parsed.testResults,
    testmoUrl,
    subjectPrefix,
  });

  const content = renderReport(data);
  writeReportFile(outputPath, content);
  console.log(`Generated Testmo report: ${outputPath}`);

  if (process.env.SEND_EMAIL === 'true') {
    await sendEmailReport(content, data);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  parseJunitResults,
  buildReportData,
  renderReport,
  writeReportFile,
  parseRecipients,
  getEmailConfig,
};
