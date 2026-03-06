#!/usr/bin/env node
/**
 * AI Auto-Fix — triggered when a GitHub Issue with label ai-review is opened.
 * Reads the issue, asks Claude to generate a minimal fix, commits it, opens a PR.
 * Never touches main directly — always branch + PR.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// GH_PAT is used for PR creation — GITHUB_TOKEN lacks permission for this on issues-triggered workflows
const GH_PAT = process.env.GH_PAT || GITHUB_TOKEN;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_TITLE = process.env.ISSUE_TITLE || '';
const ISSUE_BODY = process.env.ISSUE_BODY || '';
const REPO = process.env.REPO;

if (!ANTHROPIC_API_KEY || !GITHUB_TOKEN || !ISSUE_NUMBER || !REPO) {
  console.error('Missing required env vars — skipping.');
  process.exit(0);
}

// --- HTTP helper ---
function httpRequest(method, hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const req = https.request(
      {
        hostname, path: urlPath, method,
        headers: { ...headers, ...(bodyStr ? { 'content-length': Buffer.byteLength(bodyStr) } : {}) }
      },
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
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function ghHeaders(usePat = false) {
  return {
    'Authorization': `token ${usePat ? GH_PAT : GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'torchlit-ai-fix'
  };
}

// --- Parse the CRITICAL finding from the issue body ---
function parseFinding(body) {
  // Extract file path — looks like `public/index.html:42` or `public/index.html`
  const fileMatch = body.match(/`(public\/[^`\s:]+)(?::(\d+))?`/);
  const filePath = fileMatch ? fileMatch[1] : null;
  const lineNum = fileMatch ? fileMatch[2] : null;

  // Extract the CRITICAL line itself
  const criticalMatch = body.match(/\*\*\[?CRITICAL\]?\*\*.*$/m);
  const finding = criticalMatch ? criticalMatch[0].replace(/\*\*/g, '') : body.split('---')[0].trim();

  return { filePath, lineNum, finding };
}

// --- Ask Claude to generate the fix ---
async function generateFix(filePath, finding, fileContent) {
  const prompt = `You are a senior web developer. You need to apply a minimal, surgical fix to a file.

CRITICAL ISSUE FOUND:
${finding}

FILE: ${filePath}
CONTENT:
\`\`\`
${fileContent}
\`\`\`

Instructions:
1. Apply ONLY the fix described above — do not refactor, rename, or change anything else
2. If the fix is ambiguous or would require changing more than 20 lines, respond with exactly: SKIP: <reason>
3. Otherwise, respond with the complete fixed file content, nothing else — no explanation, no markdown fences, just the raw file content`;

  const res = await httpRequest(
    'POST', 'api.anthropic.com', '/v1/messages',
    {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    { model: 'claude-sonnet-4-6', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }
  );

  if (res.body.error) throw new Error(res.body.error.message);
  return res.body.content?.[0]?.text || '';
}

// --- Post a comment on the issue ---
async function commentOnIssue(comment) {
  await httpRequest(
    'POST', 'api.github.com', `/repos/${REPO}/issues/${ISSUE_NUMBER}/comments`,
    ghHeaders(),
    { body: comment }
  );
}

// --- Create a PR ---
async function createPR(branch, title, body) {
  const res = await httpRequest(
    'POST', 'api.github.com', `/repos/${REPO}/pulls`,
    ghHeaders(true), // use PAT — GITHUB_TOKEN can't create PRs on issues-triggered workflows
    { title, body, head: branch, base: 'main' }
  );
  if (res.status === 201) {
    return res.body.html_url;
  }
  console.error(`PR creation failed — HTTP ${res.status}:`, JSON.stringify(res.body));
  return null;
}

// --- Main ---
async function main() {
  console.log(`Processing issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}`);

  const { filePath, lineNum, finding } = parseFinding(ISSUE_BODY);

  if (!filePath) {
    console.log('Could not extract file path from issue — skipping.');
    await commentOnIssue('_AI Auto-Fix: Could not identify a specific file path in this issue. Manual fix required._');
    return;
  }

  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath} — skipping.`);
    await commentOnIssue(`_AI Auto-Fix: File \`${filePath}\` not found in repository. Manual fix required._`);
    return;
  }

  const fileContent = fs.readFileSync(filePath, 'utf8');
  console.log(`Asking Claude to fix ${filePath}${lineNum ? `:${lineNum}` : ''}...`);

  let fixedContent;
  try {
    fixedContent = await generateFix(filePath, finding, fileContent);
  } catch (e) {
    console.error('Claude API error:', e.message);
    await commentOnIssue(`_AI Auto-Fix: Claude API error — ${e.message}. Manual fix required._`);
    return;
  }

  if (fixedContent.startsWith('SKIP:')) {
    const reason = fixedContent.replace('SKIP:', '').trim();
    console.log(`Claude skipped: ${reason}`);
    await commentOnIssue(`_AI Auto-Fix: Skipped — ${reason}. Manual fix required._`);
    return;
  }

  // Sanity check — don't write empty or obviously wrong content
  if (fixedContent.length < 50 || fixedContent.length > fileContent.length * 3) {
    console.log('Fix output looks wrong — skipping.');
    await commentOnIssue('_AI Auto-Fix: Generated fix failed sanity check. Manual fix required._');
    return;
  }

  // Write the fix
  fs.writeFileSync(filePath, fixedContent, 'utf8');
  console.log(`Fix written to ${filePath}`);

  // Git — configure, branch, commit, push
  const branch = `ai-fix/issue-${ISSUE_NUMBER}`;
  const shortTitle = ISSUE_TITLE.replace(/\[AI Review\] CRITICAL:\s*/i, '').slice(0, 72);

  const run = (cmd) => {
    console.log(`$ ${cmd}`);
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (out) console.log(out.trim());
    return out;
  };

  run('git config user.email "ai-fix@torchlit-games"');
  run('git config user.name "TorchLit AI Fix"');
  run(`git checkout -b ${branch}`);
  run(`git add ${filePath}`);
  run(`git commit -m "[AI-FIX] fix: ${shortTitle} (closes #${ISSUE_NUMBER})"`);
  run(`git push origin ${branch}`);
  console.log(`Pushed branch ${branch}`);

  // Open PR
  const prTitle = `[AI-FIX] ${shortTitle}`;
  const prBody = `Automated fix generated by Claude for issue #${ISSUE_NUMBER}.

**File changed:** \`${filePath}\`${lineNum ? ` (line ${lineNum})` : ''}

**Finding:**
${finding}

---
Closes #${ISSUE_NUMBER}

_Review carefully before merging — this was generated automatically._`;

  const prUrl = await createPR(branch, prTitle, prBody);

  if (prUrl) {
    console.log(`PR created: ${prUrl}`);
    await commentOnIssue(`_AI Auto-Fix: PR opened — ${prUrl}_`);
  } else {
    console.error('PR creation returned no URL — branch was pushed but PR failed.');
    await commentOnIssue(`_AI Auto-Fix: Branch \`${branch}\` pushed but PR creation failed. Check Actions logs for details._`);
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(0); // Don't fail the workflow
});
