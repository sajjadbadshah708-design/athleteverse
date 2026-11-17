/* global document, getComputedStyle, axe */
// Real-browser audit of the web app: the whole player journey (register, e-mail code, profile) at 360 px, plus layout, touch
// target, text size, accessibility (axe, INCLUDING real colour contrast) and cookie checks, at 360, 320 and 1280 px. Screenshots
// are saved so a human can look at them. Optional tool: it needs a browser, so it is not part of `npm test`.
//
//   npm i --no-save playwright-core && npx playwright install chromium     (once; or set CHROME_PATH to an installed Chrome)
//   npm run dev:api > api.log        (terminal 1: the console mailer writes the verification code there)
//   npm run dev:web                  (terminal 2)
//   API_LOG=api.log node scripts/browser-audit.mjs
//
// Settings (environment): BASE_URL (default http://localhost:5173), API_LOG (default api.log), AUDIT_CITY (default "Demo City",
// a city that exists in the seeded database), SHOTS_DIR (default browser-audit-shots), CHROME_PATH, NO_SANDBOX=1 (needed in containers).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const API_LOG = process.env.API_LOG ?? 'api.log';
const SHOTS = process.env.SHOTS_DIR ?? 'browser-audit-shots';
const CITY = process.env.AUDIT_CITY ?? 'Demo City';
const AXE = fs.readFileSync(fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url)), 'utf8');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const note = (ok, what, extra = '') => { results.push({ ok, what, extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  ' + extra : ''}`); };

async function audit(page, label, { shot = true } = {}) {
  const m = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const targets = [...document.querySelectorAll('button, input:not([type=checkbox]), select, nav a, header a')].filter(vis);
    const small = targets.filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => `${e.tagName.toLowerCase()}[${e.name || e.textContent.trim().slice(0, 20)}]=${Math.round(e.getBoundingClientRect().height)}px`);
    const fields = [...document.querySelectorAll('input, select')].filter(vis);
    const tiny = fields.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.name);
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, small, tiny, targets: targets.length };
  });
  note(m.sw <= m.cw, `${label}: no horizontal scrolling`, `(content ${m.sw}px in a ${m.cw}px window)`);
  note(m.small.length === 0, `${label}: every button, field and header link is at least 44 px tall`, m.small.length ? m.small.join(', ') : `(${m.targets} checked)`);
  note(m.tiny.length === 0, `${label}: inputs use at least 16 px text (no iOS zoom)`, m.tiny.join(','));
  await page.evaluate(AXE);
  const v = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((x) => `${x.id} (${x.nodes.length}): ${x.help}`));
  note(v.length === 0, `${label}: axe WCAG 2.1 A/AA INCLUDING real colour contrast`, v.join(' | '));
  if (shot) await page.screenshot({ path: `${SHOTS}/${label.replace(/[^a-z0-9]+/gi, '-')}.png`, fullPage: true });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: process.env.NO_SANDBOX ? ['--no-sandbox'] : [] });
const code = async () => { for (let i = 0; i < 40; i++) { const m = [...fs.readFileSync(API_LOG, 'utf8').matchAll(/verification code is (\d{6})/g)].pop(); if (m) return m[1]; await new Promise((r) => setTimeout(r, 250)); } return ''; };

// ---------- helper: a second real player in a second browser, with a complete profile ----------
async function newPlayer(label) {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await context.newPage();
  await p.goto(BASE + '/register');
  await p.getByLabel('Full name').fill(`Player ${label}`);
  await p.getByLabel('E-mail').fill(`${label}${Date.now()}@example.com`);
  await p.getByLabel('Phone number').fill('+92 301 ' + String(Date.now()).slice(-7));
  await p.getByLabel('Password', { exact: true }).fill('Passw0rdOK');
  await p.getByLabel(/accept the Terms/).check();
  await p.getByLabel(/at least 16/).check();
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.getByRole('heading', { name: 'Check your e-mail' }).waitFor();
  await p.getByLabel('Verification code').fill(await code());
  await p.getByRole('button', { name: 'Verify and continue' }).click();
  await p.getByRole('heading', { name: /^Welcome/ }).waitFor();
  await p.goto(BASE + '/profile');
  await p.getByLabel('City').selectOption({ label: CITY });
  await p.getByLabel('Date of birth').fill('1999-03-04');
  await p.getByRole('button', { name: 'Save profile' }).click();
  await p.getByText('Your profile is saved.').waitFor();
  return { context, page: p };
}

