#!/usr/bin/env node
/**
 * AI Code Review — calls Claude to scan public/ for bugs before deploy.
 * - Writes findings to GitHub Actions step summary
 * - Creates GitHub Issues for CRITICAL findings
 * - Sends Slack notification with results + issue links
 * Never blocks the deploy — just surfaces issues clearly.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;
const REPO = process.env.GITHUB_REPOSITORY; // e.g. "kevinsamy/torchlit-website"
const COMMIT_SHA = (process.env.COMMIT_SHA || '').slice(0, 7);
const COMMIT_MESSAGE = process.env.COMMIT_MESSAGE || '(no message)';
const COMMIT_AUTHOR = process.env.COMMIT_AUTHOR || 'unknown';

if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set — skipping review.');
  process.exit(0);
}

// --- HTTP helper (returns parsed JSON) ---
function httpPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(bodyStr) } },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// --- Collect files from public/ ---
function collectFiles(dir, base = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let output = '';
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      output += collectFiles(full, base);
    } else if (/\.(html|css|js|json)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      if (content.length < 40000) {
        output += `\n\n===== ${rel} =====\n${content}`;
      } else {
        output += `\n\n===== ${rel} ===== [file too large — ${content.length} chars]`;
      }
    }
  }
  return output;
}

// --- Parse CRITICAL lines from review text ---
function parseCriticals(review) {
  const lines = review.split('\n');
  return lines.filter(l => l.includes('[CRITICAL]') || l.includes('**CRITICAL**'));
}

// --- Create a GitHub Issue ---
async function createIssue(title, body) {
  if (!GITHUB_TOKEN || !REPO) return null;
  try {
    const res = await httpPost(
      'api.github.com',
      `/repos/${REPO}/issues`,
      {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'torchlit-ai-review'
      },
      { title, body, labels: ['bug', 'ai-review'] }
    );
    if (res.status === 201) {
      console.log(`Created issue #${res.body.number}: ${res.body.html_url}`);
      return res.body.html_url;
    } else {
      console.error('Issue creation failed:', res.status, JSON.stringify(res.body));
      return null;
    }
  } catch (e) {
    console.error('Issue creation error:', e.message);
    return null;
  }
}

// --- Send Slack notification ---
async function sendSlack(review, criticalCount, issueUrls) {
  if (!SLACK_WEBHOOK) return;
  const emoji = criticalCount > 0 ? ':red_circle:' : ':white_check_mark:';
  const status = criticalCount > 0
    ? `${criticalCount} CRITICAL issue(s) found — GitHub Issues created`
    : 'No critical issues — all clear';

  let issueSection = '';
  if (issueUrls.length > 0) {
    issueSection = '\n\n*Issues created:*\n' + issueUrls.map(u => `• ${u}`).join('\n');
    issueSection += '\n\n_To fix: open the issue, copy findings into a Cursor background agent._';
  }

  const text = `${emoji} *TorchLit AI Review* | \`${COMMIT_SHA}\` by ${COMMIT_AUTHOR}\n>${COMMIT_MESSAGE.split('\n')[0].slice(0, 80)}\n\n*${status}*${issueSection}`;

  try {
    const res = await httpPost(
      'hooks.slack.com',
      new URL(SLACK_WEBHOOK).pathname,
      { 'Content-Type': 'application/json' },
      { text }
    );
    console.log('Slack notification sent:', res.status);
  } catch (e) {
    console.error('Slack error:', e.message);
  }
}

// --- Main ---
async function main() {
  const code = collectFiles('./public');

  const prompt = `You are a senior web developer doing a pre-deploy code review. Review the following website files for:
- JavaScript bugs (runtime errors, broken logic, event listener issues)
- HTML issues (broken structure, missing attributes, accessibility problems)
- CSS issues (layout bugs, missing fallbacks)
- Security issues (XSS risks, exposed secrets)
- Any other problems that would break the live site

Format your response as:
## Summary
(one sentence)

## Issues Found
For each issue use this format:
**[CRITICAL|WARNING|INFO]** \`filename:line\` — description and suggested fix

If no issues, say so clearly. Be specific and concise.

---FILES---\n${code}`;

  console.log('Sending code to Claude for review...');

  let review;
  try {
    const res = await httpPost(
      'api.anthropic.com',
      '/v1/messages',
      {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      { model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }
    );
    if (res.body.error) {
      console.error('Claude API error:', res.body.error.message);
      process.exit(0);
    }
    review = res.body.content?.[0]?.text || 'No review returned.';
  } catch (e) {
    console.error('Claude request failed:', e.message);
    process.exit(0);
  }

  // Print to console
  console.log('\n====== AI REVIEW RESULTS ======\n');
  console.log(review);
  console.log('\n================================\n');

  // Write to GitHub Step Summary
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile,
      `# AI Code Review — \`${COMMIT_SHA}\`\n\n${review}\n\n---\n_Reviewed by Claude before deploy. Deploy proceeds regardless._`
    );
  }

  // Create GitHub Issues for CRITICALs
  const criticals = parseCriticals(review);
  const issueUrls = [];

  if (criticals.length > 0) {
    console.log(`\nFound ${criticals.length} CRITICAL issue(s) — creating GitHub Issues...`);
    for (const line of criticals) {
      const title = `[AI Review] CRITICAL: ${line.replace(/\*\*/g, '').replace(/\[CRITICAL\]/g, '').trim().slice(0, 100)}`;
      const body = `## AI Code Review — CRITICAL Finding\n\n**Commit:** \`${COMMIT_SHA}\`\n**Author:** ${COMMIT_AUTHOR}\n**Message:** ${COMMIT_MESSAGE.split('\n')[0]}\n\n---\n\n${line}\n\n---\n\n### Full Review\n\n${review}\n\n---\n_To fix: paste this issue into a Cursor background agent._`;
      const url = await createIssue(title, body);
      if (url) issueUrls.push(url);
    }
  } else {
    console.log('No CRITICAL issues found — no GitHub Issues created.');
  }

  // Send Slack notification
  await sendSlack(review, criticals.length, issueUrls);

  process.exit(0);
}

main();
