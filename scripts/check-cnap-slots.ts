import { chromium, Browser, Page } from 'playwright';

export interface CheckOptions {
  category?: string;
  serviceName?: string;
  location?: string;
  headless?: boolean;
  screenshotPath?: string;
}

export interface DaySlotInfo {
  date: string;
  times: string[];
}

export interface ServiceResult {
  serviceName: string;
  locationFound: boolean;
  locationName?: string;
  available: boolean;
  reason?: string;
  slots: DaySlotInfo[];
}

export interface CheckCnapResult {
  category: string;
  targetLocation: string;
  categoryAvailable: boolean;
  reason?: string;
  services: ServiceResult[];
  hasAvailableSlots: boolean;
}

const SELECTORS = {
  categoryTrigger: '[data-testid="field-jobGroup"]',
  serviceTrigger: '[data-testid="field-job"]',
  branchTrigger: '[data-testid="field-branch"]',
  dropdownItem: '.dropdown-item',
  warningState: '.service-info-state, .warning-panel',
  calendarDay: 'button.cal-day',
  availableDay: 'button.cal-day.available',
  timeSlot: 'button.time-slot:not([disabled])',
};

/**
 * Open dropdown trigger and select option matching criteria
 */
async function selectOption(
  page: Page,
  triggerSelector: string,
  optionMatcher: string | RegExp
): Promise<{ success: boolean; selectedText?: string; allOptions: string[] }> {
  const trigger = page.locator(triggerSelector);
  await trigger.waitFor({ state: 'visible', timeout: 10000 });
  await trigger.click();
  await page.waitForTimeout(400);

  const items = page.locator(SELECTORS.dropdownItem);
  const count = await items.count();
  const allOptions: string[] = [];

  let matchIndex = -1;
  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).innerText()).trim();
    allOptions.push(text);

    if (matchIndex === -1) {
      if (typeof optionMatcher === 'string') {
        if (text.toLowerCase().includes(optionMatcher.toLowerCase())) {
          matchIndex = i;
        }
      } else if (optionMatcher.test(text)) {
        matchIndex = i;
      }
    }
  }

  if (matchIndex === -1) {
    // Close dropdown
    await page.keyboard.press('Escape');
    return { success: false, allOptions };
  }

  const selectedText = allOptions[matchIndex].split('\n')[0].trim();
  await items.nth(matchIndex).click();
  await page.waitForTimeout(600);

  return { success: true, selectedText, allOptions };
}

/**
 * Get all option texts from a dropdown without selecting
 */
