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
  let seasonEn = 'autumn';
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
  date: Date = new Date(),
  count = 4
): { systemPrompt: string; userPrompt: string } {
  const isEn = lang.toLowerCase().startsWith('en');
  const seasonInfo = getCurrentSeasonInfo(date);

  if (isEn) {
    const systemPrompt = `You help couples choose date ideas in the "Alphabet Dating" (AlphaDate) game.
Respond EXCLUSIVELY with a JSON array of objects without any additional text or markdown formatting.`;

    const userPrompt = `You help couples choose date ideas in the "Alphabet Dating" game.

Game rules: the couple receives a letter of the English alphabet, and they must organize a date with a theme starting with that letter. Examples: A — Aquapark, I — Ice skating, S — Sunset.

TASK
Generate ${count} date options for the letter "${letter}". Current season: ${seasonInfo.seasonEn}.

CRITERIA FOR A VALID DATE
A date is a shared activity, venue, or event for a couple lasting 1–3 hours: going somewhere together, tasting something, playing a game, or experiencing something new.

OPTION TITLE
1. Title is an established, widely known concept: a type of venue, event, or activity (e.g. Cinema, Jazz club, Bowling, Wine tasting, Tea ceremony).
2. Strictly 1–2 words (maximum 3 only if it is an established natural phrase like "horseback riding" or "craft beer tasting").
3. First word MUST start with the letter "${letter}". Real, common words understood by everyone.
4. Title contains only words: no parentheses, quotation marks, dashes, colons, or prepositional phrases.

STRICT PROHIBITIONS
5. NO abstract concepts, emotions, or virtues (e.g. not "Happiness", "Generosity", "Virtue", "Something new").
6. NO standalone physical objects or utensils (e.g. not "Business card", "Phone case", "Notebook", "Fork").
7. NO professions, agents, or persons as title (e.g. not "Wooden master", not "Videoblogger", not "Chef"). Name the activity or venue instead (e.g. "Woodworking workshop", "Jazz bar").
8. NO artificial adjective prefixes to force the letter: do NOT add "English...", "Home...", "Autumn..." just to match the letter (e.g. not "English park", not "Home picnic").
9. NO invented or distorted words: words must be real standard vocabulary understood by everyone.
10. NO household chores or daily routine (e.g. not watering houseplants, cleaning, laundry).
11. NO bizarre or fabricated venues (e.g. not "business card store", not "black market").

AVOIDING DUPLICATES
12. Each option must be a substantially different idea. Prohibited to provide multiple options sharing the same root or theme (e.g. not both "Jewelry shop" and "Jewelry workshop"). Choose one.
13. Diverse formats: active and calm, venues and outdoor activities.

SEASONALITY
14. All options must be doable right now, in the season "${seasonInfo.seasonEn}". Do not suggest seasonal activities of another season (in winter — "beach", in summer — "ice skating").
15. All-season options (cinema, cafe, museum, jazz bar) can always be suggested.
16. If there are fewer appropriate options than ${count}, return fewer. Do not invent.

DESCRIPTION
17. Description: 1–2 simple sentences, up to 160 characters, ending with a period.
18. Describe a realistic scenario: what exactly the couple does on the date. Only real, natural things anyone can do. No weird food combinations, no involving third parties (sellers, waiters, strangers).
19. Do not use clichés: "romantic atmosphere", "unforgettable impressions", "unforgettable evening", "special closeness".
20. Address the couple politely in the plural ("Visit", "Try", "Arrange"). Neutral: "the two of you", "together".

DIFFICULT LETTERS
For letters with few words (X, Q, Z, etc.), return only genuinely realistic options (even if it's only 1–2 options or an empty array []). Never hallucinate or substitute letters. For impossible letters, return [].

QUALITY EXAMPLES
Letter "B" (autumn):
[
  {"title": "Bowling", "description": "Play a few games of bowling together and cheer each other on."},
  {"title": "Bakery", "description": "Stop by a cozy local bakery to try fresh warm pastries and coffee."},
  {"title": "Billiards", "description": "Book a pool table for a relaxed game and a casual conversation."}
]

Letter "T" (autumn):
[
  {"title": "Tea ceremony", "description": "Visit an authentic tea house and sample rare tea varieties together."},
  {"title": "Theater", "description": "Get tickets for an evening play and discuss your impressions over dessert."},
  {"title": "Trampoline park", "description": "Spend an active hour jumping on trampolines and having fun together."}
]

RESPONSE FORMAT
Return ONLY a JSON array of objects, without explanations or markdown:
[
  {"title": "title", "description": "short description"}
]

Capitalize the first word of each title, keep the rest lowercase except proper nouns.`;

    return { systemPrompt, userPrompt };
  }

  const systemPrompt = `Ти допомагаєш парам обирати ідеї для побачень у грі «Побачення на літеру» (AlphaDate).
Відповідай ВИКЛЮЧНО у форматі JSON-масиву об'єктів без будь-якого вступного тексту, коментарів чи markdown-розмітки.`;

  const userPrompt = `Ти допомагаєш парам обирати ідеї для побачень у грі «Побачення на літеру».

Правила гри: парі випадає літера українського алфавіту, і вони мають організувати побачення, тематика якого починається на цю літеру. Приклади: А — аквапарк, Д — джаз-клуб, Ч — чайна церемонія.

ЗАВДАННЯ
Згенеруй ${count} варіантів побачення на літеру «${letter}». Поточна пора року: ${seasonInfo.seasonUk}.

СУТЬ ПОБАЧЕННЯ
Побачення — це завжди спільна діяльність або подія для двох тривалістю 1–3 години: кудись піти (заклад, локація), разом щось скуштувати, зіграти або отримати новий цікавий досвід.

НАЗВА ВАРІАНТА
1. Назва — це усталене, загальновідоме поняття: тип закладу, події чи активності (кіно, джаз-бар, чайна церемонія, боулінг, картинґ, дегустація вин).
2. Суворо 1–2 слова (максимум 3 тільки якщо це усталене природне словосполучення на зразок «катання на конях» чи «дегустація крафтового пива»).
3. Перше слово ОБОВ'ЯЗКОВО починається на літеру «${letter}». Слова справжні, поширені, зрозумілі кожному.
4. Назва містить лише слова: без дужок, лапок, тире, двокрапок, прийменникових хвостів на кшталт «в парку», «з кавою». Деталі пиши в опис.

СУВОРІ ЗАБОРОНИ
5. ЗАБОРОНЕНО абстрактні поняття, емоції, чесноти чи риси характеру (жодних «щастя», «щедрість», «чеснота», «романтика», «щось нове»).
6. ЗАБОРОНЕНО окремі фізичні предмети, канцелярію чи побутові речі (жодних «візитка», «чехол», «виделка», «зошит»).
7. ЗАБОРОНЕНО людей, посади або професії як назву (жодних «Дерев'яний майстер», «Відеоблогер», «Кухар», «Офіціант»). Називай локацію або активність (наприклад: «Джаз-вечір», «Дегустація вин», «Дартс»).
8. ЗАБОРОНЕНО штучне підганяння слів під літеру за допомогою прикметників: не ліпи «Український...», «Хатній...», «Домашній...», «Осінній...» (жодних «Український парк», «Хатній пікнік»).
9. ЗАБОРОНЕНО вигадані або спотворені слова: вживай виключно справжні, загальновідомі слова (жодних штучних неологізмів на зразок «чехардкування» чи «догінки»).
10. ЗАБОРОНЕНО побутову хатню рутину (догляд за кімнатними рослинами, прибирання, прання).
11. ЗАБОРОНЕНО абсурдні або неіснуючі формати (жодних «магазин візиток», не називати звичайний базар «чорним ринком»).

УНИКНЕННЯ ПОВТОРІВ
12. Кожен варіант — суттєво інша ідея. Заборонено кілька варіантів зі спільним коренем чи темою (наприклад, не можна одночасно «ювелірний магазин» і «ювелірна майстерня»).
13. Різноманітні формати: активні й спокійні, у закладі та просто неба.

СЕЗОННІСТЬ
14. Усі варіанти мають бути здійсненними саме зараз, у пору року «${seasonInfo.seasonUk}». Не пропонуй сезонні заняття іншої пори (узимку — «пляж», влітку — «ковзанка»).
15. Усесезонні варіанти (кіно, театр, кав'ярня, музей, боулінг) можна пропонувати завжди.
16. Якщо доречних варіантів менше, ніж ${count}, поверни менше. Не вигадуй штучного.

ОПИС
17. Опис: 1–2 прості речення, до 160 символів, обов'язково з крапкою в кінці.
18. Опиши реалістичний сценарій: що саме пара робить на побаченні. Лише реальні, природні речі. Без дивних поєднань їжі й напоїв, без вигаданих подій, без залучення сторонніх людей.
19. Не використовуй кліше: «романтична атмосфера», «неповторні враження», «незабутній вечір», «особлива близькість».
20. Звертайся до пари на «ви» у множині («Завітайте», «Спробуйте», «Влаштуйте»). Без слів, що вказують на стать чи тип стосунків. Нейтрально: «вдвох», «разом».

СКЛАДНІ ЛІТЕРИ
Для літер, на які мало слів (Й, Ї, Щ, Ц, Ф, Є, Ґ, Ю тощо), повертай тільки СПРАВЖНІ й адекватні варіанти, навіть якщо це всього 1–2 варіанти або порожній масив []. Краще повернути 1 гарний варіант або [], ніж абсурд. Для «Ь» повертай [].

ПРИКЛАДИ ЯКОСТІ
Літера «К» (осінь):
[
  {"title": "Кінотеатр", "description": "Оберіть сеанс у кінотеатрі й після фільму обговоріть враження за чашкою кави."},
  {"title": "Квест-кімната", "description": "Пройдіть захопливий квест удвох: шукайте підказки й розгадуйте таємниці на час."},
  {"title": "Караоке-бар", "description": "Забронюйте окрему кабінку й заспівайте разом улюблені пісні."},
  {"title": "Кав'ярня", "description": "Знайдіть затишне місце, замовте десерти й поспілкуйтесь без поспіху."}
]

Літера «Д» (осінь):
[
  {"title": "Джаз-клуб", "description": "Завітайте на вечір живої музики, замовте коктейлі та послухайте джазових виконавців."},
  {"title": "Дегустація вин", "description": "Відвідайте винний льох або бар, де соммельє познайомить вас із новими сортами вин."},
  {"title": "Драматичний театр", "description": "Купіть квитки на вечірню виставу й насолодіться грою акторів на сцені."},
  {"title": "Дартс", "description": "Забронюйте доріжку для гри в дартс у пабі та влаштуйте дружнє змагання удвох."}
]

ФОРМАТ ВІДПОВІДІ
Поверни ТІЛЬКИ JSON-масив об'єктів, без пояснень і без markdown:
[
  {"title": "назва", "description": "короткий опис"}
]

Назви пиши з великої літери першого слова, решту з малої, крім власних назв.`;

  return { systemPrompt, userPrompt };
}
