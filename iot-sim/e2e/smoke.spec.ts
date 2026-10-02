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
  const wires = await page.evaluate(() => window.__app.sim.project.wires.map((w: any) => `${w.pin}->${w.board}`).sort());
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