async function getDropdownOptions(page: Page, triggerSelector: string): Promise<string[]> {
  const trigger = page.locator(triggerSelector);
  await trigger.waitFor({ state: 'visible', timeout: 10000 });
  await trigger.click();
  await page.waitForTimeout(400);

  const items = page.locator(SELECTORS.dropdownItem);
  const count = await items.count();
  const options: string[] = [];

  for (let i = 0; i < count; i++) {
    const text = (await items.nth(i).innerText()).split('\n')[0].trim();
    if (text) options.push(text);
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return options;
}

export async function checkCnapSlots(userOptions: CheckOptions = {}): Promise<CheckCnapResult> {
  const category = userOptions.category || 'Паспортні послуги';
  const targetLocation = userOptions.location || 'Хвильового';
  const headless = userOptions.headless ?? true;

  const browser: Browser = await chromium.launch({
    headless,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  const finalResult: CheckCnapResult = {
    category,
    targetLocation,
    categoryAvailable: false,
    services: [],
    hasAvailableSlots: false,
  };

  try {
    console.log(`[CNAP] Завантаження https://cnap-lviv.qsolutions.com.ua:2657/booking ...`);
    await page.goto('https://cnap-lviv.qsolutions.com.ua:2657/booking', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // 1. Обираємо категорію
    console.log(`[CNAP] Вибір категорії послуги: "${category}" ...`);
    const categorySelect = await selectOption(page, SELECTORS.categoryTrigger, category);
    if (!categorySelect.success) {
      finalResult.reason = `Категорію "${category}" не знайдено у списку: ${categorySelect.allOptions.join(', ')}`;
      console.warn(`[CNAP] ⚠️ ${finalResult.reason}`);
      return finalResult;
    }
    console.log(`[CNAP] ✅ Обрано категорію: "${categorySelect.selectedText}"`);
    await page.waitForTimeout(1000);

    // 2. Перевірка наявності попередження про недоступність послуг у категорії
    const warningEl = page.locator(SELECTORS.warningState);
    if (await warningEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      const warningText = (await warningEl.innerText()).replace(/\s+/g, ' ').trim();
      finalResult.categoryAvailable = false;
      finalResult.reason = warningText;
      console.log(`[CNAP] ℹ️ Повідомлення: "${warningText}"`);
      return finalResult;
    }

    const serviceTriggerText = (await page.locator(SELECTORS.serviceTrigger).innerText()).trim();
    if (serviceTriggerText.includes('Послуги недоступні')) {
      finalResult.categoryAvailable = false;
      finalResult.reason = 'Послуги недоступні для обраної категорії.';
      console.log(`[CNAP] ℹ️ ${finalResult.reason}`);
      return finalResult;
    }

    finalResult.categoryAvailable = true;

    // 3. Визначаємо список послуг для перевірки
    let servicesToCheck: string[] = [];
    if (userOptions.serviceName) {
      servicesToCheck = [userOptions.serviceName];
    } else {
      servicesToCheck = await getDropdownOptions(page, SELECTORS.serviceTrigger);
      console.log(`[CNAP] Знайдено послуг у категорії (${servicesToCheck.length}): ${servicesToCheck.join('; ')}`);
    }

    for (const serviceName of servicesToCheck) {
      console.log(`\n[CNAP] ---> Перевірка послуги: "${serviceName}"`);

      // Обираємо послугу
      const serviceSelect = await selectOption(page, SELECTORS.serviceTrigger, serviceName);
      if (!serviceSelect.success) {
        console.warn(`[CNAP] Не вдалося обрати послугу "${serviceName}"`);
        continue;
      }
      await page.waitForTimeout(800);

      // Перевіряємо Центр надання послуг (вул. Хвильового)
      const branchOptions = await getDropdownOptions(page, SELECTORS.branchTrigger);
      const matchingBranch = branchOptions.find((b) => b.toLowerCase().includes(targetLocation.toLowerCase()));

      const serviceRes: ServiceResult = {
        serviceName,
        locationFound: !!matchingBranch,
        locationName: matchingBranch,
        available: false,
        slots: [],
      };

      if (!matchingBranch) {
        serviceRes.reason = `Підрозділ "${targetLocation}" недоступний для цієї послуги.`;
        console.log(`[CNAP] ❌ ${serviceRes.reason}`);
        finalResult.services.push(serviceRes);
        continue;
      }

      console.log(`[CNAP] Знайдено підрозділ: "${matchingBranch}"`);

      // Обираємо підрозділ
      const branchSelect = await selectOption(page, SELECTORS.branchTrigger, matchingBranch);
      if (!branchSelect.success) {
        serviceRes.reason = `Не вдалося обрати підрозділ "${matchingBranch}".`;
        finalResult.services.push(serviceRes);
        continue;
      }
      await page.waitForTimeout(1000);

      // Перевіряємо календар
      const availableDays = page.locator(SELECTORS.availableDay);
      const daysCount = await availableDays.count();

      if (daysCount === 0) {
        serviceRes.reason = `Немає вільних дат у календарі для ${matchingBranch}.`;
        console.log(`[CNAP] ⚠️ ${serviceRes.reason}`);
        finalResult.services.push(serviceRes);
        continue;
      }

      console.log(`[CNAP] 🎉 Знайдено ${daysCount} день(-ів) із доступними місцями!`);
      serviceRes.available = true;
      finalResult.hasAvailableSlots = true;

      // Перевіряємо слоти часу для кожного доступного дня (до 7 днів)
      const maxDays = Math.min(daysCount, 7);
      for (let d = 0; d < maxDays; d++) {
        const dayBtn = availableDays.nth(d);
        const dayLabel = (await dayBtn.getAttribute('aria-label')) || (await dayBtn.innerText()).trim();

        await dayBtn.click();
        await page.waitForTimeout(700);

        const timeSlots = page.locator(SELECTORS.timeSlot);
        const slotCount = await timeSlots.count();
        const times: string[] = [];

        for (let t = 0; t < slotCount; t++) {
          const time = (await timeSlots.nth(t).innerText()).trim();
          if (time) times.push(time);
        }

        console.log(`  📅 ${dayLabel} -> Слоти: ${times.length > 0 ? times.join(', ') : 'немає активних слотів'}`);
        serviceRes.slots.push({
          date: dayLabel,
          times,
        });
      }

      finalResult.services.push(serviceRes);
    }

    if (userOptions.screenshotPath) {
      await page.screenshot({ path: userOptions.screenshotPath, fullPage: true });
      console.log(`[CNAP] Скріншот збережено у: ${userOptions.screenshotPath}`);
    }

    return finalResult;
  } catch (error: any) {
    console.error(`[CNAP] Помилка виконання:`, error.message);
    finalResult.reason = `Error: ${error.message}`;
    return finalResult;
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let category = 'Паспортні послуги';
  let serviceName: string | undefined;
  let location = 'Хвильового';
  let headless = true;
  let screenshotPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--category' && args[i + 1]) {
      category = args[++i];
    } else if (arg === '--service' && args[i + 1]) {
      serviceName = args[++i];
    } else if (arg === '--location' && args[i + 1]) {
      location = args[++i];
    } else if (arg === '--screenshot' && args[i + 1]) {
      screenshotPath = args[++i];
    } else if (arg === '--no-headless' || arg === '--headful') {
      headless = false;
    }
  }

  console.log('==================================================');
  console.log('       ЦНАП Львів - Перевірка слотів запису       ');
  console.log('==================================================');
  console.log(`Категорія:  ${category}`);
  if (serviceName) console.log(`Послуга:    ${serviceName}`);
  console.log(`Підрозділ:  вул. ${location}`);
  console.log(`Headless:   ${headless}`);
  console.log('--------------------------------------------------\n');

  const result = await checkCnapSlots({
    category,
    serviceName,
    location,
    headless,
    screenshotPath,
  });

  console.log('\n================ РЕЗУЛЬТАТ ПЕРЕВІРКИ ================');
  console.log(`Категорія: ${result.category}`);
  console.log(`Підрозділ (пошук): ${result.targetLocation}`);

  if (!result.categoryAvailable) {
    console.log(`Статус: 🔴 ПОСЛУГИ НЕДОСТУПНІ`);
    console.log(`Причина: ${result.reason || 'Немає доступних слотів'}`);
  } else if (result.hasAvailableSlots) {
    console.log(`Статус: 🟢 Є ВІЛЬНІ МІСЦЯ!`);
    for (const s of result.services) {
      if (s.available) {
        console.log(`\nПослуга: "${s.serviceName}" (${s.locationName})`);
        for (const slot of s.slots) {
          console.log(`  📅 ${slot.date}: ${slot.times.join(', ')}`);
        }
      }
    }
  } else {
    console.log(`Статус: 🟡 ВІЛЬНИХ МІСЦЬ НЕМАЄ`);
    for (const s of result.services) {
      console.log(`- ${s.serviceName}: ${s.reason || 'Вільні дати відсутні'}`);
    }
  }
  console.log('====================================================\n');

  if (!result.hasAvailableSlots) {
    process.exitCode = 2; // Exit code 2: no slots available (useful for monitoring/alerts)
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Критична помилка:', err);
    process.exit(1);
  });
}