// ---------- the whole journey at 360 px, as a touch phone ----------
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const consoleErrors = [];
const badResponses = [];
// "Failed to load resource" lines are the browser reporting 4xx answers; those are judged precisely below instead.
page.on('console', (msg) => msg.type() === 'error' && !msg.text().startsWith('Failed to load resource') && consoleErrors.push(msg.text()));
let availabilityRequests = 0;
page.on('request', (r) => r.url().includes('/availability') && availabilityRequests++);
let wrongCodeAnswers = 1; // the journey deliberately enters ONE wrong code and expects exactly one 422
page.on('response', (r) => {
  const path = new URL(r.url()).pathname;
  const expected401 = r.status() === 401 && (path === '/api/v1/me' || path === '/api/v1/auth/refresh'); // an anonymous visitor asks "who am I?"
  const expectedWrongCode = r.status() === 422 && path === '/api/v1/auth/verify-email' && wrongCodeAnswers-- > 0;
  if (r.status() >= 400 && !expected401 && !expectedWrongCode) badResponses.push(`${r.status()} ${path}`);
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(BASE + '/');
await page.getByRole('heading', { name: 'Sign in' }).waitFor();
note(page.url() === BASE + '/login', 'the home address sends a visitor to the sign-in page', page.url());
await audit(page, 'login-360');

await page.keyboard.press('Tab');
const skip = await page.evaluate(() => { const e = document.activeElement; const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), visible: r.width > 0 && r.top >= 0 && r.left >= 0 }; });
note(skip.text === 'Skip to content' && skip.visible, 'first Tab reaches a visible "Skip to content" link', JSON.stringify(skip));

await page.getByRole('link', { name: 'Create an account' }).click();
await page.getByRole('heading', { name: 'Create your account' }).waitFor();
await audit(page, 'register-360');
await page.getByRole('button', { name: 'Create account' }).click();
await page.getByText('Enter at least 2 characters').waitFor();
const focused = await page.evaluate(() => document.activeElement?.getAttribute('name'));
note(focused === 'fullName', 'submitting empty moves focus to the first invalid field', `focused: ${focused}`);
await audit(page, 'register-errors-360');

const email = `browser${Date.now()}@example.com`;
await page.getByLabel('Full name').fill('Browser Tester');
await page.getByLabel('E-mail').fill(email);
await page.getByLabel('Phone number').fill('+92 300 ' + String(Date.now()).slice(-7));
await page.getByLabel('Password', { exact: true }).fill('Passw0rdOK');
await page.getByLabel(/accept the Terms/).check();
await page.getByLabel(/at least 16/).check();
await page.getByRole('button', { name: 'Create account' }).click();
await page.getByRole('heading', { name: 'Check your e-mail' }).waitFor();
await audit(page, 'verify-360');

await page.getByLabel('Verification code').fill('000000');
await page.getByRole('button', { name: 'Verify and continue' }).click();
await page.getByText('4 tries left').waitFor();
note(true, 'a wrong code shows "4 tries left" next to the field');
const c = await code();
await page.getByLabel('Verification code').fill(c);
await page.getByRole('button', { name: 'Verify and continue' }).click();
await page.getByRole('heading', { name: 'Welcome, Browser Tester' }).waitFor();
note(true, 'the e-mailed code signs the new player in and opens the home page');
await audit(page, 'home-360');

const cookies = await ctx.cookies();
const access = cookies.find((k) => k.name === 'av_access'); const refresh = cookies.find((k) => k.name === 'av_refresh');
note(access?.httpOnly && access.sameSite === 'Strict' && access.path === '/api/v1', 'access cookie is HttpOnly, SameSite=Strict, Path=/api/v1', JSON.stringify({ httpOnly: access?.httpOnly, sameSite: access?.sameSite, path: access?.path }));
note(refresh?.httpOnly && refresh.sameSite === 'Strict' && refresh.path === '/api/v1/auth', 'refresh cookie is HttpOnly, SameSite=Strict, Path=/api/v1/auth');
note(!(await page.evaluate(() => document.cookie)).includes('av_'), 'page JavaScript cannot read either cookie');

await page.getByRole('link', { name: 'Complete your profile' }).click();
await page.getByRole('heading', { name: 'Your profile' }).waitFor();
await page.getByLabel('City').waitFor();
await audit(page, 'profile-360');
await page.getByRole('button', { name: 'Save profile' }).click();
await page.getByText('Choose your city.').waitFor();
const f2 = await page.evaluate(() => document.activeElement?.getAttribute('name'));
note(f2 === 'cityId', 'profile: submitting empty moves focus to the city field', `focused: ${f2}`);
await audit(page, 'profile-errors-360');

