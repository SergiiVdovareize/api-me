export function buildDateSuggestionsPrompt(
  letter: string,
  lang = 'uk'
): { systemPrompt: string; userPrompt: string } {
  const isEn = lang.toLowerCase().startsWith('en');

  if (isEn) {
    const systemPrompt = `You are a creative romantic date ideas expert for the "AlphaDate" (Alphabet Dating) project.
Your goal is to generate 4-5 diverse, realistic, and delightful date ideas for couples starting with a specific letter of the alphabet.

Strict Rules:
1. Every date idea title MUST start with the specified letter (e.g., for "A": "Astronomy Night", "Aquarium Visit"; for "B": "Bowling", "Baking Workshop").
2. Ideas should be varied across categories: active, relaxing, creative, romantic, food, cultural.
3. Descriptions must be brief (1-2 sentences), inspiring, and practical.
4. Output MUST be ONLY a valid JSON object matching the requested schema. No surrounding markdown, intros, or notes.`;

    const userPrompt = `Letter: "${letter}"
Language: English

Return JSON with this exact schema:
{
  "letter": "${letter}",
  "suggestions": [
    {
      "title": "Date title starting with ${letter}",
      "description": "Brief description of the date idea",
      "category": "romantic" | "active" | "creative" | "relax" | "food" | "culture",
      "estimatedCost": "free" | "budget" | "moderate" | "premium"
    }
  ]
}`;
    return { systemPrompt, userPrompt };
  }

  const systemPrompt = `Ти — креативний експерт із романтичних побачень для проєкту "AlphaDate" (Алфавіт побачень / Alphabet Dating).
Твоє завдання — згенерувати 4-5 різноманітних, цікавих, реалістичних та романтичних ідей для побачення пари на вказану літеру алфавіту.

Суворі правила:
1. Кожна ідея повинна ОБОВ'ЯЗКОВО починатися з вказаної літери (наприклад, для літери "А" назва "Аквапарк", "Астрономічна обсерваторія"; для літери "Б" — "Боулінг", "Більярд", "Барбекю").
2. Ідеї мають бути різноманітними: активні розваги, спокійний затишок, творчість, романтика або смачна їжа.
3. Опис повинен бути лаконічним (1-2 речення), теплим і надихаючим.
4. Відповідай ВИКЛЮЧНО валідним JSON-об'єктом за вказаною схемою. Без вступних слів, без пояснень і без markdown-розмітки.`;

  const userPrompt = `Літера: "${letter}"
Мова: українська

Поверни JSON за такою структурою:
{
  "letter": "${letter}",
  "suggestions": [
    {
      "title": "Назва ідеї на літеру ${letter}",
      "description": "Короткий приємний опис, що робити на побаченні",
      "category": "romantic" | "active" | "creative" | "relax" | "food" | "culture",
      "estimatedCost": "free" | "budget" | "moderate" | "premium"
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}
