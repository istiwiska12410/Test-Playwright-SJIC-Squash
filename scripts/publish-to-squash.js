const fs = require('fs');
const path = require('path');

const SQUASH_URL = process.env.SQUASH_URL;
const SQUASH_TOKEN = process.env.SQUASH_TOKEN;
const SQUASH_ITERATION_ID = process.env.SQUASH_ITERATION_ID;
const JUNIT_FILE = process.env.JUNIT_FILE || path.join(process.cwd(), 'test-results', 'junit.xml');

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

function stripXmlTags(value = '') {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function extractSquashReference(testName) {
  const match = testName.match(/\[SQUASH:([^\]]+)\]/);
  if (!match) return null;

  return match[1].trim();
}

function parseJUnit(xml) {
  const tests = [];

  const testcaseRegex = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g;
  let match;

  while ((match = testcaseRegex.exec(xml)) !== null) {
    const attrText = match[1] || match[3] || '';
    const body = match[2] || '';
    const attrs = parseAttributes(attrText);

    const testName = attrs.name || '';
    const reference = extractSquashReference(testName);

    if (!reference) {
      console.warn(`SKIP: Test "${testName}" tidak punya tag [SQUASH:...]`);
      continue;
    }

    const timeSeconds = Number(attrs.time || '0');
    const durationMs = Number.isFinite(timeSeconds) ? Math.round(timeSeconds * 1000) : 0;

    const failureMatch = body.match(/<failure\b[^>]*>([\s\S]*?)<\/failure>/);
    const errorMatch = body.match(/<error\b[^>]*>([\s\S]*?)<\/error>/);
    const skippedMatch = body.match(/<skipped\b[^>]*\/>|<skipped\b[^>]*>([\s\S]*?)<\/skipped>/);

    let status = 'SUCCESS';
    const failureDetails = [];

    if (failureMatch || errorMatch) {
      status = 'FAILURE';

      const rawFailure = failureMatch ? failureMatch[1] : errorMatch[1];
      const cleanFailure = stripXmlTags(decodeXml(rawFailure || ''));

      if (cleanFailure) {
        failureDetails.push(cleanFailure.slice(0, 4000));
      } else {
        failureDetails.push('Test failed');
      }
    } else if (skippedMatch) {
      status = 'SKIPPED';
    }

    const result = {
      reference,
      status,
      duration: durationMs
    };

    if (failureDetails.length > 0) {
      result.failure_details = failureDetails;
    }

    tests.push(result);
  }

  return tests;
}

function base64File(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

async function uploadToSquash(payload) {
  const base = SQUASH_URL.replace(/\/+$/, '');
  const url = `${base}/api/rest/latest/import/results/${SQUASH_ITERATION_ID}`;

  console.log(`Uploading result to Squash: ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SQUASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseBody = await response.text();

  if (response.status === 204) {
    console.log('SUCCESS: Results uploaded to Squash. Status: 204 No Content');
    return;
  }

  if (response.status === 207) {
    console.error('PARTIAL SUCCESS: Some results were not imported. Status: 207');
    console.error(responseBody);
    process.exit(2);
  }

  console.error(`FAILED: Squash returned HTTP ${response.status}`);
  if (responseBody) {
    console.error(responseBody);
  }

  process.exit(1);
}

async function main() {
  if (!SQUASH_URL) fail('SQUASH_URL is empty');
  if (!SQUASH_TOKEN) fail('SQUASH_TOKEN is empty');
  if (!SQUASH_ITERATION_ID) fail('SQUASH_ITERATION_ID is empty');
  if (!fs.existsSync(JUNIT_FILE)) fail(`JUnit file not found: ${JUNIT_FILE}`);

  const xml = fs.readFileSync(JUNIT_FILE, 'utf8');
  const tests = parseJUnit(xml);

  if (tests.length === 0) {
    fail('No test with [SQUASH:...] tag found in JUnit report');
  }

  const payload = {
    automated_test_suite: {
      attachments: [
        {
          name: 'junit.xml',
          content: base64File(JUNIT_FILE)
        }
      ]
    },
    tests
  };

  const payloadPath = path.join(process.cwd(), 'test-results', 'squash-result-payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Parsed tests: ${tests.length}`);
  console.log(`Payload saved: ${payloadPath}`);

  await uploadToSquash(payload);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});