await page.getByLabel('City').selectOption({ label: CITY });
await page.getByLabel('Date of birth').fill('2015-06-01'); // 15 years old
await page.getByRole('button', { name: 'Save profile' }).click();
await page.getByText('You must be at least 16 years old to use AthleteVerse.').waitFor();
note(true, 'a 15-year-old is told so next to the date field');
await page.getByLabel('Date of birth').fill('2000-06-01');
await page.getByLabel('Area or neighbourhood').fill('Downtown');
await page.getByRole('button', { name: 'Save profile' }).click();
await page.getByText('Your profile is saved.').waitFor();
note(true, 'a valid profile saves and the home page confirms it');
const body = await page.evaluate(() => fetch('/api/v1/me/profile').then((r) => r.text()));
note(!body.includes('2000-06-01') && !/"dateOfBirth"/.test(body) && JSON.parse(body).complete === true, 'the API never sends the date of birth back, and the profile is complete', body);

await page.reload();
await page.getByRole('heading', { name: 'Welcome, Browser Tester' }).waitFor();
note(true, 'a page reload keeps the player signed in (cookies through the Vite proxy)');

// ---------- venues: browse, search, open one, read its availability ----------
await page.getByRole('link', { name: 'Venues', exact: true }).click();
await page.getByRole('heading', { name: 'Find a court' }).waitFor();
await page.getByText(/\d+ venues? found/).waitFor();
await audit(page, 'venues-360');
await page.getByLabel('Venue name or address').fill('demo');
await page.getByRole('button', { name: 'Show venues' }).click();
await page.waitForURL(/q=demo/);
await page.getByText(/\d+ venues? found/).waitFor();
note(page.url().includes('q=demo'), 'a search is kept in the address, so the result can be shared');
const venueLink = page.locator('main h2 a').first();
const venueHref = await venueLink.getAttribute('href');
await venueLink.click();
await page.getByRole('region', { name: 'Availability' }).waitFor();
await page.locator('main h3').first().waitFor();
await audit(page, 'venue-360');
const labelled = await page.evaluate(() => {
  const items = [...document.querySelectorAll('section[aria-labelledby^="court-"] li')];
  return { total: items.length, withText: items.filter((li) => /Available|Booked|Blocked|Past/.test(li.textContent)).length };
});
note(labelled.total > 0 && labelled.total === labelled.withText, 'every hour in the availability grid says its state in words, not only in colour', `${labelled.withText} of ${labelled.total}`);
const dayBefore = await page.locator('p.font-semibold', { hasText: /\d{4}$/ }).first().textContent();
await page.getByRole('button', { name: 'Next day' }).click();
await page.waitForFunction((before) => ![...document.querySelectorAll('p.font-semibold')].some((p) => p.textContent === before), dayBefore);
note(true, 'Next day moves the grid to the following date');
const requestsBefore = availabilityRequests;
await page.waitForTimeout(16_500);
note(availabilityRequests > requestsBefore, 'the grid refreshes by itself within 16 seconds while the page is visible', `${availabilityRequests - requestsBefore} request(s)`);

// ---------- booking: choose hours, review, confirm; then two players race for the same hour ----------
const hourButtons = (p) => p.locator('section[aria-labelledby^="court-"] button[aria-pressed]');
const venueUrl = BASE + venueHref;
await hourButtons(page).first().waitFor();
const firstHourText = (await hourButtons(page).first().innerText()).split('\n')[0];
await hourButtons(page).first().click();
await page.getByRole('region', { name: 'Your selection' }).waitFor();
note((await hourButtons(page).first().getAttribute('aria-pressed')) === 'true', 'tapping an available hour selects it and shows a summary bar with the total');
await audit(page, 'booking-selected-360');
await page.getByRole('button', { name: 'Review booking' }).click();
await page.getByRole('heading', { name: 'Review your booking' }).waitFor();
note(await page.evaluate(() => document.activeElement?.id === 'review-title'), 'the review step takes keyboard focus on its heading');
await audit(page, 'booking-review-360');

const rival = await newPlayer('rival');
await rival.page.goto(venueUrl);
await rival.page.getByRole('region', { name: 'Availability' }).waitFor();
await rival.page.getByRole('button', { name: 'Next day' }).click();
await hourButtons(rival.page).first().waitFor();
await rival.page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby^="court-"] button').length > 0);
await hourButtons(rival.page).first().click();
await rival.page.getByRole('button', { name: 'Review booking' }).click();
await rival.page.getByRole('heading', { name: 'Review your booking' }).waitFor();
const sameHour = (await rival.page.getByRole('region', { name: 'Review your booking' }).innerText()).includes(firstHourText.split(' – ')[0]);
note(sameHour, 'both players are about to book the very same hour on the same court', firstHourText);

