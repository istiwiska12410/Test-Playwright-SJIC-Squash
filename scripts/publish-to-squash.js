const fs = require('fs');
const path = require('path');

const SQUASH_URL = process.env.SQUASH_URL;
const SQUASH_TOKEN = process.env.SQUASH_TOKEN;
const JUNIT_FILE = process.env.JUNIT_FILE || path.join(process.cwd(), 'test-results', 'junit.xml');

const PASS_STATUS = process.env.SQUASH_PASS_STATUS || 'SUCCESS';
const FAIL_STATUS = process.env.SQUASH_FAIL_STATUS || 'FAILURE';
const SKIP_STATUS = process.env.SQUASH_SKIP_STATUS || 'READY';

if (process.env.SQUASH_INSECURE_TLS === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function decodeXml(value = '') {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttributes(attributeText = '') {
  const attrs = {};
  const regex = /([\w:-]+)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(attributeText)) !== null) {
    attrs[match[1]] = decodeXml(match[2]);
  }

  return attrs;
}

function extractItpiId(testName) {
  const match = testName.match(/\[SQUASH_ITPI:(\d+)\]/);
  return match ? match[1] : null;
}

function parseJUnit(xml) {
  const results = [];
  const testcaseRegex = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g;

  let match;

  while ((match = testcaseRegex.exec(xml)) !== null) {
    const attrText = match[1] || match[3] || '';
    const body = match[2] || '';
    const attrs = parseAttributes(attrText);

    const testName = attrs.name || '';
    const itpiId = extractItpiId(testName);

    if (!itpiId) {
      console.warn(`SKIP: Test "${testName}" tidak punya tag [SQUASH_ITPI:ID]`);
      continue;
    }

    const isFailed = /<failure\b|<error\b/.test(body);
    const isSkipped = /<skipped\b/.test(body);

    let squashStatus = PASS_STATUS;

    if (isFailed) {
      squashStatus = FAIL_STATUS;
    } else if (isSkipped) {
      squashStatus = SKIP_STATUS;
    }

    results.push({
      itpiId,
      testName,
      squashStatus
    });
  }

  return results;
}

async function patchItpiStatus(itpiId, status) {
  const base = SQUASH_URL.replace(/\/+$/, '');
  const url = `${base}/api/rest/latest/iteration-test-plan-items/${itpiId}`;

  const payload = {
    _type: 'iteration-test-plan-item',
    execution_status: status
  };

  console.log(`PATCH ITPI ${itpiId} => ${status}`);

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${SQUASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseBody = await response.text();

  if (response.ok) {
    console.log(`OK: ITPI ${itpiId} updated to ${status}`);
    return;
  }

  console.error(`FAILED: ITPI ${itpiId}, HTTP ${response.status}`);
  if (responseBody) {
    console.error(responseBody);
  }

  throw new Error(`Failed to update ITPI ${itpiId}`);
}

async function main() {
  if (!SQUASH_URL) fail('SQUASH_URL is empty');
  if (!SQUASH_TOKEN) fail('SQUASH_TOKEN is empty');
  if (!fs.existsSync(JUNIT_FILE)) fail(`JUnit file not found: ${JUNIT_FILE}`);

  const xml = fs.readFileSync(JUNIT_FILE, 'utf8');
  const results = parseJUnit(xml);

  if (results.length === 0) {
    fail('Tidak ada test yang punya tag [SQUASH_ITPI:ID] di junit.xml');
  }

  console.log(`Found ${results.length} mapped test(s)`);

  for (const result of results) {
    console.log(`${result.testName} => ITPI ${result.itpiId} => ${result.squashStatus}`);
    await patchItpiStatus(result.itpiId, result.squashStatus);
  }

  console.log('DONE: Squash ITPI statuses updated.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});