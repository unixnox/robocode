import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window { __app: any }
}

async function fresh(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.__app);
  return errors;
}

test('example: DHT22 + OLED runs and prints to Serial Monitor', async ({ page }) => {
  const errors = await fresh(page);
  await page.evaluate(() => window.__app.loadExample('dht-oled'));
  await page.click('#btn-run');
  await expect(page.locator('#serial-out')).toContainText('Temp: 28.5 C', { timeout: 10_000 });
  // OLED received a frame
  expect(await page.evaluate(() => window.__app.sim.oled.size)).toBe(1);
  expect(errors).toEqual([]);
});

test('drag LED from palette, wire it by clicking pins, run Blink', async ({ page }) => {
  const errors = await fresh(page);
  await page.click('#btn-new');
  // drag & drop from the palette into the 3D view
  await page.locator('.palette .item[data-type=led]').dragTo(page.locator('#viewport canvas'), { targetPosition: { x: 330, y: 200 } });
  await expect.poll(() => page.evaluate(() => window.__app.sim.project.components.length)).toBe(1);
  const id = await page.evaluate(() => window.__app.sim.project.components[0].id);

  // click component pin, then ESP32 pin
  const click = async (comp: string | null, pin: string) => {
    const p = await page.evaluate(([c, n]) => window.__app.scene.pinScreen(c, n), [comp, pin] as const);
    expect(p).not.toBeNull();
    await page.mouse.click(p.x, p.y);
  };
  await click(id, '+');
  await click(null, 'D2');
  await click(id, '-');
  await click(null, 'GND1');
  const wires = await page.evaluate(() => window.__app.sim.project.wires.map((w: any) => `${w.a.pin}->${w.b.pin}`).sort());
  expect(wires).toEqual(['+->D2', '-->GND1']);

  await page.evaluate(() => window.__app.editor.code = `void setup(){ Serial.begin(115200); pinMode(2, OUTPUT); }
void loop(){ digitalWrite(2, HIGH); Serial.println("on"); delay(300); digitalWrite(2, LOW); Serial.println("off"); delay(300); }`);
  await page.click('#btn-run');
  await expect(page.locator('#serial-out')).toContainText('off', { timeout: 10_000 });
  // LED readout in the inspector shows brightness while running
  await page.evaluate((cid) => window.__app.scene.setSelection({ kind: 'comp', id: cid }), id);
  const levels = new Set<string>();
  for (let i = 0; i < 12; i++) {
    levels.add(await page.evaluate(() => String(window.__app.sim.pinOut.get(2)?.level)));
    await page.waitForTimeout(100);
  }
  expect([...levels].sort()).toEqual(['0', '1']);
  expect(errors).toEqual([]);
});

test('pressing the 3D button toggles the LED (button example)', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => window.__app.loadExample('button'));
  await page.click('#btn-run');
  await expect(page.locator('#serial-out')).toContainText('คลิกค้าง');
  const p = await page.evaluate(() => window.__app.scene.pressScreen('btn1'));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect(page.locator('#serial-out')).toContainText('LED ON', { timeout: 5_000 });
});

test('compile errors are shown with the line number', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => window.__app.editor.code = 'void setup() {\n  int x = 5\n}\nvoid loop() {}');
  await page.click('#btn-run');
  await expect(page.locator('#compile-status')).toContainText('บรรทัด 3');
  await expect(page.locator('.cm-error-line')).toHaveCount(1);
});

