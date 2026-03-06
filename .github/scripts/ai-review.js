#!/usr/bin/env node
/**
 * AI Code Review — calls Claude to scan public/ for bugs before deploy.
 * Writes findings to the GitHub Actions step summary.
 * Never blocks the deploy — just surfaces issues clearly.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set — skipping review.');
  process.exit(0);
}

// Collect all reviewable files from public/
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
      // Skip large files (>40KB) to stay within token limits
      if (content.length < 40000) {
        output += `\n\n===== ${rel} =====\n${content}`;
      } else {
        output += `\n\n===== ${rel} ===== [file too large to review — ${content.length} chars]`;
      }
    }
  }
  return output;
}

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

const body = JSON.stringify({
  model: 'claude-opus-4-5',
  max_tokens: 1500,
  messages: [{ role: 'user', content: prompt }]
});

const options = {
  hostname: 'api.anthropic.com',
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  }
};

console.log('Sending code to Claude for review...');

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.error) {
        console.error('Claude API error:', parsed.error.message);
        process.exit(0); // Don't block deploy on API error
      }

      const review = parsed.content?.[0]?.text || 'No review returned.';

      // Print to console (visible in Actions log)
      console.log('\n====== AI REVIEW RESULTS ======\n');
      console.log(review);
      console.log('\n================================\n');

      // Write to GitHub Step Summary (visible in Actions UI)
      const summaryFile = process.env.GITHUB_STEP_SUMMARY;
      if (summaryFile) {
        const summary = `# AI Code Review\n\n${review}\n\n---\n_Reviewed by Claude before deploy. Deploy proceeds regardless._`;
        fs.appendFileSync(summaryFile, summary);
      }

      // Exit 0 always — never block the deploy
      process.exit(0);
    } catch (e) {
      console.error('Failed to parse Claude response:', e.message);
      process.exit(0);
    }
  });
});

req.on('error', (e) => {
  console.error('Request failed:', e.message);
  process.exit(0); // Don't block deploy on network error
});

req.write(body);
req.end();
