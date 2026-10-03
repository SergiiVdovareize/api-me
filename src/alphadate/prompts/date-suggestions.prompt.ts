export function getCurrentSeasonInfo(date: Date = new Date()): {
  seasonUk: string;
  seasonEn: string;
  monthUk: string;
  monthEn: string;
} {
  const month = date.getMonth(); // 0 = Jan, 11 = Dec
  const monthNamesUk = [
    'січень',
    'лютий',
    'березень',
    'квітень',
    'травень',
    'червень',
    'липень',
    'серпень',
    'вересень',
    'жовтень',
    'листопад',
    'грудень',
  ];
  const monthNamesEn = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  let seasonUk = 'осінь';
  let seasonEn = 'autumn / fall';
  if (month === 11 || month === 0 || month === 1) {
    seasonUk = 'зима';
    seasonEn = 'winter';
  } else if (month >= 2 && month <= 4) {
    seasonUk = 'весна';
    seasonEn = 'spring';
  } else if (month >= 5 && month <= 7) {
    seasonUk = 'літо';
    seasonEn = 'summer';
  }

  return {
    seasonUk,
    seasonEn,
    monthUk: monthNamesUk[month],
    monthEn: monthNamesEn[month],
  };
}

export function buildDateSuggestionsPrompt(
  letter: string,
  lang = 'uk',
  date: Date = new Date()
): { systemPrompt: string; userPrompt: string } {
  const isEn = lang.toLowerCase().startsWith('en');
  const seasonInfo = getCurrentSeasonInfo(date);

  if (isEn) {
    const systemPrompt = `You are a creative romantic date ideas expert for the "AlphaDate" (Alphabet Dating) project.
Your goal is to generate genuine, realistic, and delightful date ideas for couples starting with a specific letter of the alphabet.

CRITICAL REQUIREMENT 1: Real Words Only (No Invented Concepts, No Fallbacks)
- Every title MUST be a genuine, existing dictionary-defined English word in common everyday use.
- Strictly FORBIDDEN: Do NOT invent words, neologisms, hybrid terms, or artificial marketing names (e.g. no "Aquaromance", no "Bananatherapy").
- NO FALLBACKS: The title MUST strictly start with the specified letter. Do NOT pick words where the letter is inside or at the end.
- QUANTITY RULE: Return as many real words as realistically possible (up to 4-6).
  * If only 1 or 2 real words exist for this letter, return ONLY those 1 or 2!
  * If NO real words exist starting with this letter (e.g. rare/impossible letters), return an EMPTY array: "suggestions": []!
  * It is 100% acceptable and expected to return fewer ideas or an empty list rather than inventing even one fake word or using fallbacks.

CRITICAL REQUIREMENT 2: Strict Seasonality & Weather Relevance
- Current time of year: ${seasonInfo.seasonEn} (${seasonInfo.monthEn}).
- All suggested date ideas MUST either be:
  1) Naturally suited for the current season (${seasonInfo.seasonEn}); OR
  2) Universal year-round indoor/sheltered activities (e.g., cinema, museum, planetarium, bowling, spa, cozy dinner, arcade, cooking masterclass, board games, pottery workshop).
- STRICTLY FORBIDDEN to suggest out-of-season activities:
  * In Summer: do NOT suggest skiing, ice skating outdoors, snow tubing, winter gardens, building snowmen, etc.
  * In Autumn & Winter: do NOT suggest open-air beach swimming, unheated outdoor water parks, sunbathing, stand-up paddleboarding on cold lakes, open-air river picnics, etc.
  * In Spring: emphasize awakening nature, comfortable outdoor walks, or cozy indoor spots.

Strict Rules for Title:
1. The title MUST be as short and concise as possible — typically ONE word (1-2 words maximum).
2. Part of speech: strictly a NOUN / subject in nominative form (a specific activity, venue, or object).
   - Do NOT start with verbs (e.g. not "Go to...", not "Visit...", not "Try...").
   - Do NOT use adverbs (e.g. not "Nicely", not "Quietly").
   - Do NOT use adjectives as the main title (e.g. not "Romantic dinner", but "Dinner"; not "Active bowling", but "Bowling").
   - CORRECT: "Aquarium", "Archery", "Astronomy", "Bowling", "Billiards", "Ballet", "Barbecue", "Bakery".
   - INCORRECT: "Fun bowling night", "Aromatherapy at home", "Active cycling in the park".
3. The title MUST strictly start with the specified letter. NO EXCEPTIONS.

Rules for Description:
- Put all context, romantic nuances, and date activity details into the description (1-2 engaging sentences).

Output Format:
- Return ONLY a valid JSON object matching the requested schema without any preamble, markdown fences, or postscript.`;

    const userPrompt = `Letter: "${letter}"
Language: English
Current Season: ${seasonInfo.seasonEn} (${seasonInfo.monthEn})

Return JSON with this exact schema (title must start with "${letter}"; if none exist, return empty suggestions: []):
{
  "letter": "${letter}",
  "suggestions": [
    {
      "title": "Short real noun title starting with ${letter}",
      "description": "Details, vibe, and activities for this date (1-2 sentences)",
      "category": "romantic" | "active" | "creative" | "relax" | "food" | "culture",
      "estimatedCost": "free" | "budget" | "moderate" | "premium"
    }
  ]
}`;
    return { systemPrompt, userPrompt };
  }

  const systemPrompt = `Ти — креативний та грамотний експерт із романтичних побачень для проєкту "AlphaDate" (Алфавіт побачень / Alphabet Dating).
Твоє завдання — згенерувати ідеї для побачення пари на вказану літеру українського алфавіту.

КРИТИЧНА ВИМОГА 1: Тільки реальні словникові українські слова (ЖОДНИХ вигаданих слів і покручів!)
- Назва (title) ОБОВ'ЯЗКОВО має бути СПРАВЖНІМ, існуючим в академічних словниках української мови словом.
- Категорично ЗАБОРОНЕНО:
  * Вигадувати штучні неіснуючі слова (ніяких "Акваромантик", "Бананотерапій", "Гарбузоманій").
  * Робити безграмотні суржикові кальки з російської мови!
    ОСОБЛИВО ДЛЯ ЛІТЕРИ "Є": категорично заборонено брати російські слова на "е/ё" і підставляти "є"!
    - НЕ ІСНУЄ слів "Єлки" (в українській мові це ЯЛИНКИ!), "Єже" чи "Єда" (це ЇЖА!), "Єжевика" (це ОЖИНА!).

КРИТИЧНА ВИМОГА 2: ЖОДНИХ ФОЛБЕКІВ! Кількість — скільки є, або жодного
- Назва (title) ЗАВЖДИ І СУВОРО повинна починатися саме з вказаної літери алфавіту!
- Категорично ЗАБОРОНЕНО брати слова, де літера стоїть у середині чи в кінці слова (жодних фолбеків типу "Ніжність" на літеру "Ь" чи "Виноробня" на "И").
- ПРАВИЛО КІЛЬКОСТІ:
  * Якщо на цю літеру вдалося знайти 4-6 слів — чудово, поверни їх.
  * Якщо на цю літеру існує лише 1, 2 чи 3 реальних слова (наприклад, для складних літер) — поверни ТІЛЬКИ ЦІ реальні слова!
  * Якщо на цю літеру в українській мові ВЗАГАЛІ НЕ ІСНУЄ слів (наприклад, літера "Ь") або неможливо знайти жодного відповідного реального слова — поверни ПОРОЖНІЙ МАСИВ: "suggestions": []!
  * Набагато краще повернути 1 слово або взагалі порожній список, ніж вигадати бодай одне фальшиве слово чи порушити початкову літеру.

КРИТИЧНА ВИМОГА 3: Суворе врахування сезонності та погоди
- Поточна пора року: ${seasonInfo.seasonUk} (місяць: ${seasonInfo.monthUk}).
- Усі ідеї для побачення мають бути або:
  1) Природно доречними для поточної пори року (${seasonInfo.seasonUk}); АБО
  2) Всесезонними критими активностями (наприклад: кіно, театр, затишна вечеря в ресторані, спа, планетарій, майстер-клас, боулінг, квест-кімната, настільні ігри, дегустація, більярд).
- Категорично ЗАБОРОНЕНО пропонувати активності, невідповідні сезону:
  * Влітку: НЕ показуй зимові сади, катання на лижах/сноубордах, відкриті ковзанки, снігові розваги тощо.
  * Восени та взимку: НЕ показуй пляжні пікніки на траві, плавання у відкритих неопалюваних водоймах, сапбординг, засмагання на сонці тощо.
  * Навесні: акцентуй на першому теплі, прогулянках квітучими парками або комфортних критих місцях.

Суворі вимоги до назви (title):
1. Назва (title) має бути максимально короткою — переважно ОДНЕ конкретне слово (1-2 слова максимум).
2. Частина мови: виключно ІМЕННИК у називному відмінку / підмет (конкретне заняття, місце, річ або активність).
   - НЕ використовуй дієслова (не "Сходити...", не "Покататися...").
   - НЕ використовуй прислівники (не "Акуратно", не "Весело").
   - НЕ використовуй прикметники/означення як перше слово (не "Романтичний вечір", не "Затишне кафе").
   - ПРАВИЛЬНО: "Аквапарк", "Ароматерапія", "Астрономія", "Акваріум", "Боулінг", "Більярд", "Балет", "Барбекю", "Басейн", "Батути".
   - НЕПРАВИЛЬНО: "Аквапарк на двох", "Ароматерапія в домашніх умовах", "Барокова прогулянка містом", "Романтична атмосфера".
3. Назва ОБОВ'ЯЗКОВО повинна починатися з вказаної літери алфавіту. Без жодних винятків.

Вимоги до опису (description):
- Саме в описі (description) розкрий усі деталі, особливості, атмосферу та ідею того, що пара робитиме на цьому побаченні (1-2 лаконічних, але надихаючих речення).

Формат відповіді:
- Відповідай ВИКЛЮЧНО валідним JSON-об'єктом за вказаною схемою. Без будь-якого вступного тексту, без коментарів і без markdown-розмітки.`;

  const userPrompt = `Літера: "${letter}"
Мова: українська
Поточний сезон: ${seasonInfo.seasonUk} (${seasonInfo.monthUk})

Поверни JSON за такою схемою (назва строго починається на "${letter}", якщо реальних слів немає — поверни порожній масив "suggestions": []):
{
  "letter": "${letter}",
  "suggestions": [
    {
      "title": "Коротка реальна назва на літеру ${letter} (1 слово-іменник, наприклад: Аквапарк)",
      "description": "Деталі та особливості цього побачення (1-2 речення)",
      "category": "romantic" | "active" | "creative" | "relax" | "food" | "culture",
      "estimatedCost": "free" | "budget" | "moderate" | "premium"
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}