test('search the palette by KY code and add with Enter', async ({ page }) => {
  const errors = await fresh(page);
  await page.click('#btn-new');
  await page.keyboard.press('/');
  await page.keyboard.type('ky022');
  await expect(page.locator('.pal-list .item').first()).toHaveAttribute('data-type', 'irrx');
  await expect(page.locator('.pal-count')).toContainText('พบ');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__app.sim.project.components.map((c: any) => c.type))).toEqual(['irrx']);
  // category + interface filters
  await page.fill('.pal-search', '');
  await page.locator('.pal-tags summary').click();
  await page.locator('.pal-tags .chip', { hasText: 'I2C' }).click();
  await expect(page.locator('.pal-list .item')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('plug an LED into the breadboard and drive it through a breadboard wire', async ({ page }) => {
  const errors = await fresh(page);
  await page.click('#btn-new');
  await page.locator('.palette .item[data-type=breadboard]').click();
  const bb = await page.evaluate(() => window.__app.sim.project.components[0].id);
  await page.evaluate(() => window.__app.scene.fitView());
  await page.waitForTimeout(300);
  // drop an LED near hole g15: the part snaps onto the hole grid and its legs go into the strips
  const hole = await page.evaluate((id) => window.__app.scene.pinScreen(id, 'g15'), bb);
  const box = (await page.locator('#viewport canvas').boundingBox())!;
  await page.locator('.palette .item[data-type=led]').dragTo(page.locator('#viewport canvas'), {
    targetPosition: { x: hole.x - box.x, y: hole.y - box.y + 8 },
  });
  await expect.poll(() => page.evaluate(() => window.__app.sim.sol.inserted.size)).toBe(1);
  const led = await page.evaluate(() => window.__app.sim.project.components[1].id);
  const plugged = await page.evaluate((id) => [...window.__app.sim.sol.insertions.entries()]
    .filter(([k]: [string]) => k.startsWith(id)).map(([, v]: [string, string]) => v.split('\u0000')[1]), led);
  expect(plugged).toHaveLength(2);
  // wire a free hole of the "+" strip to GPIO2 and the "-" strip to GND, by clicking
  const plusCol = plugged.map((h: string) => h.slice(1)).sort()[0];
  const minusCol = plugged.map((h: string) => h.slice(1)).sort()[1];
  const click = async (comp: string | null, pin: string) => {
    const p = await page.evaluate(([c, n]) => window.__app.scene.pinScreen(c, n), [comp, pin] as const);
    await page.mouse.click(p.x, p.y);
  };
  await click(bb, `j${plusCol}`);
  await click(null, 'D2');
  await click(bb, `j${minusCol}`);
  await click(null, 'GND1');
  expect(await page.evaluate(() => window.__app.sim.project.wires.length)).toBe(2);
  await page.evaluate(() => window.__app.editor.code = 'void setup(){ pinMode(2, OUTPUT); digitalWrite(2, HIGH); }\nvoid loop(){}');
  await page.click('#btn-run');
  await expect.poll(() => page.evaluate((id) => {
    const app = window.__app;
    const c = app.sim.project.components.find((x: any) => x.id === id);
    return app.sim.ctx(c).volts('+');
  }, led), { timeout: 5000 }).toBeCloseTo(3.3);
  expect(errors).toEqual([]);
});

test('click a wired pin to unplug the wire end, click another pin to plug it back in', async ({ page }) => {
  const errors = await fresh(page);
  await page.evaluate(() => window.__app.loadExample('blink'));
  await page.waitForTimeout(300);
  const click = async (comp: string | null, pin: string, opts: { shift?: boolean } = {}) => {
    const p = await page.evaluate(([c, n]) => window.__app.scene.pinScreen(c, n), [comp, pin] as const);
    if (opts.shift) await page.keyboard.down('Shift');
    await page.mouse.click(p.x, p.y);
    if (opts.shift) await page.keyboard.up('Shift');
  };
  const wireOf = () => page.evaluate(() => {
    const w = window.__app.sim.project.wires.find((x: any) => x.a.comp === 'led1' && x.a.pin === '+');
    return w ? `${w.id}:${w.b.pin}` : null;
  });
  const before = await wireOf();
  expect(before).toMatch(/:D2$/);
  const id = before!.split(':')[0];

  // unplug from D2 (the wire leaves the circuit while carried) and plug into D4
  await click(null, 'D2');
  expect(await wireOf()).toBeNull();
  expect(await page.evaluate(() => window.__app.scene.carrying)).toBe(true);
  await click(null, 'D4');
  expect(await wireOf()).toBe(`${id}:D4`);

  // Escape puts a carried wire back where it was
  await click(null, 'D4');
  await page.keyboard.press('Escape');
  expect(await wireOf()).toBe(`${id}:D4`);

  // Shift+click starts a new wire from a pin that already has one
  const n = await page.evaluate(() => window.__app.sim.project.wires.length);
  await click(null, 'D4', { shift: true });
  await click(null, 'D5');
  expect(await page.evaluate(() => window.__app.sim.project.wires.length)).toBe(n + 1);

  // Delete removes a carried wire
  await click(null, 'D5');
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.__app.sim.project.wires.length)).toBe(n);
  expect(errors).toEqual([]);
});

test('home appliance example: Serial command switches the lamp relay', async ({ page }) => {
  const errors = await fresh(page);
  await page.evaluate(() => window.__app.loadExample('home'));
  await page.click('#btn-run');
  await expect(page.locator('#serial-out')).toContainText('พร้อมแล้ว', { timeout: 10_000 });
  await page.fill('#serial-text', 'lamp on');
  await page.press('#serial-text', 'Enter');
  await expect(page.locator('#serial-out')).toContainText('lamp -> ON', { timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => {
    const app = window.__app;
    const c = app.sim.project.components.find((x: any) => x.id === 'lamp');
    return app.sim.ctx(c).volts('L');
  }), { timeout: 5_000 }).toBe(220);
  expect(errors).toEqual([]);
});
