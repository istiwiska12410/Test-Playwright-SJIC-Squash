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

async function getItpiStatus(itpiId) {
  const base = SQUASH_URL.replace(/\/+$/, '');
  const url = `${base}/api/rest/latest/iteration-test-plan-items/${itpiId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${SQUASH_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  const body = await response.text();

  if (!response.ok) {
    console.error(`FAILED GET ITPI ${itpiId}, HTTP ${response.status}`);
    console.error(body);
    throw new Error(`Failed to get ITPI ${itpiId}`);
  }

  return JSON.parse(body);
}

async function patchItpiStatus(itpiId, status) {
  const base = SQUASH_URL.replace(/\/+$/, '');
  const url = `${base}/backend/test-plan-item/${itpiId}/execution-status`;

  const payload = {
    executionStatus: status
  };

  console.log(`POST ITPI ${itpiId} => ${status}`);
  console.log(`URL: ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SQUASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseBody = await response.text();

  console.log(`POST response HTTP ${response.status}`);
  if (responseBody) {
    console.log(`POST response body: ${responseBody}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to update ITPI ${itpiId}`);
  }

  const updated = await getItpiStatus(itpiId);
  console.log(`AFTER POST ITPI ${itpiId} execution_status = ${updated.execution_status}`);

  if (updated.execution_status !== status) {
    throw new Error(
      `ITPI ${itpiId} not updated. Expected ${status}, actual ${updated.execution_status}`
    );
  }

  console.log(`OK: ITPI ${itpiId} verified as ${status}`);
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