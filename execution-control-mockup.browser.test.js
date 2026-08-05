const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

let server;
let baseURL;

test.before(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/execution-control-mockup.html') {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(__dirname, 'execution-control-mockup.html')).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}/execution-control-mockup.html`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function openPage(viewport = { width: 1440, height: 950 }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()}`));
  await page.goto(baseURL);
  return { browser, page, consoleErrors, failedRequests };
}

test('workspace view filters tasks and opens durable delivery detail', async () => {
  const { browser, page, consoleErrors, failedRequests } = await openPage();
  try {
    await page.getByRole('heading', { name: 'Work', exact: true }).waitFor();
    assert.equal(await page.locator('.task-row').count(), 8);
    await page.getByLabel('Filter by status').selectOption('review');
    assert.equal(await page.locator('.task-row').count(), 2);
    await page.getByRole('button', { name: /Add durable agent runs/ }).click();
    await page.getByRole('heading', { name: 'Add durable agent runs and delivery records' }).waitFor();
    assert.match(page.url(), /#task\/SLT-128$/);
    await page.getByText('Pull request #124').waitFor();
    await page.getByText('8 checks passed').waitFor();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), page.url());
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.getByRole('button', { name: /Draft the agent workflow teardown/ }).click();
    assert.equal(await page.locator('.delivery-link').getAttribute('href'), 'https://github.com/owainlewis/agents-course/pull/42');
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(failedRequests, []);
  } finally {
    await browser.close();
  }
});

test('brief editing previews Markdown and appends immutable activity', async () => {
  const { browser, page, consoleErrors, failedRequests } = await openPage();
  try {
    await page.getByRole('button', { name: /Add durable agent runs/ }).click();
    await page.getByRole('button', { name: 'Edit brief' }).click();
    await page.getByLabel('Markdown brief').fill('## Context\n\nUpdated contract copy.\n\n## Acceptance criteria\n\n- [ ] Durable proof');
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.getByText('Updated contract copy.').waitFor();
    await page.getByRole('button', { name: 'Save brief' }).click();
    await page.getByText('Updated contract copy.').waitFor();
    await page.locator('[data-tab="activity"]').click();
    await page.getByText('Owain updated the brief').waitFor();
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(failedRequests, []);
  } finally {
    await browser.close();
  }
});

test('a task moves from creation through dispatch, delivery, review, and acceptance', async () => {
  const { browser, page, consoleErrors, failedRequests } = await openPage();
  try {
    await page.getByRole('button', { name: /Add issue-quality task brief templates/ }).click();
    await page.getByRole('button', { name: 'Dispatch task' }).click();
    await page.locator('#detail-status').getByText('Running', { exact: true }).waitFor();
    await page.getByText('Run #1', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: 'Return to ready' }).click();
    await page.locator('#detail-status').getByText('Ready', { exact: true }).waitFor();
    await page.getByText('Stopped', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByLabel('Title').fill('Connect merged PRs to completed tasks');
    assert.match(await page.getByLabel('Brief').inputValue(), /## Acceptance criteria/);
    await page.getByRole('button', { name: 'Create task' }).click();
    await page.getByRole('heading', { name: 'Connect merged PRs to completed tasks' }).waitFor();
    await page.getByText(/SLT-129/).first().waitFor();
    await page.getByRole('button', { name: 'Dispatch task' }).click();
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await page.getByLabel('Outcome summary').fill('Linked merged pull requests to their originating Slate tasks.');
    await page.getByLabel('Verification evidence').fill('4 focused browser checks passed');
    await page.getByRole('button', { name: 'Submit delivery' }).click();
    await page.getByText('Enter a PR or MR URL with a concrete number.').waitFor();
    await page.locator('#detail-status').getByText('Running', { exact: true }).waitFor();
    await page.getByLabel('PR or MR URL').fill('https://github.com/owainlewis/slate.do/pull/91');
    await page.getByRole('button', { name: 'Submit delivery' }).click();
    await page.locator('#detail-status').getByText('Review', { exact: true }).waitFor();
    assert.equal(await page.locator('.delivery-link').getAttribute('href'), 'https://github.com/owainlewis/slate.do/pull/91');
    await page.getByText('4 focused browser checks passed').waitFor();
    await page.getByText('Ready for review', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Accept' }).click();
    await page.locator('#detail-status').getByText('Done', { exact: true }).waitFor();
    await page.getByText('Accepted', { exact: true }).waitFor();
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(failedRequests, []);
  } finally {
    await browser.close();
  }
});

test('mobile navigation and keyboard dismissal avoid horizontal overflow', async () => {
  const { browser, page, consoleErrors, failedRequests } = await openPage({ width: 390, height: 844 });
  try {
    const menu = page.getByRole('button', { name: 'Open navigation' });
    await menu.click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(failedRequests, []);
  } finally {
    await browser.close();
  }
});