await Promise.all([page.getByRole('button', { name: 'Confirm booking' }).click(), rival.page.getByRole('button', { name: 'Confirm booking' }).click()]);
const outcome = async (p) => {
  const confirmed = p.getByRole('heading', { name: 'Booking confirmed' });
  const taken = p.getByText('Someone just booked that slot. Pick another time.');
  await confirmed.or(taken).waitFor({ timeout: 15000 });
  return (await confirmed.count()) > 0 ? 'confirmed' : 'taken';
};
const raceResult = [await outcome(page), await outcome(rival.page)];
note(raceResult.filter((r) => r === 'confirmed').length === 1 && raceResult.filter((r) => r === 'taken').length === 1, 'two players confirming the same hour at the same instant: exactly one booking, the other is told it was taken', raceResult.join(' / '));

const winner = raceResult[0] === 'confirmed' ? page : rival.page;
const loser = raceResult[0] === 'confirmed' ? rival.page : page;
const winnerCode = (await winner.getByTestId('booking-code').innerText()).trim();
note(/^[A-HJKMNP-Z2-9]{8}$/.test(winnerCode), 'the confirmed booking shows an 8-character code', winnerCode);
await audit(winner, 'booking-confirmed-360');
await loser.getByText('These hours are still free:').waitFor();
const offered = await loser.locator('section ul li button').count();
note(offered > 0, 'the player who lost the race is offered other free hours', `${offered} offered`);
await audit(loser, 'booking-taken-360');
await loser.locator('section ul li button').first().click();
await loser.getByRole('button', { name: 'Review booking' }).click();
await loser.getByRole('button', { name: 'Confirm booking' }).click();
await loser.getByRole('heading', { name: 'Booking confirmed' }).waitFor();
note(true, 'the player who lost the race books one of the offered hours instead');

const grid = await winner.evaluate(async (id) => {
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const r = await fetch(`/api/v1/venues/${id}/availability?date=${date}`);
  return (await r.json()).courts.flatMap((c) => c.slots).filter((x) => x.state === 'BOOKED').length;
}, venueHref.split('/').pop());
note(grid >= 2, 'the availability grid now shows both bookings as Booked', `${grid} booked hours`);
const mails = [...fs.readFileSync(API_LOG, 'utf8').matchAll(/Your AthleteVerse booking ([A-Z0-9]{8})/g)].map((m) => m[1]);
note(mails.length === 2 && mails.includes(winnerCode), 'each booking sent one confirmation e-mail with its code', mails.join(', '));
await rival.context.close();

await page.getByRole('button', { name: 'Sign out' }).click();
await page.getByRole('heading', { name: 'Sign in' }).waitFor();
note((await page.evaluate(() => fetch('/api/v1/me').then((r) => r.status))) === 401, 'after Sign out the session is really gone (GET /me answers 401)');

// ---------- a sleeping server: the "starting up" message ----------
await page.route('**/api/v1/me', async (route) => { await new Promise((r) => setTimeout(r, 4500)); await route.continue(); });
await page.goto(BASE + '/login');
await page.getByText('The server is starting up').waitFor({ timeout: 6000 });
note(true, 'with a slow server the "starting up" message appears');
await page.screenshot({ path: `${SHOTS}/starting-up-360.png` });
await page.unroute('**/api/v1/me');
note(consoleErrors.length === 0, 'no JavaScript errors or console errors during the whole journey', consoleErrors.slice(0, 3).join(' | '));
note(badResponses.length === 0, 'no failed network requests except the expected 401s of an anonymous visit (no 404s, no 5xx)', badResponses.join(', '));
await ctx.close();

// ---------- the smallest phone and a desktop ----------
for (const [w, h, name] of [[320, 568, 'small-320'], [1280, 800, 'desktop-1280']]) {
  const c2 = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await c2.newPage();
  await p.goto(BASE + '/login'); await p.getByRole('heading', { name: 'Sign in' }).waitFor(); await audit(p, `login-${name}`);
  await p.goto(BASE + '/register'); await p.getByRole('heading', { name: 'Create your account' }).waitFor(); await audit(p, `register-${name}`);
  await p.goto(BASE + '/venues'); await p.getByText(/\d+ venues? found/).waitFor(); await audit(p, `venues-${name}`);
  if (venueHref) { await p.goto(BASE + venueHref); await p.locator('main h3').first().waitFor(); await audit(p, `venue-${name}`); }
  await c2.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
