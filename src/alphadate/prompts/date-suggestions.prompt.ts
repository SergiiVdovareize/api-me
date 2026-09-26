export function buildDateSuggestionsPrompt(
  letter: string,
  lang = 'uk'
): { systemPrompt: string; userPrompt: string } {
  const isEn = lang.toLowerCase().startsWith('en');

  if (isEn) {
    const systemPrompt = `You are a creative romantic date ideas expert for the "AlphaDate" (Alphabet Dating) project.
Your goal is to generate 4-6 diverse, realistic, and delightful date ideas for couples starting with a specific letter of the alphabet.

Strict Rules for Title:
1. The title MUST be as short and concise as possible — typically ONE word (1-2 words maximum).
2. Part of speech: strictly a NOUN / subject in nominative form (a specific activity, venue, or object).
   - Do NOT start with verbs (e.g. not "Go to...", not "Visit...").
   - Do NOT use adverbs (e.g. not "Nicely", not "Quietly").
   - Do NOT use adjectives as the main title (e.g. not "Romantic dinner", but "Dinner"; not "Active bowling", but "Bowling").
   - CORRECT: "Aquarium", "Archery", "Astronomy", "Bowling", "Billiards", "Ballet", "Barbecue", "Bakery".
   - INCORRECT: "Fun bowling night", "Aromatherapy at home", "Active cycling in the park".
3. The title MUST start with the specified letter. (Exceptions allowed only for very rare letters where a single noun is impossible).

Rules for Description:
- Put all context, romantic nuances, and date activity details into the description (1-2 engaging sentences).

Output Format:
- Return ONLY a valid JSON object matching the requested schema without any preamble, markdown fences, or postscript.`;

    const userPrompt = `Letter: "${letter}"
Language: English

Return JSON with this exact schema (title is a short noun):
{
  "letter": "${letter}",
  "suggestions": [
    {
      "title": "Short noun title (e.g. Aquarium)",
      "description": "Details, vibe, and activities for this date (1-2 sentences)",
      "category": "romantic" | "active" | "creative" | "relax" | "food" | "culture",
      "estimatedCost": "free" | "budget" | "moderate" | "premium"
    }
  ]
}`;
    return { systemPrompt, userPrompt };
  }

  const systemPrompt = `Ти — креативний експерт із романтичних побачень для проєкту "AlphaDate" (Алфавіт побачень / Alphabet Dating).
Твоє завдання — згенерувати 4-6 різноманітних, цікавих, реалістичних та романтичних ідей для побачення пари на вказану літеру алфавіту.

Суворі вимоги до назви (title):
1. Назва (title) має бути максимально короткою — переважно ОДНЕ конкретне слово (1-2 слова максимум).
2. Частина мови: виключно ІМЕННИК у називному відмінку / підмет (конкретне заняття, місце, річ або активність).
   - НЕ використовуй дієслова (не "Сходити...", не "Покататися...").
   - НЕ використовуй прислівники (не "Акуратно", не "Весело").
   - НЕ використовуй прикметники/означення як перше слово (не "Романтичний вечір", не "Затишне кафе").
   - ПРАВИЛЬНО: "Аквапарк", "Ароматерапія", "Астрономія", "Акваріум", "Боулінг", "Більярд", "Балет", "Барбекю", "Басейн", "Батути".
   - НЕПРАВИЛЬНО: "Аквапарк на двох", "Ароматерапія в домашніх умовах", "Барокова прогулянка містом", "Романтична атмосфера".
   (Винятки допускаються тільки для рідкісних або складних букв, як Ь, И, Ї, Ґ, де немає простих іменників).
3. Назва ОБОВ'ЯЗКОВО повинна починатися з вказаної літери алфавіту.

Вимоги до опису (description):
- Саме в описі (description) розкрий усі деталі, особливості, атмосферу та ідею того, що пара робитиме на цьому побаченні (1-2 лаконічних, але надихаючих речення).

Формат відповіді:
- Відповідай ВИКЛЮЧНО валідним JSON-об'єктом за вказаною схемою. Без будь-якого вступного тексту, без коментарів і без markdown-розмітки.`;

  const userPrompt = `Літера: "${letter}"
Мова: українська

Поверни JSON за такою схемою (назва — коротке слово-підмет):
{
  "letter": "${letter}",
  "suggestions": [
    {
      "title": "Коротка назва (1 слово-іменник, наприклад: Аквапарк)",
      "description": "Деталі та особливості цього побачення (1-2 речення)",
      "category": "romantic" | "active" | "creative" | "relax" | "food" | "culture",
      "estimatedCost": "free" | "budget" | "moderate" | "premium"
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}
