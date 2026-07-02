const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const nodemailer = require('nodemailer');

function parseAttributes(attrText) {
  const attrs = {};
  const regex = /([\w:-]+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(attrText || '')) !== null) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(value) {
  return decodeXml(String(value || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
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

function parseJunitResults(xml) {
  const testResults = [];
  const testcaseRegex = /<testcase\b([^>]*?)(\/?)>/g;
  let match;

  while ((match = testcaseRegex.exec(xml || '')) !== null) {
    const attrs = parseAttributes(match[1] || '');
    const fullTag = match[0] || '';
    const isSelfClosing = /\/>$/.test(fullTag.trim());
    const body = isSelfClosing
      ? ''
      : extractBodyBetweenTags(xml, match.index + fullTag.length, '</testcase>');

    let status = 'Passed';
    let remark = '-';

    if (/<failure\b/i.test(body) || /<error\b/i.test(body)) {
      status = 'Failed';
      const msgMatch = body.match(/<(failure|error)[^>]*>([\s\S]*?)<\/\1>/i);
      remark = msgMatch ? stripTags(msgMatch[2]) : 'Test failed';
    } else if (/<skipped\b/i.test(body)) {
      status = 'Skipped';
      const msgMatch = body.match(/<skipped[^>]*>([\s\S]*?)<\/skipped>/i);
      remark = msgMatch ? stripTags(msgMatch[1]) : 'Skipped';
    }

    testResults.push({
      name: attrs.name ? attrs.name.replace(/\s+/g, ' ').trim() : 'Unnamed Test',
      classname: attrs.classname || '',
      status,
      remark: remark || '-',
      elapsed: attrs.time ? formatDuration(attrs.time) : '00:00',
    });
  }

  return {
    totalTests: testResults.length,
    passed: testResults.filter((t) => t.status === 'Passed').length,
    failed: testResults.filter((t) => t.status === 'Failed').length,
    skipped: testResults.filter((t) => t.status === 'Skipped').length,
    testResults,
  };
}

function parseRecipients(value) {
  if (!value) return [];
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildTestmoRunUrl(runId, env = process.env) {
  if (!runId || !env.TESTMO_URL) return null;
  return `${trimTrailingSlash(env.TESTMO_URL)}/automation/runs/view/${runId}`;
}

function extractTestmoRunUrl(output, env = process.env) {
  const text = String(output || '');

  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+\/automation\/runs(?:\/view)?\/\d+\b/i);
  if (urlMatch) {
    let url = urlMatch[0].replace(/[)\].,;]+$/, '');
    if (/\/automation\/runs\/\d+\b/i.test(url) && !/\/automation\/runs\/view\/\d+\b/i.test(url)) {
      url = url.replace('/automation/runs/', '/automation/runs/view/');
    }
    return url;
  }

  const idPatterns = [
    /automation\s+run\s+(?:id\s*)?[:#]?\s*(\d{1,10})/i,
    /run\s+id\s*[:#]?\s*(\d{1,10})/i,
    /created\s+run\s*[:#]?\s*(\d{1,10})/i,
    /run_id["'\s:=]+(\d{1,10})/i,
  ];

  for (const pattern of idPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return buildTestmoRunUrl(match[1], env);
    }
  }

  return null;
}

function findTestmoCmd(env = process.env) {
  if (env.TESTMO_CMD && fs.existsSync(env.TESTMO_CMD)) {
    return env.TESTMO_CMD;
  }

  if (env.NPM_GLOBAL_PREFIX) {
    const candidates = [
      path.join(env.NPM_GLOBAL_PREFIX, 'testmo.cmd'),
      path.join(env.NPM_GLOBAL_PREFIX, 'bin', 'testmo.cmd'),
      path.join(env.NPM_GLOBAL_PREFIX, 'node_modules', '.bin', 'testmo.cmd'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return 'npx';
}

function quoteArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function runCommand(command, args, env = process.env) {
  const commandLine = [quoteArg(command), ...args.map(quoteArg)].join(' ');
  const result = spawnSync(commandLine, {
    shell: true,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (output.trim()) console.log(output.trim());

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${commandLine}`);
  }

  return output;
}

function publishTestmoResults(env = process.env) {
  const junitFile = env.JUNIT_FILE || path.join('test-results', 'junit.xml');

  if (!env.TESTMO_TOKEN) {
    throw new Error('Missing TESTMO_TOKEN. Add Jenkins secret text credential with id: testmo-api-key.');
  }

  if (!fs.existsSync(junitFile)) {
    throw new Error(`JUnit file not found: ${junitFile}`);
  }

  const testmoCmd = findTestmoCmd(env);
  const args = [
    'automation:run:submit',
    '--instance', env.TESTMO_URL,
    '--project-id', env.TESTMO_PROJECT_ID,
    '--name', `${env.TESTMO_RUN_NAME || 'Automation Run'} - Build #${env.BUILD_NUMBER || env.BUILD_ID || 'local'}`,
    '--source', env.TESTMO_SOURCE,
    '--results', junitFile,
  ];

  if (testmoCmd === 'npx') {
    args.unshift('@testmo/testmo-cli');
  }

  console.log('Publishing results to Testmo...');
  console.log(`Using Testmo command: ${testmoCmd}`);
  console.log(`JUnit file: ${junitFile}`);
  console.log('TESTMO_TOKEN: ***HIDDEN***');

  const output = runCommand(testmoCmd, args, {
    ...process.env,
    ...env,
  });

  const runUrl = extractTestmoRunUrl(output, env);
  if (runUrl) {
    console.log(`Detected Testmo run URL: ${runUrl}`);
    return runUrl;
  }

  console.warn('Testmo publish succeeded, but no specific run URL was detected from CLI output.');
  return env.TESTMO_RUN_URL || env.TESTMO_URL || '';
}

function getEmailConfig(env = process.env) {
  return {
    from: env.REPORT_EMAIL_FROM || env.SMTP_USER || 'jenkins@company.com',
    to: parseRecipients(env.REPORT_EMAIL_TO || env.EMAIL_TO),
    cc: parseRecipients(env.REPORT_EMAIL_CC || env.EMAIL_CC),
    baseSubject: env.REPORT_EMAIL_SUBJECT || env.EMAIL_SUBJECT || 'Automation Test Report',
  };
}

function buildReportData({
  projectName,
  buildNumber,
  environment,
  executionDate,
  duration,
  parsed,
  testmoUrl,
  jenkinsBuildUrl,
  emailBaseSubject,
  publishError,
}) {
  const summary = {
    totalTestCases: parsed.totalTests,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
  };

  const resolvedPrefix = summary.failed > 0 ? '🔴 [FAILED]' : '🟢 [PASSED]';

  return {
    subject: `${resolvedPrefix} ${emailBaseSubject} | Build #${buildNumber}`,
    projectName,
    buildNumber,
    environment,
    executionDate,
    duration,
    summary,
    testResults: parsed.testResults,
    testmoUrl,
    jenkinsBuildUrl,
    publishError,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTextReport(data) {
  const lines = [];
  lines.push(data.subject);
  lines.push('');
  lines.push('Hello Team,');
  lines.push('');
  lines.push('The automation execution has been completed.');
  lines.push('');
  lines.push('Execution Information');
  lines.push(`Project          : ${data.projectName}`);
  lines.push(`Build            : ${data.buildNumber}`);
  lines.push(`Environment      : ${data.environment}`);
  lines.push(`Execution Date   : ${data.executionDate}`);
  lines.push(`Duration         : ${data.duration}`);
  lines.push(`Total Test Cases : ${data.summary.totalTestCases}`);
  lines.push(`Passed           : ${data.summary.passed}`);
  lines.push(`Failed           : ${data.summary.failed}`);
  lines.push(`Skipped          : ${data.summary.skipped}`);
  lines.push('');
  lines.push(`Testmo Report    : ${data.testmoUrl || '-'}`);
  if (data.jenkinsBuildUrl) lines.push(`Jenkins Build    : ${data.jenkinsBuildUrl}`);
  if (data.publishError) lines.push(`Testmo Publish   : FAILED - ${data.publishError}`);
  lines.push('');
  lines.push('Test Case Result');
  lines.push('No | Test Case | Status | Remark | Elapsed');

  data.testResults.forEach((test, index) => {
    lines.push(`${index + 1} | ${test.name} | ${test.status} | ${test.remark || '-'} | ${test.elapsed || '00:00'}`);
  });

  lines.push('');
  lines.push('Regards,');
  lines.push('Automation Bot');

  return lines.join('\n');
}

function renderHtmlReport(data) {
  const rows = data.testResults.map((test, index) => {
    const icon = test.status === 'Failed' ? '🔴' : test.status === 'Skipped' ? '🟡' : '🟢';
    const color = test.status === 'Failed' ? '#d93025' : test.status === 'Skipped' ? '#b06000' : '#188038';

    return `<tr>
      <td style="padding:8px;border:1px solid #ddd;">${index + 1}</td>
      <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(test.name)}</td>
      <td style="padding:8px;border:1px solid #ddd;color:${color};font-weight:700;">${icon} ${escapeHtml(test.status)}</td>
      <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(test.remark || '-')}</td>
      <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(test.elapsed || '00:00')}</td>
    </tr>`;
  }).join('');

  const testmoLink = data.testmoUrl
    ? `<a href="${escapeHtml(data.testmoUrl)}">${escapeHtml(data.testmoUrl)}</a>`
    : '-';

  const jenkinsLink = data.jenkinsBuildUrl
    ? `<a href="${escapeHtml(data.jenkinsBuildUrl)}">${escapeHtml(data.jenkinsBuildUrl)}</a>`
    : '-';

  const publishWarning = data.publishError
    ? `<p style="color:#d93025;"><b>Testmo publish failed:</b> ${escapeHtml(data.publishError)}</p>`
    : '';

  return `<!doctype html>
<html>
  <body style="font-family:Arial,Helvetica,sans-serif;color:#333;line-height:1.5;">
    <h2 style="margin-bottom:8px;">${escapeHtml(data.subject)}</h2>
    <p>Hello Team,</p>
    <p>The automation execution has been completed.</p>
    ${publishWarning}

    <h3>Execution Information</h3>
    <table style="border-collapse:collapse;width:100%;max-width:760px;">
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Project</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(data.projectName)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Build</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(data.buildNumber)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Environment</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(data.environment)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Execution Date</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(data.executionDate)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Duration</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(data.duration)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Total Test Cases</td><td style="padding:8px;border:1px solid #ddd;">${data.summary.totalTestCases}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Passed</td><td style="padding:8px;border:1px solid #ddd;color:#188038;font-weight:700;">${data.summary.passed}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Failed</td><td style="padding:8px;border:1px solid #ddd;color:#d93025;font-weight:700;">${data.summary.failed}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Skipped</td><td style="padding:8px;border:1px solid #ddd;">${data.summary.skipped}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Testmo Report</td><td style="padding:8px;border:1px solid #ddd;">${testmoLink}</td></tr>
      <tr><td style="padding:8px;border:1px solid #ddd;font-weight:700;">Jenkins Build</td><td style="padding:8px;border:1px solid #ddd;">${jenkinsLink}</td></tr>
    </table>

    <h3>Test Case Result</h3>
    <table style="border-collapse:collapse;width:100%;max-width:980px;">
      <thead>
        <tr style="background:#f7f7f7;text-align:left;">
          <th style="padding:10px;border:1px solid #ddd;">No</th>
          <th style="padding:10px;border:1px solid #ddd;">Test Case</th>
          <th style="padding:10px;border:1px solid #ddd;">Status</th>
          <th style="padding:10px;border:1px solid #ddd;">Remark</th>
          <th style="padding:10px;border:1px solid #ddd;">Elapsed</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p>Regards,<br/>Automation Bot</p>
  </body>
</html>`;
}

function writeReportFile(outputPath, content) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf8');
}

function createTransport(env = process.env) {
  const isGmail = /(^|\.)gmail\.com$/i.test(env.SMTP_HOST || '') || /@gmail\.com$/i.test(env.SMTP_USER || '');
  const pass = isGmail ? String(env.SMTP_PASS || '').replace(/\s+/g, '') : env.SMTP_PASS;

  if (!env.SMTP_USER || !pass) {
    throw new Error('SMTP_USER or SMTP_PASS is missing. Add gmail-app-password credential in Jenkins.');
  }

  if (isGmail) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: env.SMTP_USER,
        pass,
      },
      logger: env.SMTP_DEBUG === 'true',
      debug: env.SMTP_DEBUG === 'true',
    });
  }

  const secure = env.SMTP_SECURE === 'true';
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure,
    requireTLS: !secure,
    auth: {
      user: env.SMTP_USER,
      pass,
    },
    tls: {
      rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
    },
    logger: env.SMTP_DEBUG === 'true',
    debug: env.SMTP_DEBUG === 'true',
  });
}

async function sendEmailReport(textContent, htmlContent, data, outputPath, env = process.env) {
  const emailConfig = getEmailConfig(env);

  if (!emailConfig.to.length) {
    throw new Error('No email recipients configured. Set REPORT_EMAIL_TO.');
  }

  const transporter = createTransport(env);

  console.log(`Email from=${emailConfig.from} to=${emailConfig.to.join(', ')} cc=${emailConfig.cc.join(', ') || '-'}`);

  await transporter.verify();

  const attachments = [];
  if (env.JUNIT_FILE && fs.existsSync(env.JUNIT_FILE)) {
    attachments.push({ filename: path.basename(env.JUNIT_FILE), path: env.JUNIT_FILE });
  }
  if (outputPath && fs.existsSync(outputPath)) {
    attachments.push({ filename: path.basename(outputPath), path: outputPath });
  }

  const info = await transporter.sendMail({
    from: emailConfig.from,
    to: emailConfig.to.join(','),
    cc: emailConfig.cc.join(',') || undefined,
    subject: data.subject,
    text: textContent,
    html: htmlContent,
    attachments,
  });

  console.log(`Email sent successfully. MessageId: ${info.messageId}`);
}

function getExistingJunitPath(env = process.env) {
  const cwd = process.cwd();
  const candidates = [
    env.JUNIT_FILE,
    path.join(cwd, 'test-results', 'junit.xml'),
    path.join(cwd, 'results', 'test-results.xml'),
    path.join(cwd, 'test-results', 'test-results.xml'),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

async function main() {
  const cwd = process.cwd();
  const junitPath = getExistingJunitPath(process.env);
  const outputPath = process.env.TESTMO_REPORT_OUTPUT || path.join(cwd, 'test-results', 'testmo-report.txt');

  const xml = fs.existsSync(junitPath) ? fs.readFileSync(junitPath, 'utf8') : '<testsuites />';
  const parsed = parseJunitResults(xml);

  const projectName = process.env.TESTMO_PROJECT_NAME || process.env.JOB_NAME || 'Automation Project';
  const buildNumber = process.env.BUILD_NUMBER || process.env.BUILD_ID || 'local';
  const environment = process.env.TESTMO_ENVIRONMENT || process.env.ENVIRONMENT || 'UAT';
  const executionDate = process.env.TESTMO_EXECUTION_DATE || new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' });
  const duration = process.env.TESTMO_DURATION || process.env.TEST_DURATION || '00:00:00';
  const emailBaseSubject = getEmailConfig(process.env).baseSubject;

  let testmoUrl = process.env.TESTMO_RUN_URL || '';
  let publishError = '';

  try {
    testmoUrl = publishTestmoResults({
      ...process.env,
      JUNIT_FILE: junitPath,
    });
  } catch (error) {
    publishError = error.message || String(error);
    console.error(`Testmo publish failed: ${publishError}`);
    testmoUrl = process.env.TESTMO_RUN_URL || process.env.TESTMO_URL || '';
  }

  const data = buildReportData({
    projectName,
    buildNumber,
    environment,
    executionDate,
    duration,
    parsed,
    testmoUrl,
    jenkinsBuildUrl: process.env.BUILD_URL || '',
    emailBaseSubject,
    publishError,
  });

  const textContent = renderTextReport(data);
  const htmlContent = renderHtmlReport(data);

  writeReportFile(outputPath, textContent);
  console.log(`Generated email report file: ${outputPath}`);

  if (process.env.SEND_EMAIL === 'true') {
    await sendEmailReport(textContent, htmlContent, data, outputPath, process.env);
  } else {
    console.log('SEND_EMAIL is not true; skipping email send.');
  }

  if (publishError && process.env.FAIL_ON_TESTMO_ERROR !== 'false') {
    throw new Error(`Testmo publish failed after email step: ${publishError}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  parseJunitResults,
  extractTestmoRunUrl,
  buildTestmoRunUrl,
  renderTextReport,
  renderHtmlReport,
  parseRecipients,
};
